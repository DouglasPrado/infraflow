import { compareVersions } from "@infraflow/analyzer";
import { ArchitectureDocumentSchema } from "@infraflow/schema";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/guard.ts";
import { db } from "../db.ts";

/**
 * Versões de arquitetura (PRD §38, §39, §80).
 *
 * O fluxo do §80 é `v1 → test → modify → v2 → test → compare`. O snapshot
 * congela o estado atual; o clone abre uma arquitetura nova a partir de uma
 * versão, para explorar uma alternativa sem perder a original.
 */

const idParams = z.object({ id: z.uuid() });

const compareQuery = z.object({
  from: z.coerce.number().int().positive(),
  to: z.coerce.number().int().positive(),
});

const cloneBody = z.object({
  /** Versão a clonar. Ausente significa a corrente. */
  version: z.coerce.number().int().positive().optional(),
  name: z.string().min(1).max(200).optional(),
});

async function ownedArchitecture(id: string, userId: string) {
  return db.architecture.findFirst({
    where: { id, project: { ownerId: userId } },
    include: { project: { select: { id: true } } },
  });
}

export const versionRoutes: FastifyPluginAsync = async (app) => {
  /** PRD §38 — as versões da arquitetura. */
  app.get("/architectures/:id/versions", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "dados_invalidos" });

    const architecture = await ownedArchitecture(params.data.id, user.id);
    if (!architecture) return reply.status(404).send({ error: "arquitetura_nao_encontrada" });

    const versions = await db.architectureVersion.findMany({
      where: { architectureId: architecture.id },
      orderBy: { number: "desc" },
      select: {
        id: true,
        number: true,
        label: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { runs: true } },
      },
    });

    return versions.map((version) => ({
      number: version.number,
      label: version.label,
      createdAt: version.createdAt,
      updatedAt: version.updatedAt,
      runs: version._count.runs,
    }));
  });

  /**
   * PRD §80 — Clone.
   *
   * Cria uma arquitetura nova, no mesmo projeto, a partir de uma versão. É
   * como se explora uma alternativa (§29) sem arriscar a original: as duas
   * passam a evoluir e a ser testadas em separado.
   */
  app.post("/architectures/:id/clone", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "dados_invalidos" });

    const body = cloneBody.safeParse(request.body ?? {});
    if (!body.success) return reply.status(400).send({ error: "dados_invalidos" });

    const architecture = await ownedArchitecture(params.data.id, user.id);
    if (!architecture) return reply.status(404).send({ error: "arquitetura_nao_encontrada" });

    const source = await db.architectureVersion.findFirst({
      where: {
        architectureId: architecture.id,
        ...(body.data.version === undefined ? {} : { number: body.data.version }),
      },
      orderBy: { number: "desc" },
    });
    if (!source) return reply.status(404).send({ error: "versao_nao_encontrada" });

    const document = ArchitectureDocumentSchema.safeParse(source.graph);
    if (!document.success) return reply.status(500).send({ error: "documento_invalido" });

    const name = body.data.name ?? `${architecture.name} (cópia)`;

    // O nome é único por projeto; um sufixo evita colidir com clones anteriores.
    const existing = await db.architecture.count({
      where: { projectId: architecture.projectId, name },
    });
    const finalName = existing === 0 ? name : `${name} ${existing + 1}`;

    const clone = await db.architecture.create({
      data: {
        projectId: architecture.projectId,
        name: finalName,
        provider: architecture.provider,
        environment: architecture.environment,
        versions: {
          create: {
            number: 1,
            // O clone começa do documento da origem, com o nome novo.
            graph: { ...document.data, name: finalName },
            label: `Clonada de ${architecture.name} v${source.number}`,
          },
        },
      },
      select: { id: true, name: true },
    });

    return reply.status(201).send({ id: clone.id, name: clone.name, fromVersion: source.number });
  });

  /** PRD §39 — Compare v_from ↔ v_to. */
  app.get("/architectures/:id/compare", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "dados_invalidos" });

    const query = compareQuery.safeParse(request.query);
    if (!query.success) return reply.status(400).send({ error: "dados_invalidos" });

    const architecture = await ownedArchitecture(params.data.id, user.id);
    if (!architecture) return reply.status(404).send({ error: "arquitetura_nao_encontrada" });

    const versions = await db.architectureVersion.findMany({
      where: {
        architectureId: architecture.id,
        number: { in: [query.data.from, query.data.to] },
      },
    });

    const from = versions.find((version) => version.number === query.data.from);
    const to = versions.find((version) => version.number === query.data.to);
    if (!from || !to) return reply.status(404).send({ error: "versao_nao_encontrada" });

    const left = ArchitectureDocumentSchema.safeParse(from.graph);
    const right = ArchitectureDocumentSchema.safeParse(to.graph);
    if (!left.success || !right.success) {
      return reply.status(500).send({ error: "documento_invalido" });
    }

    return {
      from: { number: from.number, label: from.label },
      to: { number: to.number, label: to.label },
      ...compareVersions({ document: left.data }, { document: right.data }),
    };
  });
};
