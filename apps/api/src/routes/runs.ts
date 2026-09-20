import { RunParamsSchema, RunTargetSchema, slugFor } from "@infraflow/schema";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/guard.ts";
import { db } from "../db.ts";
import { runQueue } from "../queue.ts";

/**
 * Execuções (PRD §51, §75).
 *
 * A API cria o registro, enfileira e devolve `202`. Nada aqui espera o
 * OpenTofu: o resultado chega ao banco pelo worker, e o workspace acompanha
 * pelo estado da execução.
 */

const idParams = z.object({ id: z.uuid() });

const createBody = z.object({
  kind: z.literal("plan"),
  target: RunTargetSchema.default("aws"),
});

function serialize(run: {
  id: string;
  kind: string;
  status: string;
  slug: string;
  params: unknown;
  result: unknown;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: run.id,
    kind: run.kind,
    status: run.status,
    slug: run.slug,
    params: run.params,
    result: run.result,
    error: run.error,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    createdAt: run.createdAt,
  };
}

export const runRoutes: FastifyPluginAsync = async (app) => {
  /** PRD §75 — pede um `tofu plan` da versão corrente. */
  app.post("/architectures/:id/runs", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "dados_invalidos" });

    const body = createBody.safeParse(request.body ?? {});
    if (!body.success) return reply.status(400).send({ error: "dados_invalidos" });

    const architecture = await db.architecture.findFirst({
      where: { id: params.data.id, project: { ownerId: user.id } },
      include: { versions: { orderBy: { number: "desc" }, take: 1 } },
    });
    const latest = architecture?.versions[0];
    if (!architecture || !latest) {
      return reply.status(404).send({ error: "arquitetura_nao_encontrada" });
    }

    // Uma execução por vez por arquitetura: `plan` concorrente sobre o mesmo
    // desenho só gasta tempo e confunde a leitura do workspace.
    const running = await db.run.findFirst({
      where: { architectureId: architecture.id, status: { in: ["QUEUED", "RUNNING"] } },
      select: { id: true },
    });
    if (running) return reply.status(409).send({ error: "execucao_em_andamento" });

    const run = await db.run.create({
      data: {
        architectureId: architecture.id,
        versionId: latest.id,
        kind: "PLAN",
        slug: slugFor("plan"),
        params: RunParamsSchema.parse({ target: body.data.target }),
      },
    });

    try {
      await runQueue.add("run", { runId: run.id });
    } catch {
      // Sem fila não há execução: marcar como falha evita registro pendurado.
      await db.run.update({
        where: { id: run.id },
        data: { status: "FAILED", error: "A fila de execuções está indisponível.", finishedAt: new Date() },
      });
      return reply.status(503).send({ error: "fila_indisponivel" });
    }

    return reply.status(202).send(serialize(run));
  });

  app.get("/architectures/:id/runs", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "dados_invalidos" });

    const runs = await db.run.findMany({
      where: { architectureId: params.data.id, architecture: { project: { ownerId: user.id } } },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    return runs.map(serialize);
  });

  /** Execução completa, com o log do processo externo. */
  app.get("/runs/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "dados_invalidos" });

    const run = await db.run.findFirst({
      where: { id: params.data.id, architecture: { project: { ownerId: user.id } } },
      include: { version: { select: { number: true } } },
    });
    if (!run) return reply.status(404).send({ error: "execucao_nao_encontrada" });

    return { ...serialize(run), version: run.version.number, logs: run.logs };
  });
};
