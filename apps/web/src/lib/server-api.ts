import { cookies } from "next/headers";

/**
 * Chamadas feitas no servidor vão direto ao processo da API, sem passar pelo
 * rewrite, levando o cookie de sessão da requisição atual.
 */
const API_URL = process.env.API_URL ?? "http://127.0.0.1:3333";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

async function serverRequest<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  const store = await cookies();
  const cookieHeader = store
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");

  try {
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    // API fora do ar: tratado como não autenticado, a tela decide o que fazer.
    return null;
  }
}

export function getSessionUser() {
  return serverRequest<{ user: SessionUser }>("/auth/me");
}

export function getArchitecture(id: string) {
  return serverRequest<{ id: string; version: number; updatedAt: string; document: unknown }>(
    `/architectures/${id}`,
  );
}

/** Resolve a arquitetura de trabalho do usuário, criando-a na primeira vez. */
export function resolveWorkspace(document: unknown) {
  return serverRequest<{ architectureId: string; created: boolean }>("/me/workspace", {
    method: "POST",
    body: JSON.stringify({ document }),
  });
}
