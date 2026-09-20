import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return value;
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  port: Number(process.env.PORT ?? 3333),
  host: process.env.HOST ?? "127.0.0.1",
  /** Origem da web, para o CORS do autosave. */
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  /** Fila que leva as execuções ao worker (PRD §50, §51). */
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6381",
  /**
   * Validade inicial de um laboratório (PRD §54). O worker renova quando o
   * ambiente fica pronto; este valor só cobre a criação.
   */
  labTtlMs: Number(process.env.INFRAFLOW_LAB_TTL_MS ?? 60 * 60 * 1000),
};
