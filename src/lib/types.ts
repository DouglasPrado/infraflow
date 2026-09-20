import type { Node, Edge } from "@xyflow/react";
import type { LucideIcon } from "lucide-react";

/** PRD §43 — categorias do registry. */
export type Category =
  | "compute"
  | "database"
  | "cache"
  | "storage"
  | "network"
  | "queue"
  | "observability"
  | "testing"
  | "external"
  | "generic";

/** PRD §44 — provider do recurso. */
export type Provider = "aws" | "opensource";

/** PRD §12 — estados do node. `selected` é visual e vem do React Flow. */
export type NodeState =
  | "default"
  | "healthy"
  | "running"
  | "warning"
  | "error"
  | "bottleneck"
  | "disabled";

export type PropertyValue = string | number | boolean;

/** Schema de propriedade usado pelo Properties Panel (PRD §14, §59). */
export type PropertyField =
  | { key: string; label: string; kind: "text"; placeholder?: string }
  | { key: string; label: string; kind: "number"; unit?: string; min?: number; max?: number; step?: number }
  | { key: string; label: string; kind: "select"; options: string[] }
  | { key: string; label: string; kind: "switch" };

/**
 * Coeficiente de métrica mockada (PRD §24, §37).
 * `value = min(99, round(utilização * coef))`.
 */
export interface MetricProfile {
  key: string;
  label: string;
  unit: string;
  coef: number;
}

/** Item do catálogo de componentes (PRD §10, §42 — versão mockada do protótipo). */
export interface CatalogItem {
  /** Identificador do tipo, no formato `provider.recurso` (PRD §44). */
  type: string;
  /** Rótulo curto usado na library. */
  name: string;
  /** Rótulo completo exibido no node e no Properties Panel. */
  title: string;
  category: Category;
  provider: Provider;
  icon: LucideIcon;
  /** Valores padrão aplicados ao criar o node (PRD §11). */
  defaults: Record<string, PropertyValue>;
  properties: PropertyField[];
  /** Chaves de `props` mostradas no corpo compacto do node (PRD §12). */
  summaryKeys: string[];
  /** Capacidade mockada em req/s — alimenta a simulação (PRD §21, §61). */
  capacityRps: number;
  /** Custo mensal mockado em USD (PRD §40). */
  monthlyCostUsd: number;
  metrics: MetricProfile[];
  /** Tipo alternativo equivalente (PRD §29, §45). */
  alternative?: string;
}

/** Dados de um node de recurso no canvas. */
export interface ResourceNodeData extends Record<string, unknown> {
  type: string;
  name: string;
  props: Record<string, PropertyValue>;
  state: NodeState;
  /** Preenchido durante a simulação. */
  utilization?: number;
  rps?: number;
}

/** PRD §17 — endpoint do workload. */
export interface WorkloadEndpoint {
  id: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  weight: number;
}

/** PRD §18 — perfis de carga. */
export type LoadProfileType =
  | "Smoke"
  | "Constant"
  | "Ramp"
  | "Capacity"
  | "Spike"
  | "Stress"
  | "Soak";

/** PRD §15–§19 — node especial Load Generator. */
export interface LoadGeneratorNodeData extends Record<string, unknown> {
  name: string;
  target: {
    protocol: string;
    baseUrl: string;
    headers: string;
    authentication: string;
    timeoutMs: number;
  };
  endpoints: WorkloadEndpoint[];
  profile: {
    type: LoadProfileType;
    startRps: number;
    incrementRps: number;
    intervalSeconds: number;
    maxRps: number;
  };
  slo: {
    p95Ms: number;
    p99Ms: number;
    errorRatePct: number;
  };
  state: NodeState;
  rps?: number;
}

/** PRD §27 — elementos visuais não executáveis. */
export interface NoteNodeData extends Record<string, unknown> {
  text: string;
  variant: "sticky" | "text";
}

/** PRD §28 — agrupamento de recursos. */
export interface GroupNodeData extends Record<string, unknown> {
  label: string;
}

export type InfraNode =
  | Node<ResourceNodeData, "resource">
  | Node<LoadGeneratorNodeData, "loadGenerator">
  | Node<NoteNodeData, "note">
  | Node<GroupNodeData, "group">;

/** PRD §13 — tipo de tráfego que o edge carrega. */
export type EdgeKind = "HTTP" | "TCP" | "Database" | "Queue" | "Storage";

export interface InfraEdgeData extends Record<string, unknown> {
  kind: EdgeKind;
  /** PRD §22 — métrica ao vivo, simulada. */
  rps?: number;
}

export type InfraEdge = Edge<InfraEdgeData>;
