import { RUN_QUEUE, type RunJob } from "@infraflow/schema";
import { Queue } from "bullmq";
import { env } from "./env.ts";

/**
 * A ponta da API na fila (PRD §50, §51).
 *
 * A API **enfileira e nada mais**. Quem roda OpenTofu e k6 é o worker: o §51
 * é explícito em não executar teste pesado no servidor que atende requisição.
 */
const queue = new Queue<RunJob>(RUN_QUEUE, {
  connection: { url: env.redisUrl },
  defaultJobOptions: {
    // Execução que falha é resultado, não erro de entrega: o motivo já foi
    // gravado na própria execução, e repetir sozinho só gastaria nuvem.
    attempts: 1,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 100 },
  },
});

export const runQueue = queue;

/**
 * Encerra a conexão com o Redis.
 *
 * Ligado ao ciclo de vida da aplicação: sem isto, um processo que só criou a
 * app — um teste, por exemplo — ficaria pendurado numa conexão aberta.
 */
export async function closeQueue(): Promise<void> {
  await queue.close();
}
