import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db.ts";

export const SESSION_COOKIE = "infraflow_session";

/** Trinta dias, renovada em uso para não expulsar quem está trabalhando. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RENEW_WHEN_REMAINING_MS = 15 * 24 * 60 * 60 * 1000;

/** Só o hash entra no banco; o token vive apenas no cookie do navegador. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  };
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export async function createSession(reply: FastifyReply, userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");

  await db.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });

  reply.setCookie(SESSION_COOKIE, token, cookieOptions());
}

export async function destroySession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = request.cookies[SESSION_COOKIE];
  if (token) {
    await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

/** Devolve o usuário da sessão, ou `null`. Sessão vencida é apagada na hora. */
export async function readSession(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<SessionUser | null> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, email: true, name: true } } },
  });

  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => undefined);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return null;
  }

  // Renova passada a metade da validade, para não deslogar no meio do trabalho.
  if (session.expiresAt.getTime() - Date.now() < RENEW_WHEN_REMAINING_MS) {
    await db.session.update({
      where: { id: session.id },
      data: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
    });
    reply.setCookie(SESSION_COOKIE, token, cookieOptions());
  }

  return session.user;
}
