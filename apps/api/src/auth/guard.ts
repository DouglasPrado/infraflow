import type { FastifyReply, FastifyRequest } from "fastify";
import { readSession, type SessionUser } from "./session.ts";

/**
 * Devolve o usuário da sessão ou responde 401 e devolve `null`.
 * Quem chama deve retornar imediatamente quando vier `null`.
 */
export async function requireUser(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<SessionUser | null> {
  const user = await readSession(request, reply);
  if (!user) {
    await reply.status(401).send({ error: "nao_autenticado" });
    return null;
  }
  return user;
}
