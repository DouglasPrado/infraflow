/**
 * Cliente da API.
 *
 * No navegador as chamadas passam pelo rewrite `/api` (mesma origem, o cookie
 * de sessão viaja sozinho). No servidor vão direto ao processo da API, levando
 * o cookie recebido na requisição.
 */

export const API_BASE = "/api";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const MESSAGES: Record<string, string> = {
  nao_autenticado: "Sua sessão expirou. Entre novamente.",
  credenciais_invalidas: "E-mail ou senha incorretos.",
  email_em_uso: "Já existe uma conta com esse e-mail.",
  dados_invalidos: "Confira os dados informados.",
  documento_invalido: "O canvas está num estado que a API não aceita.",
  documento_incoerente: "O canvas tem conexões inválidas e não foi salvo.",
  arquitetura_nao_encontrada: "Arquitetura não encontrada.",
};

interface ErrorBody {
  error?: string;
  issues?: { path: string; message: string }[];
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    let body: ErrorBody = {};
    try {
      body = (await response.json()) as ErrorBody;
    } catch {
      // resposta sem corpo JSON — cai na mensagem genérica
    }

    const code = body.error ?? "erro_desconhecido";
    const detail = body.issues?.[0]?.message;
    throw new ApiError(
      response.status,
      code,
      MESSAGES[code] ?? detail ?? "Não foi possível completar a operação.",
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ user: SessionUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  register: (name: string, email: string, password: string) =>
    request<{ user: SessionUser }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password }),
    }),

  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),

  me: () => request<{ user: SessionUser }>("/auth/me"),

  /** Devolve a arquitetura de trabalho, criando-a na primeira vez. */
  workspace: (document: unknown) =>
    request<{ architectureId: string; created: boolean }>("/me/workspace", {
      method: "POST",
      body: JSON.stringify({ document }),
    }),

  architecture: (id: string) =>
    request<{ id: string; version: number; updatedAt: string; document: unknown }>(
      `/architectures/${id}`,
    ),

  save: (id: string, document: unknown) =>
    request<{ id: string; version: number; updatedAt: string }>(`/architectures/${id}`, {
      method: "PUT",
      body: JSON.stringify({ document }),
    }),

  /** PRD §73, §74 — artefato gerado da versão gravada, em texto. */
  artifact: async (id: string, kind: "reports" | "opentofu", file: string): Promise<string> => {
    const response = await fetch(`${API_BASE}/architectures/${id}/${kind}/${file}`, {
      credentials: "same-origin",
    });
    if (!response.ok) {
      throw new ApiError(response.status, "artefato_indisponivel", "Não foi possível gerar o artefato.");
    }
    return response.text();
  },

  snapshot: (id: string, label?: string) =>
    request<{ version: number; label: string | null }>(`/architectures/${id}/versions`, {
      method: "POST",
      body: JSON.stringify({ label }),
    }),
};
