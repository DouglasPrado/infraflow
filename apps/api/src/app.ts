import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { env } from "./env.ts";
import { architectureRoutes } from "./routes/architectures.ts";
import { healthRoutes } from "./routes/health.ts";

/** Instância separada do listen para os testes poderem injetar requisições. */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
  });

  await app.register(cors, { origin: env.webOrigin });
  await app.register(healthRoutes);
  await app.register(architectureRoutes);

  return app;
}
