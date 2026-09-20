import type { FastifyPluginAsync } from "fastify";
import { db } from "../db.ts";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async (_request, reply) => {
    try {
      await db.$queryRaw`select 1`;
      return { status: "ok", database: "up" };
    } catch {
      return reply.status(503).send({ status: "degraded", database: "down" });
    }
  });
};
