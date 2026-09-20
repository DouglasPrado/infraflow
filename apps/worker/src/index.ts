import { RUN_QUEUE, RunJobSchema } from "@infraflow/schema";
import { Worker } from "bullmq";
import { db } from "./db.ts";
import { env } from "./env.ts";
import { runPlan } from "./runs/plan.ts";

/**
 * Worker de execuções (PRD §51).
 *
 * Processo separado da API de propósito: aqui roda OpenTofu — e, adiante, k6 —,
 * que são pesados, demorados e falham. "Nunca executar testes pesados
 * diretamente no servidor da API" é literal no §51.
 */

const KINDS = {
  PLAN: runPlan,
} as const;

const worker = new Worker(
  RUN_QUEUE,
  async (job) => {
    const { runId } = RunJobSchema.parse(job.data);

    const run = await db.run.findUnique({ where: { id: runId }, select: { kind: true } });
    if (!run) throw new Error(`Execução desconhecida: ${runId}`);

    await KINDS[run.kind](runId);
  },
  {
    connection: { url: env.redisUrl },
    concurrency: env.concurrency,
  },
);

worker.on("failed", (job, cause) => {
  console.error(`[worker] job ${job?.id ?? "?"} falhou:`, cause.message);
});

worker.on("ready", () => {
  console.log(`[worker] ouvindo "${RUN_QUEUE}" · ${env.concurrency} execuções simultâneas`);
  console.log(`[worker] diretório de execuções: ${env.runsRoot}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[worker] ${signal} recebido; encerrando após as execuções em curso.`);
  await worker.close();
  await db.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
