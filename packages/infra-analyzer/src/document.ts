import {
  cacheHitRatioFor,
  capacityFor,
  getCatalogItem,
  monthlyCostFor,
  serviceTimeFor,
} from "@infraflow/registry";
import {
  isLoadGeneratorNode,
  isResourceNode,
  type ArchitectureDocument,
} from "@infraflow/schema";
import { plannedCapacityRps } from "./engine.ts";
import { runCapacityTest, type CapacityRun } from "./run.ts";
import type { AnalyzerNode, Graph, LoadProfile, Slo } from "./types.ts";

/**
 * Do documento do canvas para a entrada do motor.
 *
 * Esta tradução precisa existir **uma vez só**. A web mostra a capacidade na
 * status bar, a API a escreve no CAPACITY.md e o worker a compara com a medição
 * do teste real — se cada um traduzisse o grafo à sua maneira, os três números
 * divergiriam e nenhum relatório bateria com a tela.
 */

/** Usados quando não há Load Generator no canvas (PRD §19). */
export const DEFAULT_SLO: Slo = { p95Ms: 500, p99Ms: 1000, errorRatePct: 1 };
export const DEFAULT_PROFILE: LoadProfile = { startRps: 100, incrementRps: 250, maxRps: 5000 };

export function sloOf(document: ArchitectureDocument): Slo {
  return document.nodes.find(isLoadGeneratorNode)?.slo ?? DEFAULT_SLO;
}

export function profileOf(document: ArchitectureDocument): LoadProfile {
  return document.nodes.find(isLoadGeneratorNode)?.profile ?? DEFAULT_PROFILE;
}

export function graphFromDocument(document: ArchitectureDocument): Graph {
  const nodes: AnalyzerNode[] = [];

  for (const node of document.nodes) {
    if (!isResourceNode(node)) continue;
    const item = getCatalogItem(node.type);
    if (!item) continue;

    const limit = node.properties.maxConnections ?? node.properties.concurrency;

    nodes.push({
      id: node.id,
      type: node.type,
      capacityRps: capacityFor(item, node.properties),
      serviceTimeMs: serviceTimeFor(item, node.properties),
      cacheHitRatio: cacheHitRatioFor(item, node.properties),
      ...(typeof limit === "number" ? { concurrencyLimit: limit } : {}),
    });
  }

  const known = new Set(nodes.map((node) => node.id));
  const origins = document.nodes.filter(isLoadGeneratorNode).map((node) => node.id);
  const originIds = new Set(origins);

  return {
    origins,
    nodes,
    // Nota e grupo não carregam tráfego.
    edges: document.edges
      .filter((edge) => (known.has(edge.source) || originIds.has(edge.source)) && known.has(edge.target))
      .map((edge) => ({ source: edge.source, target: edge.target })),
  };
}

/** PRD §23, §26, §40 — leitura estática, sem teste nenhum. */
export interface Estimate {
  /** Capacidade de planejamento: cumpre o SLO **e** guarda folga (PRD §85). */
  capacityRps: number;
  monthlyCostUsd: number;
  resourceCount: number;
}

export function estimate(document: ArchitectureDocument): Estimate {
  let monthlyCostUsd = 0;
  let resourceCount = 0;

  for (const node of document.nodes) {
    if (!isResourceNode(node)) continue;
    const item = getCatalogItem(node.type);
    if (!item) continue;
    resourceCount += 1;
    monthlyCostUsd += monthlyCostFor(item, node.properties);
  }

  return {
    capacityRps: plannedCapacityRps(
      graphFromDocument(document),
      sloOf(document),
      profileOf(document).maxRps,
    ),
    monthlyCostUsd,
    resourceCount,
  };
}

/** Escada de carga completa sobre o documento (PRD §20). Continua estimativa. */
export function runCapacityTestFor(document: ArchitectureDocument): CapacityRun {
  return runCapacityTest(graphFromDocument(document), profileOf(document), sloOf(document));
}
