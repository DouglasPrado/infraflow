import {
  PLANNING_HEADROOM,
  plannedCapacityRps,
  runCapacityTest,
  type BottleneckMetric,
  type Graph,
  type LoadPoint,
  type Slo,
} from "@infraflow/analyzer";
import {
  capacityFor,
  cacheHitRatioFor,
  getCatalogItem,
  monthlyCostFor,
  serviceTimeFor,
} from "@infraflow/registry";
import type { InfraEdge, InfraNode, NodeState } from "./types";

/**
 * Ponte entre o canvas e o motor de análise.
 *
 * A lógica de capacidade vive em `@infraflow/analyzer` — propagação de tráfego,
 * teoria de filas e capacidade definida pelo SLO. Aqui só se traduz o canvas
 * para a entrada do motor e o resultado para o que a interface exibe.
 */

export type { BottleneckMetric };
export type StepVerdict = LoadPoint["verdict"];

export interface NodeReading {
  nodeId: string;
  utilization: number;
  state: NodeState;
}

export interface EdgeReading {
  source: string;
  target: string;
  rps: number;
}

export interface SimulationStep {
  rps: number;
  verdict: StepVerdict;
  p95Ms: number;
  errorRatePct: number;
  readings: NodeReading[];
  /** PRD §22 — cada trecho carrega a sua vazão, não a carga total. */
  edgeReadings: EdgeReading[];
  bottleneckNodeId?: string;
}

export interface SimulationResult {
  steps: SimulationStep[];
  maxHealthyRps: number;
  breakingPointRps: number | null;
  p95Ms: number;
  errorRatePct: number;
  bottleneckNodeId?: string;
  bottleneckMetrics: BottleneckMetric[];
}

/** SLO usado quando não há Load Generator no canvas (PRD §19). */
const DEFAULT_SLO: Slo = { p95Ms: 500, p99Ms: 1000, errorRatePct: 1 };
const DEFAULT_PROFILE = { startRps: 100, incrementRps: 250, maxRps: 5000 };

const loadGeneratorOf = (nodes: InfraNode[]) =>
  nodes.find((node) => node.type === "loadGenerator");

/** Traduz o canvas para a entrada do motor. */
function toGraph(nodes: InfraNode[], edges: InfraEdge[]): Graph {
  const analyzed = nodes.flatMap((node) => {
    if (node.type !== "resource" || node.data.state === "disabled") return [];
    const item = getCatalogItem(node.data.type);
    if (!item) return [];

    const props = node.data.props;
    const limit = props.maxConnections ?? props.concurrency;

    return [
      {
        id: node.id,
        type: node.data.type,
        capacityRps: capacityFor(item, props),
        serviceTimeMs: serviceTimeFor(item, props),
        cacheHitRatio: cacheHitRatioFor(item, props),
        ...(typeof limit === "number" ? { concurrencyLimit: limit } : {}),
      },
    ];
  });

  const known = new Set(analyzed.map((node) => node.id));
  const origins = nodes.filter((node) => node.type === "loadGenerator").map((node) => node.id);
  const reachable = new Set(origins);

  return {
    origins,
    nodes: analyzed,
    edges: edges.filter(
      (edge) =>
        (known.has(edge.source) || reachable.has(edge.source)) && known.has(edge.target),
    ),
  };
}

/** Utilização → estado visual do node (PRD §12, §21). */
function stateFor(utilization: number, isBottleneck: boolean): NodeState {
  if (isBottleneck && utilization >= 1) return "bottleneck";
  if (utilization >= 1) return "error";
  if (utilization >= 0.85) return "warning";
  return "running";
}

export function simulate(nodes: InfraNode[], edges: InfraEdge[]): SimulationResult {
  const generator = loadGeneratorOf(nodes);
  const profile = generator?.data.profile ?? DEFAULT_PROFILE;
  const slo = generator?.data.slo ?? DEFAULT_SLO;

  const run = runCapacityTest(toGraph(nodes, edges), profile, slo);

  return {
    maxHealthyRps: run.maxHealthyRps,
    breakingPointRps: run.breakingPointRps,
    p95Ms: run.p95Ms,
    errorRatePct: run.errorRatePct,
    bottleneckNodeId: run.bottleneckNodeId,
    bottleneckMetrics: run.bottleneckMetrics,
    steps: run.steps.map((step) => ({
      rps: step.offeredRps,
      verdict: step.verdict,
      p95Ms: Math.round(step.p95Ms),
      errorRatePct: Math.round(step.errorRatePct * 10) / 10,
      bottleneckNodeId: step.bottleneckNodeId,
      edgeReadings: step.edges.map((flow) => ({
        source: flow.source,
        target: flow.target,
        rps: Math.round(flow.rps),
      })),
      readings: step.nodes.map((load) => ({
        nodeId: load.nodeId,
        utilization: load.utilization,
        state: stateFor(load.utilization, load.nodeId === step.bottleneckNodeId),
      })),
    })),
  };
}

/**
 * PRD §23, §26 — leitura estática, antes de qualquer teste.
 *
 * Só números. O julgamento da arquitetura — conexão inválida, dependência
 * faltando, exposição, ponto único de falha — é do `@infraflow/validator`
 * (PRD §72), não daqui.
 */
export interface Analysis {
  capacityRps: number;
  monthlyCostUsd: number;
  resourceCount: number;
}

export function analyze(nodes: InfraNode[], edges: InfraEdge[]): Analysis {
  const generator = loadGeneratorOf(nodes);
  const slo = generator?.data.slo ?? DEFAULT_SLO;
  const ceiling = generator?.data.profile.maxRps ?? DEFAULT_PROFILE.maxRps;

  let monthlyCostUsd = 0;
  let resourceCount = 0;

  for (const node of nodes) {
    if (node.type !== "resource") continue;
    const item = getCatalogItem(node.data.type);
    if (!item) continue;

    resourceCount += 1;
    monthlyCostUsd += monthlyCostFor(item, node.data.props);
  }

  return {
    // Planejamento guarda folga; o teste vai até o limite (PRD §85).
    capacityRps: plannedCapacityRps(toGraph(nodes, edges), slo, ceiling),
    monthlyCostUsd,
    resourceCount,
  };
}

export { PLANNING_HEADROOM };

/** PRD §25 — recomendações conforme a categoria do gargalo. */
export function recommendationsFor(type: string | undefined): string[] {
  const item = type ? getCatalogItem(type) : undefined;
  switch (item?.category) {
    case "database":
      return [
        "Upgrade database instance",
        "Enable connection pooling",
        "Add read replica",
        "Review expensive queries",
      ];
    case "compute":
      return [
        "Increase maximum replicas",
        "Raise CPU per task",
        "Review autoscaling thresholds",
        "Profile slow endpoints",
      ];
    case "cache":
      return ["Increase cache memory", "Review eviction policy", "Add cache cluster nodes"];
    case "network":
      return ["Review idle timeout", "Enable compression", "Add edge caching"];
    case "queue":
      return ["Increase consumer concurrency", "Add partitions", "Review prefetch"];
    default:
      return ["Revisar a arquitetura antes de aumentar a carga"];
  }
}
