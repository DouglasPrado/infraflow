import { slugFor } from "@infraflow/schema";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/guard.ts";
import { db } from "../db.ts";
import { env } from "../env.ts";
import { runQueue } from "../queue.ts";

/**
 * Laboratórios de infraestrutura (PRD §76).
 *
 * A API cria o registro e enfileira; quem aplica OpenTofu é o worker (§51).
 *
 * O alvo é **sempre** o docker efêmero. Não existe rota para aplicar na nuvem:
 * o §75 mantém a nuvem sem apply automático, e um laboratório que pudesse
 * aplicar na AWS transformaria um clique em conta.
 */

const idParams = z.object({ id: z.uuid() });

/** Enquanto o worker não confirma o fim, o laboratório conta como vivo. */
const LIVE = ["CREATING", "READY", "DESTROYING"] as const;

function serialize(lab: {
  id: string;
  slug: string;
  status: string;
  entryUrl: string | null;
  entryPort: number | null;
  containers: unknown;
  error: string | null;
  expiresAt: Date;
  readyAt: Date | null;
  destroyedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: lab.id,
    slug: lab.slug,
    status: lab.status,
    entryUrl: lab.entryUrl,
    entryPort: lab.entryPort,
    containers: lab.containers,
    error: lab.error,
    expiresAt: lab.expiresAt,
    readyAt: lab.readyAt,
    destroyedAt: lab.destroyedAt,
    createdAt: lab.createdAt,
  };
}

export const labRoutes: FastifyPluginAsync = async (app) => {
  /** PRD §76 — Create Lab. */
  app.post("/architectures/:id/labs", async (request, reply) => {
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

    // Um laboratório por arquitetura: dois ambientes vivos disputariam porta e
    // confundiriam qual deles o teste de carga está medindo.
    const existing = await db.lab.findFirst({
      where: { architectureId: architecture.id, status: { in: [...LIVE] } },
      select: { id: true },
    });
    if (existing) return reply.status(409).send({ error: "laboratorio_em_andamento" });

    const slug = slugFor("test");

    const lab = await db.lab.create({
      data: {
        architectureId: architecture.id,
        versionId: latest.id,
        slug,
        workdir: "",
        expiresAt: new Date(Date.now() + env.labTtlMs),
      },
    });

    const run = await db.run.create({
      data: {
        architectureId: architecture.id,
        versionId: latest.id,
        labId: lab.id,
        kind: "LAB_APPLY",
        slug: slugFor("lab-apply"),
        params: { target: "docker" },
      },
    });

    try {
      await runQueue.add("run", { runId: run.id });
    } catch {
      await db.lab.update({
        where: { id: lab.id },
        data: { status: "FAILED", error: "A fila de execuções está indisponível." },
      });
      await db.run.update({
        where: { id: run.id },
        data: { status: "FAILED", error: "A fila de execuções está indisponível.", finishedAt: new Date() },
      });
      return reply.status(503).send({ error: "fila_indisponivel" });
    }

    return reply.status(202).send({ ...serialize(lab), runId: run.id });
  });

  app.get("/architectures/:id/labs", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "dados_invalidos" });

    const labs = await db.lab.findMany({
      where: { architectureId: params.data.id, architecture: { project: { ownerId: user.id } } },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    return labs.map(serialize);
  });

  /** PRD §54 — o que sobe tem que descer. */
  app.delete("/labs/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "dados_invalidos" });

    const lab = await db.lab.findFirst({
      where: { id: params.data.id, architecture: { project: { ownerId: user.id } } },
    });
    if (!lab) return reply.status(404).send({ error: "laboratorio_nao_encontrado" });
    if (lab.status === "DESTROYED") return reply.status(409).send({ error: "laboratorio_ja_destruido" });

    const run = await db.run.create({
      data: {
        architectureId: lab.architectureId,
        versionId: lab.versionId,
        labId: lab.id,
        kind: "LAB_DESTROY",
        slug: slugFor("lab-destroy"),
        params: { target: "docker" },
      },
    });

    try {
      await runQueue.add("run", { runId: run.id });
    } catch {
      await db.run.update({
        where: { id: run.id },
        data: { status: "FAILED", error: "A fila de execuções está indisponível.", finishedAt: new Date() },
      });
      return reply.status(503).send({ error: "fila_indisponivel" });
    }

    return reply.status(202).send({ runId: run.id });
  });
};
