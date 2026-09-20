import { capacityFor, getCatalogItem, monthlyCostFor } from "@infraflow/registry";
import type { InfraEdge, InfraNode, NodeState } from "./types";

/**
 * Motor de simulação mockado (PRD §20, §21, §61, §67).
 *
 * Nada aqui executa k6 ou lê métricas reais. A capacidade de cada recurso sai da
 * sua **configuração** — instância, réplicas, memória, conexões — pelo modelo do
 * `@infraflow/registry`. É isso que faz trocar a instância do banco mover o
 * gargalo, como o PRD §38 descreve. O resultado é determinístico: a mesma
 * arquitetura configurada do mesmo jeito produz sempre o mesmo gargalo.
 */

/**
 * Degraus de RPS da simulação (PRD §18, §20, §61).
 *
 * Saem do perfil configurado no Load Generator — start, increment e maximum —
 * e não de uma lista fixa. Com a capacidade dependendo da configuração dos
 * recursos, uma escada travada num teto deixaria de medir qualquer arquitetura
 * que crescesse além dele: o teste responderia "breaking point —" justamente
 * para quem acabou de reforçar a infraestrutura.
 */
const MAX_STEPS = 40;

export function ladderFor(profile: {
  startRps: number;
  incrementRps: number;
  maxRps: number;
}): number[] {
  const start = Math.max(1, Math.round(profile.startRps));
  const increment = Math.max(1, Math.round(profile.incrementRps));
  const max = Math.max(start, Math.round(profile.maxRps));

  const steps: number[] = [];
  for (let rps = start; rps <= max && steps.length < MAX_STEPS; rps += increment) {
    steps.push(rps);
  }
  return steps;
}

/** Perfil usado quando não há Load Generator no canvas. */
const DEFAULT_PROFILE = { startRps: 100, incrementRps: 250, maxRps: 5000 };

/** Limiar de utilização a partir do qual o node entra em warning. */
const WARNING_AT = 0.9;

/**
 * Margem de segurança aplicada à estimativa estática, antes de qualquer teste.
 * É deliberadamente conservadora: `Estimated` nunca deve se confundir com
 * `Observed` (PRD §85).
 */
const STATIC_DERATE = 0.45;

export type StepVerdict = "ok" | "warning" | "fail";

export interface NodeReading {
  nodeId: string;
  utilization: number;
  state: NodeState;
}

export interface SimulationStep {
  rps: number;
  verdict: StepVerdict;
  p95Ms: number;
  errorRatePct: number;
  readings: NodeReading[];
  /** Node com maior utilização neste degrau, quando saturado. */
  bottleneckNodeId?: string;
}

export interface BottleneckMetric {
  key: string;
  label: string;
  unit: string;
  value: number;
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

function resourceEntries(nodes: InfraNode[]) {
  return nodes.flatMap((node) => {
    if (node.type !== "resource") return [];
    if (node.data.state === "disabled") return [];
    const item = getCatalogItem(node.data.type);
    if (!item) return [];

    // Resolvido uma vez: a capacidade depende de como o recurso está configurado.
    return [
      {
        id: node.id,
        item,
        capacityRps: capacityFor(item, node.data.props),
        monthlyCostUsd: monthlyCostFor(item, node.data.props),
      },
    ];
  });
}

/**
 * Recursos que recebem carga: os alcançáveis a partir de um Load Generator,
 * seguindo os edges no sentido origem → destino (PRD §21).
 * Sem Load Generator no canvas, considera todos os recursos.
 */
function simulatedNodes(nodes: InfraNode[], edges: InfraEdge[]) {
  const entries = resourceEntries(nodes);
  const origins = nodes.filter((node) => node.type === "loadGenerator").map((node) => node.id);
  if (origins.length === 0) return entries;

  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }

  const reached = new Set<string>();
  const queue = [...origins];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of outgoing.get(current) ?? []) {
      if (reached.has(next)) continue;
      reached.add(next);
      queue.push(next);
    }
  }

  return entries.filter((entry) => reached.has(entry.id));
}

function stateFor(utilization: number, isBottleneck: boolean): NodeState {
  if (isBottleneck) return "bottleneck";
  if (utilization >= 1) return "error";
  if (utilization >= WARNING_AT) return "warning";
  return "running";
}

