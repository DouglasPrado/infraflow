import { ArchitectureDocumentSchema, toArchitectureJson, validateIntegrity } from "@infraflow/schema";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { db } from "../db.ts";

/**
 * PRD §71 — persistência de projects, architectures e versions, com autosave.
 *
 * A API é fina de propósito (PRD §51): valida o documento, grava e devolve.
 * Compilação de OpenTofu e teste de carga rodam em workers isolados, nunca aqui.
 */

const slugParams = z.object({ slug: z.string().min(1) });
const idParams = z.object({ id: z.uuid() });

const createProjectBody = z.object({
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-z0-9-]+$/, "Use apenas minúsculas, números e hífen."),
});

const createArchitectureBody = z.object({
  document: ArchitectureDocumentSchema,
});

const saveBody = z.object({
  document: ArchitectureDocumentSchema,
});

const snapshotBody = z.object({
  label: z.string().min(1).max(200).optional(),
});

/** Traduz erro do Zod numa resposta previsível para a web. */
function invalid(issues: z.core.$ZodIssue[]) {
  return {
    error: "documento_invalido",
    issues: issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  };
}

export const architectureRoutes: FastifyPluginAsync = async (app) => {
  app.get("/projects", async () => {
    const projects = await db.project.findMany({
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { architectures: true } } },
    });

    return projects.map((project) => ({
      id: project.id,
      slug: project.slug,
      name: project.name,
      architectures: project._count.architectures,
      updatedAt: project.updatedAt,
    }));
  });

  app.post("/projects", async (request, reply) => {
    const body = createProjectBody.safeParse(request.body);
    if (!body.success) return reply.status(400).send(invalid(body.error.issues));

    const existing = await db.project.findUnique({ where: { slug: body.data.slug } });
    if (existing) return reply.status(409).send({ error: "slug_em_uso" });

    const project = await db.project.create({ data: body.data });
    return reply.status(201).send(project);
  });

  app.get("/projects/:slug/architectures", async (request, reply) => {
    const params = slugParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send(invalid(params.error.issues));

    const project = await db.project.findUnique({
      where: { slug: params.data.slug },
      include: {
        architectures: {
          orderBy: { updatedAt: "desc" },
          include: { _count: { select: { versions: true } } },
        },
      },
    });
    if (!project) return reply.status(404).send({ error: "projeto_nao_encontrado" });

    return project.architectures.map((architecture) => ({
      id: architecture.id,
      name: architecture.name,
      provider: architecture.provider,
      environment: architecture.environment,
      versions: architecture._count.versions,
      updatedAt: architecture.updatedAt,
    }));
  });

  app.post("/projects/:slug/architectures", async (request, reply) => {
    const params = slugParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send(invalid(params.error.issues));

    const body = createArchitectureBody.safeParse(request.body);
    if (!body.success) return reply.status(400).send(invalid(body.error.issues));

    const project = await db.project.findUnique({ where: { slug: params.data.slug } });
    if (!project) return reply.status(404).send({ error: "projeto_nao_encontrado" });

    const { document } = body.data;
    const architecture = await db.architecture.create({
      data: {
        projectId: project.id,
        name: document.name,
        provider: document.provider,
        environment: document.environment,
        versions: { create: { number: 1, graph: document } },
      },
      include: { versions: true },
    });

    return reply.status(201).send({
      id: architecture.id,
      name: architecture.name,
      version: 1,
    });
  });

  app.get("/architectures/:id", async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send(invalid(params.error.issues));

    const architecture = await db.architecture.findUnique({
      where: { id: params.data.id },
      include: { versions: { orderBy: { number: "desc" }, take: 1 } },
    });

    const latest = architecture?.versions[0];
    if (!architecture || !latest) return reply.status(404).send({ error: "arquitetura_nao_encontrada" });

    return {
      id: architecture.id,
      projectId: architecture.projectId,
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

    const architecture = await db.architecture.findUnique({
      where: { id: params.data.id },
      include: { versions: { orderBy: { number: "desc" }, take: 1 } },
    });

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
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send(invalid(params.error.issues));

    const body = snapshotBody.safeParse(request.body ?? {});
    if (!body.success) return reply.status(400).send(invalid(body.error.issues));

    const latest = await db.architectureVersion.findFirst({
      where: { architectureId: params.data.id },
      orderBy: { number: "desc" },
    });
    if (!latest) return reply.status(404).send({ error: "arquitetura_nao_encontrada" });

    const version = await db.architectureVersion.create({
      data: {
        architectureId: params.data.id,
        number: latest.number + 1,
        graph: latest.graph ?? {},
        label: body.data.label ?? null,
      },
    });

    return reply.status(201).send({ version: version.number, label: version.label });
  });

  /** Projeção de automação (PRD §33, §34). */
  app.get("/architectures/:id/architecture.json", async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send(invalid(params.error.issues));

    const latest = await db.architectureVersion.findFirst({
      where: { architectureId: params.data.id },
      orderBy: { number: "desc" },
    });
    if (!latest) return reply.status(404).send({ error: "arquitetura_nao_encontrada" });

    const parsed = ArchitectureDocumentSchema.safeParse(latest.graph);
    if (!parsed.success) return reply.status(500).send(invalid(parsed.error.issues));

    return toArchitectureJson(parsed.data);
  });
};
