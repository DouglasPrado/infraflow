import { evaluate, maxHealthyRps } from "./engine.ts";
import type { Graph, LoadPoint, LoadProfile, NodeLoad, Slo } from "./types.ts";

/**
 * Execução completa do teste de capacidade (PRD §18, §20, §61).
 *
 * A escada sai do perfil configurado e para no primeiro degrau que viola o SLO —
 * é o que um teste de capacidade faz de verdade: não se continua empilhando
 * carga sobre uma arquitetura que já cedeu.
 */

const MAX_STEPS = 40;

export function ladderFor(profile: LoadProfile): number[] {
  const start = Math.max(1, Math.round(profile.startRps));
  const increment = Math.max(1, Math.round(profile.incrementRps));
  const max = Math.max(start, Math.round(profile.maxRps));

  const steps: number[] = [];
  for (let rps = start; rps <= max && steps.length < MAX_STEPS; rps += increment) {
    steps.push(rps);
  }
  return steps;
}

/** Métrica exibida no painel de gargalo (PRD §24). */
export interface BottleneckMetric {
  key: string;
  label: string;
  unit: string;
  value: number;
}

export interface CapacityRun {
  steps: LoadPoint[];
  /** Maior carga que cumpre o SLO (PRD §19, §20). */
  maxHealthyRps: number;
  /** Primeiro degrau que viola o SLO, se algum violar. */
  breakingPointRps: number | null;
  /** Latência e erro no ponto saudável máximo. */
  p95Ms: number;
  errorRatePct: number;
  bottleneckNodeId?: string;
  bottleneckMetrics: BottleneckMetric[];
}

/**
 * Métricas do gargalo, derivadas do próprio modelo — não de coeficientes
 * escolhidos para bater com um exemplo.
 */
function metricsFor(load: NodeLoad, concurrencyLimit: number | undefined): BottleneckMetric[] {
  const metrics: BottleneckMetric[] = [
    {
      key: "saturation",
      label: "Saturação",
      unit: "%",
      value: Math.min(999, Math.round(load.utilization * 100)),
    },
  ];

  if (concurrencyLimit && concurrencyLimit > 0) {
    metrics.push({
      key: "concurrency",
      label: "Simultâneas",
      unit: "%",
      // Lei de Little: quantas conexões o recurso mantém abertas nesta carga.
      value: Math.min(999, Math.round((load.concurrency / concurrencyLimit) * 100)),
    });
  }

  metrics.push({
    key: "latency",
    label: "Latência",
    unit: "ms",
    value: Math.round(load.latencyMs),
  });

  return metrics;
}

export function runCapacityTest(graph: Graph, profile: LoadProfile, slo: Slo): CapacityRun {
  if (graph.nodes.length === 0 || graph.origins.length === 0) {
    return {
      steps: [],
      maxHealthyRps: 0,
      breakingPointRps: null,
      p95Ms: 0,
      errorRatePct: 0,
      bottleneckMetrics: [],
    };
  }

  const steps: LoadPoint[] = [];
  for (const rps of ladderFor(profile)) {
    const point = evaluate(graph, rps, slo);
    steps.push(point);
    if (point.verdict === "fail") break;
  }

  const healthy = maxHealthyRps(graph, slo, profile.maxRps);
  const atHealthy = evaluate(graph, Math.max(1, healthy), slo);
  const breaking = steps.find((step) => step.verdict === "fail")?.offeredRps ?? null;

  // O gargalo é quem limita: mede-se no ponto de ruptura quando existe, senão
  // no teto saudável.
  const reference = evaluate(graph, breaking ?? Math.max(1, healthy), slo);
  const bottleneckId = reference.bottleneckNodeId;
  const bottleneckLoad = reference.nodes.find((load) => load.nodeId === bottleneckId);
  const bottleneckNode = graph.nodes.find((node) => node.id === bottleneckId);

  return {
    steps,
    maxHealthyRps: healthy,
    breakingPointRps: breaking,
    p95Ms: Math.round(atHealthy.p95Ms),
    errorRatePct: Math.round(atHealthy.errorRatePct * 10) / 10,
    bottleneckNodeId: bottleneckId,
    bottleneckMetrics: bottleneckLoad
      ? metricsFor(bottleneckLoad, bottleneckNode?.concurrencyLimit)
      : [],
  };
}
