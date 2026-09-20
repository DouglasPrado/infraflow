import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { hashPassword, verifyPassword } from "../auth/password.ts";
import { createSession, destroySession, readSession } from "../auth/session.ts";
import { db } from "../db.ts";

/**
 * Autenticação por e-mail e senha (PRD §7 — no protótipo era simulada).
 *
 * O botão "Continuar com GitHub" do §7 precisa de um OAuth App registrado, com
 * client id e secret. Enquanto não existirem, a web mostra o botão indisponível
 * em vez de fingir que funciona.
 */

const credentials = z.object({
  email: z.email().max(320).toLowerCase().trim(),
  password: z.string().min(8, "A senha precisa de ao menos 8 caracteres.").max(200),
});

const registration = credentials.extend({
  name: z.string().min(1).max(200).trim(),
});

/**
 * Hash descartável usado quando o e-mail não existe. Sem ele, responder mais
 * rápido para e-mail inexistente revelaria quais e-mails estão cadastrados.
 */
const DUMMY_HASH =
  "65536$8$1$00000000000000000000000000000000$" + "0".repeat(128);

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/auth/register", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (request, reply) => {
    const body = registration.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        error: "dados_invalidos",
        issues: body.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const existing = await db.user.findUnique({ where: { email: body.data.email } });
    if (existing) return reply.status(409).send({ error: "email_em_uso" });

    const user = await db.user.create({
      data: {
        email: body.data.email,
        name: body.data.name,
        passwordHash: await hashPassword(body.data.password),
      },
      select: { id: true, email: true, name: true },
    });

    await createSession(reply, user.id);
    return reply.status(201).send({ user });
  });

  app.post("/auth/login", { config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } }, async (request, reply) => {
    const body = credentials.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: "credenciais_invalidas" });

    const user = await db.user.findUnique({ where: { email: body.data.email } });

    // Verifica mesmo sem usuário, para o tempo de resposta não denunciar
    // se o e-mail existe.
    const ok = await verifyPassword(body.data.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) return reply.status(401).send({ error: "credenciais_invalidas" });

    await createSession(reply, user.id);
    return { user: { id: user.id, email: user.email, name: user.name } };
  });

  app.post("/auth/logout", async (request, reply) => {
    await destroySession(request, reply);
    return { ok: true };
  });

  app.get("/auth/me", async (request, reply) => {
    const user = await readSession(request, reply);
    if (!user) return reply.status(401).send({ error: "nao_autenticado" });
    return { user };
  });
};
