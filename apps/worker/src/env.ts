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
  /**
   * Cache de providers do OpenTofu, compartilhado entre execuções.
   * Sem ele cada `init` rebaixaria o provider inteiro — 766 MB no caso da AWS.
   */
  tofuPluginCache: resolve(process.env.TF_PLUGIN_CACHE_DIR ?? "./var/tofu-plugins"),
  /** Execuções simultâneas. OpenTofu é pesado; o padrão é conservador. */
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),
  /** Teto de tempo de um processo externo. */
  processTimeoutMs: Number(process.env.WORKER_PROCESS_TIMEOUT_MS ?? 10 * 60 * 1000),
};
