import type { VersionComparison } from "@infraflow/analyzer";
import type { PlanSummary } from "@infraflow/schema";

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
  versao_nao_encontrada: "Versão não encontrada.",
  assistente_indisponivel:
    "O assistente precisa de uma credencial da Anthropic configurada na API (ANTHROPIC_API_KEY).",
  assistente_falhou: "O assistente não conseguiu responder. Tente de novo.",
  credencial_ausente: "Configure uma credencial da AWS para ver preço de tabela.",
  credencial_invalida: "A AWS recusou essa credencial.",
  cifra_indisponivel:
    "A API está sem INFRAFLOW_SECRET_KEY, então não pode guardar a credencial cifrada.",
  tabela_indisponivel: "A tabela de preços da AWS não respondeu.",
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
  params: { target: "aws" };
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

/** PRD §38 — uma versão da arquitetura. */
export interface ArchitectureVersion {
  number: number;
  label: string | null;
  createdAt: string;
  updatedAt: string;
  runs: number;
}

/** PRD §81 — o que o assistente pode fazer. */
export type AssistantTask =
  | "explain-architecture"
  | "explain-bottleneck"
  | "suggest-improvements"
  | "explain-tradeoffs"
  | "generate-documentation"
  | "prepare-agent-instructions";

/** PRD §52 — o que a interface pode saber da credencial guardada. */
export interface CredentialView {
  configured: boolean;
  canStore: boolean;
  provider?: string;
  region?: string;
  /** Últimos caracteres do access key id. */
  hint?: string;
  accountId?: string | null;
  verifiedAt?: string | null;
  lastError?: string | null;
  updatedAt?: string;
}

export type CostSource = "priced" | "estimated";

export interface NodePrice {
  nodeId: string;
  name: string;
  type: string;
  monthlyUsd: number;
  source: CostSource;
  breakdown?: { label: string; monthlyUsd: number; sku: string; unitUsd: number }[];
  reason?: string;
}

/** PRD §40 — custo da arquitetura pela tabela da AWS. */
export interface ArchitecturePricing {
  region: string;
  currency: "USD";
  monthlyUsd: number;
  pricedMonthlyUsd: number;
  nodes: NodePrice[];
  at: string;
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

  /** PRD §75, §77 — pede uma execução ao worker. A API só enfileira. */
  createRun: (architectureId: string, kind: "plan", target: "aws" = "aws") =>
    request<RunSummary>(`/architectures/${architectureId}/runs`, {
      method: "POST",
      body: JSON.stringify({ kind, target }),
    }),

  runs: (architectureId: string) => request<RunSummary[]>(`/architectures/${architectureId}/runs`),

  run: (runId: string) => request<RunDetail>(`/runs/${runId}`),

  /** PRD §38 — congela a versão corrente e abre a próxima para trabalho. */
  snapshot: (id: string, label?: string) =>
    request<{ version: number; label: string | null; working: number }>(
      `/architectures/${id}/versions`,
      { method: "POST", body: JSON.stringify({ label }) },
    ),

  versions: (id: string) => request<ArchitectureVersion[]>(`/architectures/${id}/versions`),

  /** PRD §80 — abre uma arquitetura nova a partir de uma versão. */
  clone: (id: string, version?: number) =>
    request<{ id: string; name: string; fromVersion: number }>(`/architectures/${id}/clone`, {
      method: "POST",
      body: JSON.stringify({ version }),
    }),

  /** PRD §52 — credencial de nuvem do projeto. O segredo nunca volta. */
  credential: (architectureId: string) =>
    request<CredentialView>(`/architectures/${architectureId}/credential`),

  saveCredential: (
    architectureId: string,
    body: { region: string; accessKeyId: string; secretAccessKey: string },
  ) =>
    request<CredentialView>(`/architectures/${architectureId}/credential`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  deleteCredential: (architectureId: string) =>
    request<void>(`/architectures/${architectureId}/credential`, { method: "DELETE" }),

  /** PRD §40 — custo pela tabela da AWS. */
  pricing: (architectureId: string) =>
    request<ArchitecturePricing>(`/architectures/${architectureId}/pricing`),

  /** PRD §81 — tarefas do assistente e se ele está utilizável. */
  assistantTasks: () =>
    request<{ available: boolean; tasks: { task: AssistantTask; label: string; description: string }[] }>(
      "/assistant/tasks",
    ),

  ask: (architectureId: string, task: AssistantTask, question?: string) =>
    request<{ task: AssistantTask; text: string; model: string }>(
      `/architectures/${architectureId}/assistant`,
      { method: "POST", body: JSON.stringify({ task, question }) },
    ),

  /** PRD §39 — compara duas versões. */
  compare: (id: string, from: number, to: number) =>
    request<VersionComparison & { from: { number: number; label: string | null }; to: { number: number; label: string | null } }>(
      `/architectures/${id}/compare?from=${from}&to=${to}`,
    ),
};
