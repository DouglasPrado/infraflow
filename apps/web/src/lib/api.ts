import type { LabContainer, PlanSummary } from "@infraflow/schema";

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
  execucao_em_andamento: "Já existe uma execução em andamento para esta arquitetura.",
  fila_indisponivel: "A fila de execuções está fora do ar. Suba o Redis e o worker.",
  execucao_nao_encontrada: "Execução não encontrada.",
  laboratorio_em_andamento: "Já existe um laboratório vivo para esta arquitetura.",
  laboratorio_nao_encontrado: "Laboratório não encontrado.",
  laboratorio_ja_destruido: "Este laboratório já foi destruído.",
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

export type RunStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";

/** Espelha o que a API devolve em `/runs` (PRD §75). */
export interface RunSummary {
  id: string;
  kind: string;
  status: RunStatus;
  slug: string;
  params: { target: "aws" | "docker" };
  result: PlanSummary | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface RunDetail extends RunSummary {
  version: number;
  logs: string;
}

export type LabStatus = "CREATING" | "READY" | "DESTROYING" | "DESTROYED" | "FAILED";

/** PRD §76 — infraestrutura temporária de um teste. */
export interface Lab {
  id: string;
  slug: string;
  status: LabStatus;
  entryUrl: string | null;
  entryPort: number | null;
  containers: LabContainer[];
  error: string | null;
  expiresAt: string;
  readyAt: string | null;
  destroyedAt: string | null;
  createdAt: string;
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

  /** PRD §75 — pede uma execução ao worker. A API só enfileira. */
  createRun: (architectureId: string, target: "aws" | "docker") =>
    request<RunSummary>(`/architectures/${architectureId}/runs`, {
      method: "POST",
      body: JSON.stringify({ kind: "plan", target }),
    }),

  runs: (architectureId: string) => request<RunSummary[]>(`/architectures/${architectureId}/runs`),

  run: (runId: string) => request<RunDetail>(`/runs/${runId}`),

  /** PRD §76 — cria a infraestrutura temporária. O worker é quem aplica. */
  createLab: (architectureId: string) =>
    request<Lab & { runId: string }>(`/architectures/${architectureId}/labs`, { method: "POST" }),

  labs: (architectureId: string) => request<Lab[]>(`/architectures/${architectureId}/labs`),

  /** PRD §54 — o que sobe tem que descer. */
  destroyLab: (labId: string) =>
    request<{ runId: string }>(`/labs/${labId}`, { method: "DELETE" }),

  snapshot: (id: string, label?: string) =>
    request<{ version: number; label: string | null }>(`/architectures/${id}/versions`, {
      method: "POST",
      body: JSON.stringify({ label }),
    }),
};