function readStep(rps: number, nodes: ReturnType<typeof simulatedNodes>): SimulationStep {
  const utilizations = nodes.map((node) => ({
    nodeId: node.id,
    utilization: rps / node.capacityRps,
  }));

  const worst = utilizations.reduce<{ nodeId: string; utilization: number } | undefined>(
    (acc, current) => (!acc || current.utilization > acc.utilization ? current : acc),
    undefined,
  );

  const saturated = worst && worst.utilization >= 1 ? worst : undefined;
  const peak = worst?.utilization ?? 0;

  const verdict: StepVerdict = peak >= 1 ? "fail" : peak >= WARNING_AT ? "warning" : "ok";

  return {
    rps,
    verdict,
    p95Ms: Math.round(70 + 293 * peak ** 2),
    errorRatePct: Math.round(Math.max(0, peak - WARNING_AT) * 8.7 * 10) / 10,
    readings: utilizations.map((reading) => ({
      ...reading,
      state: stateFor(reading.utilization, reading.nodeId === saturated?.nodeId),
    })),
    bottleneckNodeId: saturated?.nodeId,
  };
}

/**
 * Executa a simulação completa e devolve todos os degraus de uma vez.
 * A animação (PRD §61) apenas percorre esse resultado já calculado.
 */
export function simulate(nodes: InfraNode[], edges: InfraEdge[]): SimulationResult {
  void edges;
  const participants = simulatedNodes(nodes, edges);

  if (participants.length === 0) {
    return {
      steps: [],
      maxHealthyRps: 0,
      breakingPointRps: null,
      p95Ms: 0,
      errorRatePct: 0,
      bottleneckMetrics: [],
    };
  }

  // Um teste de capacidade para quando quebra — não continua empilhando carga
  // sobre uma arquitetura que já cedeu.
  const profile =
    nodes.find((node) => node.type === "loadGenerator")?.data.profile ?? DEFAULT_PROFILE;

  const steps: SimulationStep[] = [];
  for (const rps of ladderFor(profile)) {
    const step = readStep(rps, participants);
    steps.push(step);
    if (step.verdict === "fail") break;
  }

  // O recurso de menor capacidade define o teto saudável (PRD §20).
  const bindingCapacity = Math.min(...participants.map((node) => node.capacityRps));
  const maxHealthyRps = Math.round((bindingCapacity * WARNING_AT * 1.0256) / 100) * 100;

  const firstFailure = steps.find((step) => step.verdict === "fail");
  const atHealthyPeak = readStep(maxHealthyRps, participants);

  const bottleneckNodeId =
    firstFailure?.bottleneckNodeId ??
    participants.reduce((acc, node) =>
      node.capacityRps < acc.capacityRps ? node : acc,
    ).id;

  const bottleneck = participants.find((node) => node.id === bottleneckNodeId);
  const bottleneckUtilization = firstFailure
    ? firstFailure.rps / (bottleneck?.capacityRps ?? 1)
    : maxHealthyRps / (bottleneck?.capacityRps ?? 1);

  const bottleneckMetrics: BottleneckMetric[] =
    bottleneck?.item.metrics.map((metric) => ({
      key: metric.key,
      label: metric.label,
      unit: metric.unit,
      value: Math.min(metric.unit === "%" ? 99 : Number.MAX_SAFE_INTEGER, Math.round(bottleneckUtilization * metric.coef)),
    })) ?? [];

  return {
    steps,
    maxHealthyRps,
    breakingPointRps: firstFailure?.rps ?? null,
    p95Ms: atHealthyPeak.p95Ms,
    errorRatePct: atHealthyPeak.errorRatePct,
    bottleneckNodeId,
    bottleneckMetrics,
  };
}

/**
 * Análise estática da arquitetura, sem simulação (PRD §23, §26).
 * Capacidade e custo são estimativas mockadas.
 */
export interface Analysis {
  capacityRps: number;
  monthlyCostUsd: number;
  resourceCount: number;
  warnings: string[];
}

export function analyze(nodes: InfraNode[], edges: InfraEdge[]): Analysis {
  const allResources = resourceEntries(nodes);
  const participants = simulatedNodes(nodes, edges);
  const warnings: string[] = [];

  const connected = new Set<string>();
  for (const edge of edges) {
    connected.add(edge.source);
    connected.add(edge.target);
  }

  for (const node of allResources) {
    if (!connected.has(node.id)) {
      warnings.push(`${node.item.title} não está conectado a nenhum recurso.`);
    }
  }

  const hasLoadGenerator = nodes.some((node) => node.type === "loadGenerator");
  if (!hasLoadGenerator) {
    warnings.push("Nenhum Load Generator definido — a capacidade não pode ser estimada.");
  }

  const capacityRps =
    participants.length === 0
      ? 0
      : Math.round((Math.min(...participants.map((n) => n.capacityRps)) * STATIC_DERATE) / 100) * 100;

  const monthlyCostUsd = allResources.reduce((total, node) => total + node.monthlyCostUsd, 0);

  return {
    capacityRps,
    monthlyCostUsd,
    resourceCount: allResources.length,
    warnings,
  };
}

/** PRD §25 — recomendações mockadas, dependentes da categoria do gargalo. */
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
