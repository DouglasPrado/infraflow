import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { env } from "./env.ts";
import { architectureRoutes } from "./routes/architectures.ts";
import { authRoutes } from "./routes/auth.ts";
import { healthRoutes } from "./routes/health.ts";

/** Instância separada do listen para os testes poderem injetar requisições. */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
  });

  await app.register(cookie);
  // Em desenvolvimento a web fala com a API pelo rewrite do Next, na mesma
  // origem. O CORS com credenciais fica para quem apontar direto para a API.
  await app.register(cors, { origin: env.webOrigin, credentials: true });
  await app.register(rateLimit, { global: false });

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(architectureRoutes);

  return app;
}
