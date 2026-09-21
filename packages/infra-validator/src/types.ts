import type { Category } from "@infraflow/schema";

/**
 * Validação semântica da arquitetura (PRD §72).
 *
 * Distinto da integridade referencial do `@infraflow/schema`: aquela pergunta
 * se o documento é **coerente consigo mesmo** (id que não existe, pai que não é
 * grupo); esta pergunta se a arquitetura **faz sentido** — se a conexão é
 * possível, se falta dependência, se o recurso é alcançável, se há exposição
 * indevida e se ela sobrevive à perda de uma instância.
 *
 * Nada aqui olha para métrica: é análise do desenho, não do comportamento.
 */

export type ValidationSeverity = "error" | "warning";

/** As cinco famílias que o §72 manda detectar. */
export type ValidationCategory =
  | "connection"
  | "dependency"
  | "reachability"
  | "security"
  | "availability";

export interface ValidationIssue {
  code: string;
  category: ValidationCategory;
  severity: ValidationSeverity;
  /** Id do node ou da conexão a que o problema se refere. */
  subjectId: string;
  message: string;
  /** O que fazer a respeito. Vira a recomendação exibida na UI. */
  hint?: string;
}

/** Contagem usada pela UI e pela API para decidir se algo bloqueia. */
export interface ValidationSummary {
  errors: number;
  warnings: number;
  /** `true` quando existe ao menos um `error`. */
  blocking: boolean;
}

/** Recurso do canvas já resolvido contra o registry. */
export interface ResolvedResource {
  id: string;
  type: string;
  name: string;
  properties: Record<string, string | number | boolean>;
  category: Category | undefined;
  title: string;
}
