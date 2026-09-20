import type { Category, Provider } from "@infraflow/schema";

/**
 * Registry de componentes (PRD §42).
 *
 * Este pacote é **livre de UI**: a API e os workers precisam dele para compilar
 * OpenTofu e estimar capacidade, e nenhum dos dois pode importar React. Por isso
 * o ícone é um identificador, resolvido para um componente só na camada visual.
 */

/** Campo exibido pelo Properties Panel (PRD §14, §59). */
export type PropertyField =
  | { key: string; label: string; kind: "text"; placeholder?: string }
  | {
      key: string;
      label: string;
      kind: "number";
      unit?: string;
      min?: number;
      max?: number;
      step?: number;
    }
  | { key: string; label: string; kind: "select"; options: string[] }
  | { key: string; label: string; kind: "switch" };

/**
 * Métrica mockada do recurso (PRD §24, §37).
 * `valor = min(teto, round(utilização * coef))`.
 */
export interface MetricProfile {
  key: string;
  label: string;
  unit: string;
  coef: number;
}

export interface CatalogItem {
  /** Identificador do tipo, no formato `provider.recurso` (PRD §44). */
  type: string;
  /** Rótulo curto, usado na library. */
  name: string;
  /** Rótulo completo, usado no node e no Properties Panel. */
  title: string;
  category: Category;
  provider: Provider;
  /** Identificador do ícone. A web mapeia para um componente Lucide. */
  icon: string;
  /** Valores aplicados ao criar o node (PRD §11). */
  defaults: Record<string, string | number | boolean>;
  properties: PropertyField[];
  /** Chaves de `properties` mostradas no corpo compacto do node (PRD §12). */
  summaryKeys: string[];
  /** Capacidade mockada em req/s — alimenta a simulação (PRD §21, §61). */
  capacityRps: number;
  /** Custo mensal mockado em USD (PRD §40). */
  monthlyCostUsd: number;
  metrics: MetricProfile[];
  /** Tipo alternativo equivalente (PRD §29, §45). */
  alternative?: string;
}
