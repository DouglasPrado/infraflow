import type { Node, Edge } from "@xyflow/react";
import type { EdgeKind, PropertyValue, WorkloadEndpoint } from "@infraflow/schema";

/**
 * View-models do canvas.
 *
 * O vocabulário do domínio vive em `@infraflow/schema` e o catálogo em
 * `@infraflow/registry`. Este módulo guarda apenas a forma que o React Flow
 * precisa — e reexporta o vocabulário compartilhado por conveniência.
 */
export type {
  Category,
  EdgeKind,
  HttpMethod,
  LoadProfileType,
  Provider,
  PropertyValue,
  WorkloadEndpoint,
} from "@infraflow/schema";
export type { CatalogItem, MetricProfile, PropertyField } from "@infraflow/registry";

/** PRD §12 — estados do node. `selected` é visual e vem do React Flow. */
export type NodeState =
  | "default"
  | "healthy"
  | "running"
  | "warning"
  | "error"
  | "bottleneck"
  | "disabled";

export interface ResourceNodeData extends Record<string, unknown> {
  type: string;
  name: string;
  props: Record<string, PropertyValue>;
  state: NodeState;
  /** Preenchido durante a simulação. */
  utilization?: number;
  rps?: number;
}

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
    type: import("@infraflow/schema").LoadProfileType;
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

/** PRD §27 — elementos visuais que não representam infraestrutura. */
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

export interface InfraEdgeData extends Record<string, unknown> {
  kind: EdgeKind;
  /** PRD §22 — métrica ao vivo, simulada. */
  rps?: number;
}

export type InfraEdge = Edge<InfraEdgeData>;
