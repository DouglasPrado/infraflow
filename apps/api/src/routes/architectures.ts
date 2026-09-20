import { ArchitectureDocumentSchema, toArchitectureJson, validateIntegrity } from "@infraflow/schema";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/guard.ts";
import { db } from "../db.ts";

/**
 * PRD §71 — persistência de projects, architectures e versions, com autosave.
 *
 * A API é fina de propósito (PRD §51): valida o documento, grava e devolve.
 * Compilação de OpenTofu e teste de carga rodam em workers isolados, nunca aqui.
 *
 * Toda leitura e escrita é escopada ao dono. Um id de arquitetura de outro
 * usuário responde 404, não 403 — não vale confirmar que o recurso existe.
 */

const idParams = z.object({ id: z.uuid() });

const saveBody = z.object({ document: ArchitectureDocumentSchema });
const snapshotBody = z.object({ label: z.string().min(1).max(200).optional() });
const workspaceBody = z.object({ document: ArchitectureDocumentSchema });

function invalid(issues: z.core.$ZodIssue[]) {
  return {
    error: "documento_invalido",
    issues: issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  };
}

/** Carrega a arquitetura só se ela pertencer ao usuário. */
async function ownedArchitecture(id: string, userId: string) {
  return db.architecture.findFirst({
    where: { id, project: { ownerId: userId } },
    include: { versions: { orderBy: { number: "desc" }, take: 1 } },
  });
}

function slugify(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "projeto"
  );
}

export const architectureRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Ponto de entrada da web depois do login: devolve a arquitetura de trabalho
   * do usuário, criando projeto e arquitetura na primeira vez a partir do
   * documento enviado (a arquitetura demo do §65).
   */
  app.post("/me/workspace", async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const existing = await db.architecture.findFirst({
      where: { project: { ownerId: user.id } },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (existing) return { architectureId: existing.id, created: false };

    const body = workspaceBody.safeParse(request.body);
    if (!body.success) return reply.status(400).send(invalid(body.error.issues));

    const { document } = body.data;
    const base = slugify(`${user.name}-${document.name}`);

    const architecture = await db.architecture.create({
      data: {
        name: document.name,
        provider: document.provider,
        environment: document.environment,
        project: {
          create: {
            ownerId: user.id,
            name: document.name,
            slug: `${base}-${Date.now().toString(36)}`,
          },
        },
        versions: { create: { number: 1, graph: document } },
      },
      select: { id: true },
    });

    return reply.status(201).send({ architectureId: architecture.id, created: true });
  });

  app.get("/me/architectures", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const architectures = await db.architecture.findMany({
      where: { project: { ownerId: user.id } },
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { versions: true } } },
    });

    return architectures.map((architecture) => ({
      id: architecture.id,
      name: architecture.name,
      provider: architecture.provider,
      environment: architecture.environment,
      versions: architecture._count.versions,
      updatedAt: architecture.updatedAt,
    }));
  });

  app.get("/architectures/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send(invalid(params.error.issues));

    const architecture = await ownedArchitecture(params.data.id, user.id);
    const latest = architecture?.versions[0];
    if (!architecture || !latest) return reply.status(404).send({ error: "arquitetura_nao_encontrada" });

    return {
      id: architecture.id,
      version: latest.number,
      updatedAt: latest.updatedAt,
      document: latest.graph,
    };
  });

  /**
   * Autosave (PRD §71): grava por cima da versão corrente.
   * Snapshot explícito é `POST /architectures/:id/versions` — não se cria uma
   * versão por tecla digitada.
   */
  app.put("/architectures/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send(invalid(params.error.issues));

    const body = saveBody.safeParse(request.body);
    if (!body.success) return reply.status(400).send(invalid(body.error.issues));

    const { document } = body.data;

    // Documento estruturalmente válido ainda pode ser incoerente.
    const issues = validateIntegrity(document);
    if (issues.length > 0) {
      return reply.status(422).send({ error: "documento_incoerente", issues });
    }

    const architecture = await ownedArchitecture(params.data.id, user.id);
    const latest = architecture?.versions[0];
    if (!architecture || !latest) return reply.status(404).send({ error: "arquitetura_nao_encontrada" });

    const [, version] = await db.$transaction([
      db.architecture.update({
        where: { id: architecture.id },
        data: {
          name: document.name,
          provider: document.provider,
          environment: document.environment,
        },
      }),
      db.architectureVersion.update({
        where: { id: latest.id },
        data: { graph: document },
      }),
    ]);

    return { id: architecture.id, version: version.number, updatedAt: version.updatedAt };
  });

  /** PRD §38 — congela o estado atual numa nova versão. */
  app.post("/architectures/:id/versions", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send(invalid(params.error.issues));

    const body = snapshotBody.safeParse(request.body ?? {});
    if (!body.success) return reply.status(400).send(invalid(body.error.issues));

    const architecture = await ownedArchitecture(params.data.id, user.id);
    const latest = architecture?.versions[0];
    if (!architecture || !latest) return reply.status(404).send({ error: "arquitetura_nao_encontrada" });

    const version = await db.architectureVersion.create({
      data: {
        architectureId: architecture.id,
        number: latest.number + 1,
        graph: latest.graph ?? {},
        label: body.data.label ?? null,
      },
    });

    return reply.status(201).send({ version: version.number, label: version.label });
  });

  /** Projeção de automação (PRD §33, §34). */
  app.get("/architectures/:id/architecture.json", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send(invalid(params.error.issues));

    const architecture = await ownedArchitecture(params.data.id, user.id);
    const latest = architecture?.versions[0];
    if (!latest) return reply.status(404).send({ error: "arquitetura_nao_encontrada" });

    const parsed = ArchitectureDocumentSchema.safeParse(latest.graph);
    if (!parsed.success) return reply.status(500).send(invalid(parsed.error.issues));

    return toArchitectureJson(parsed.data);
  });
};
