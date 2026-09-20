import "dotenv/config";
import { resolve } from "node:path";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return value;
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6381",
  /** Raiz dos diretórios de execução — um por run (PRD §52, §53). */
  runsRoot: resolve(process.env.INFRAFLOW_RUNS_ROOT ?? "./var/runs"),
  /** Raiz dos laboratórios. Separada das execuções: o state persiste (§76). */
  labsRoot: resolve(process.env.INFRAFLOW_LABS_ROOT ?? "./var/labs"),
  /** Faixa de portas publicadas pelos laboratórios em 127.0.0.1. */
  labPortRange: [
    Number(process.env.INFRAFLOW_LAB_PORT_MIN ?? 18100),
    Number(process.env.INFRAFLOW_LAB_PORT_MAX ?? 18300),
  ] as [number, number],
  /** Tempo de vida de um laboratório antes de o worker derrubá-lo (§54). */
  labTtlMs: Number(process.env.INFRAFLOW_LAB_TTL_MS ?? 60 * 60 * 1000),
  /** Espera máxima até o laboratório responder (§76 — "Ready"). */
  labReadyTimeoutMs: Number(process.env.INFRAFLOW_LAB_READY_TIMEOUT_MS ?? 180_000),
  /**
   * Cache de providers do OpenTofu, compartilhado entre execuções.
   * Sem ele cada `init` rebaixaria o provider inteiro — 766 MB no caso da AWS.
   */
  tofuPluginCache: resolve(process.env.TF_PLUGIN_CACHE_DIR ?? "./var/tofu-plugins"),
  /** Execuções simultâneas. OpenTofu e k6 são pesados; o padrão é conservador. */
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),
  /** Teto de tempo de um processo externo. */
  processTimeoutMs: Number(process.env.WORKER_PROCESS_TIMEOUT_MS ?? 10 * 60 * 1000),
};
