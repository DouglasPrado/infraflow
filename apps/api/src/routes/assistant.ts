import { ArchitectureDocumentSchema, LoadTestObservationSchema, PlanSummarySchema } from "@infraflow/schema";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { claudeTransport, isConfigured, type AssistantTransport } from "../assistant/claude.ts";
import { buildContext } from "../assistant/context.ts";
import { ASSISTANT_TASKS, TASKS } from "../assistant/tasks.ts";
import { requireUser } from "../auth/guard.ts";
import { db } from "../db.ts";

/**
 * Assistente (PRD §81).
 *
 * "Somente depois do motor determinístico funcionar" não é só ordem de
 * construção: é de onde vêm os dados. O assistente não olha para o canvas — ele
 * lê o que o sistema já concluiu sobre a arquitetura e explica isso.
 */

const idParams = z.object({ id: z.uuid() });

const askBody = z.object({
  task: z.enum(ASSISTANT_TASKS),
  question: z.string().max(2000).optional(),
});

/** O transporte é injetável para o teste não depender de credencial. */
export interface AssistantOptions {
  transport?: AssistantTransport;
}

export function assistantRoutes(options: AssistantOptions = {}): FastifyPluginAsync {
  return async (app) => {
    /** As tarefas do §81 e se o assistente está utilizável. */
    app.get("/assistant/tasks", async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;

      return {
        available: options.transport !== undefined || isConfigured(),
        tasks: ASSISTANT_TASKS.map((task) => ({
          task,
          label: TASKS[task].label,
          description: TASKS[task].description,
        })),
      };
    });

    app.post("/architectures/:id/assistant", async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;

      const params = idParams.safeParse(request.params);
      if (!params.success) return reply.status(400).send({ error: "dados_invalidos" });

      const body = askBody.safeParse(request.body ?? {});
      if (!body.success) return reply.status(400).send({ error: "dados_invalidos" });

      const transport = options.transport ?? (isConfigured() ? claudeTransport() : null);
      if (!transport) {
        // Sem credencial não há assistente. Dizer isso é melhor do que devolver
        // texto genérico que não vem de lugar nenhum.
        return reply.status(503).send({ error: "assistente_indisponivel" });
      }

      const architecture = await db.architecture.findFirst({
        where: { id: params.data.id, project: { ownerId: user.id } },
        include: { versions: { orderBy: { number: "desc" }, take: 1 } },
      });
      const latest = architecture?.versions[0];
      if (!architecture || !latest) {
        return reply.status(404).send({ error: "arquitetura_nao_encontrada" });
      }

      const document = ArchitectureDocumentSchema.safeParse(latest.graph);
      if (!document.success) return reply.status(500).send({ error: "documento_invalido" });

      // Tudo o que o sistema já apurou sobre esta arquitetura.
      const [planRun, lab, loadRun] = await Promise.all([
        db.run.findFirst({
          where: { architectureId: architecture.id, kind: "PLAN", status: "SUCCEEDED" },
          orderBy: { finishedAt: "desc" },
          select: { slug: true, result: true },
        }),
        db.lab.findFirst({
          where: { architectureId: architecture.id, status: { not: "DESTROYED" } },
          orderBy: { createdAt: "desc" },
          select: { slug: true, status: true, entryUrl: true },
        }),
        db.run.findFirst({
          where: { architectureId: architecture.id, kind: "LOAD_TEST", status: "SUCCEEDED" },
          orderBy: { finishedAt: "desc" },
          select: { slug: true, result: true },
        }),
      ]);

      const plan = planRun ? PlanSummarySchema.safeParse(planRun.result) : undefined;
      const observation = loadRun ? LoadTestObservationSchema.safeParse(loadRun.result) : undefined;

      const context = buildContext({
        document: document.data,
        version: latest.number,
        ...(plan?.success && planRun ? { plan: { runId: planRun.slug, summary: plan.data } } : {}),
        ...(lab ? { lab } : {}),
        ...(observation?.success && loadRun
          ? { observation: { runId: loadRun.slug, observation: observation.data } }
          : {}),
      });

      try {
        const answer = await transport({
          task: body.data.task,
          context,
          ...(body.data.question ? { question: body.data.question } : {}),
        });

        return { task: body.data.task, ...answer };
      } catch (cause) {
        app.log.error(cause);
        return reply.status(502).send({ error: "assistente_falhou" });
      }
    });
  };
}
