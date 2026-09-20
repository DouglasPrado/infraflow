import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { canStoreSecrets, open, seal } from "@infraflow/db";
import { ArchitectureDocumentSchema } from "@infraflow/schema";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { priceArchitecture, type AwsCredential } from "../pricing/aws.ts";
import { requireUser } from "../auth/guard.ts";
import { db } from "../db.ts";

/**
 * Credencial de nuvem do projeto (PRD §52) e preço de tabela (§40).
 *
 * A credencial é **do projeto**, não da máquina: o §52 proíbe compartilhá-la
 * entre projetos, e até aqui o worker usava a que estivesse no ambiente — o que
 * fazia toda arquitetura planejar com a mesma identidade.
 *
 * O segredo entra cifrado e **nunca sai**. Nenhuma rota devolve a chave; o que
 * volta é o suficiente para a interface dizer qual está guardada.
 */

const idParams = z.object({ id: z.uuid() });

const saveBody = z.object({
  region: z.string().min(2).max(32).regex(/^[a-z0-9-]+$/, "região inválida"),
  accessKeyId: z.string().min(16).max(128),
  secretAccessKey: z.string().min(16).max(256),
});

/** Projeto dono da arquitetura, se ela for do usuário. */
async function projectOf(architectureId: string, userId: string) {
  const architecture = await db.architecture.findFirst({
    where: { id: architectureId, project: { ownerId: userId } },
    select: { projectId: true },
  });
  return architecture?.projectId ?? null;
}

/** O que a interface pode ver: tudo menos o segredo. */
function publicView(credential: {
  provider: string;
  region: string;
  hint: string;
  accountId: string | null;
  verifiedAt: Date | null;
  lastError: string | null;
  updatedAt: Date;
} | null) {
  return {
    configured: credential !== null,
    canStore: canStoreSecrets(),
    ...(credential
      ? {
          provider: credential.provider,
          region: credential.region,
          hint: credential.hint,
          accountId: credential.accountId,
          verifiedAt: credential.verifiedAt,
          lastError: credential.lastError,
          updatedAt: credential.updatedAt,
        }
      : {}),
  };
}

/** Confere a credencial contra a AWS e devolve a conta a que ela pertence. */
async function verify(credential: AwsCredential): Promise<{ accountId: string }> {
  const sts = new STSClient({
    region: credential.region,
    credentials: {
      accessKeyId: credential.accessKeyId,
      secretAccessKey: credential.secretAccessKey,
    },
  });

  const identity = await sts.send(new GetCallerIdentityCommand({}));
  if (!identity.Account) throw new Error("A AWS não devolveu a conta da credencial.");
  return { accountId: identity.Account };
}

/** Lê e decifra a credencial do projeto. Só o servidor chega aqui. */
export async function credentialFor(projectId: string): Promise<AwsCredential | null> {
  const stored = await db.cloudCredential.findUnique({ where: { projectId } });
  if (!stored) return null;

  const secret = JSON.parse(
    open({ cipher: stored.cipher, iv: stored.iv, tag: stored.tag }),
  ) as { accessKeyId: string; secretAccessKey: string };

  return { ...secret, region: stored.region };
}

export const credentialRoutes: FastifyPluginAsync = async (app) => {
  app.get("/architectures/:id/credential", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "dados_invalidos" });

    const projectId = await projectOf(params.data.id, user.id);
    if (!projectId) return reply.status(404).send({ error: "arquitetura_nao_encontrada" });

    return publicView(await db.cloudCredential.findUnique({ where: { projectId } }));
  });

  /** Guarda a credencial — conferindo antes que ela funciona. */
  app.put("/architectures/:id/credential", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "dados_invalidos" });

    const body = saveBody.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        error: "dados_invalidos",
        detail: body.error.issues[0]?.message,
      });
    }

    if (!canStoreSecrets()) {
      // Sem chave de cifra, guardar a credencial seria gravá-la em claro.
      return reply.status(503).send({ error: "cifra_indisponivel" });
    }

    const projectId = await projectOf(params.data.id, user.id);
    if (!projectId) return reply.status(404).send({ error: "arquitetura_nao_encontrada" });

    const credential: AwsCredential = {
      accessKeyId: body.data.accessKeyId.trim(),
      secretAccessKey: body.data.secretAccessKey.trim(),
      region: body.data.region,
    };

    let accountId: string;
    try {
      ({ accountId } = await verify(credential));
    } catch (cause) {
      return reply.status(422).send({
        error: "credencial_invalida",
        detail: cause instanceof Error ? cause.message : "A AWS recusou a credencial.",
      });
    }

    const sealed = seal(JSON.stringify({
      accessKeyId: credential.accessKeyId,
      secretAccessKey: credential.secretAccessKey,
    }));

    const stored = await db.cloudCredential.upsert({
      where: { projectId },
      create: {
        projectId,
        provider: "aws",
        region: credential.region,
        hint: `…${credential.accessKeyId.slice(-4)}`,
        ...sealed,
        accountId,
        verifiedAt: new Date(),
      },
      update: {
        region: credential.region,
        hint: `…${credential.accessKeyId.slice(-4)}`,
        ...sealed,
        accountId,
        verifiedAt: new Date(),
        lastError: null,
      },
    });

    return publicView(stored);
  });

  app.delete("/architectures/:id/credential", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "dados_invalidos" });

    const projectId = await projectOf(params.data.id, user.id);
    if (!projectId) return reply.status(404).send({ error: "arquitetura_nao_encontrada" });

    await db.cloudCredential.deleteMany({ where: { projectId } });
    return reply.status(204).send();
  });

  /**
   * PRD §40 — custo pela tabela da AWS, com a credencial do projeto.
   *
   * Sem credencial não há preço: responde `409` e a interface continua
   * mostrando a estimativa do registry, dizendo que é estimativa.
   */
  app.get("/architectures/:id/pricing", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "dados_invalidos" });

    const architecture = await db.architecture.findFirst({
      where: { id: params.data.id, project: { ownerId: user.id } },
      include: { versions: { orderBy: { number: "desc" }, take: 1 } },
    });
    const latest = architecture?.versions[0];
    if (!architecture || !latest) {
      return reply.status(404).send({ error: "arquitetura_nao_encontrada" });
    }

    const credential = await credentialFor(architecture.projectId).catch(() => null);
    if (!credential) return reply.status(409).send({ error: "credencial_ausente" });

    const document = ArchitectureDocumentSchema.safeParse(latest.graph);
    if (!document.success) return reply.status(500).send({ error: "documento_invalido" });

    try {
      return await priceArchitecture(document.data, credential);
    } catch (cause) {
      app.log.error(cause);
      await db.cloudCredential.update({
        where: { projectId: architecture.projectId },
        data: { lastError: cause instanceof Error ? cause.message.slice(0, 500) : "falha" },
      });
      return reply.status(502).send({ error: "tabela_indisponivel" });
    }
  });
};
