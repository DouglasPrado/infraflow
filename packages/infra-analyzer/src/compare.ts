import {
  diffDocuments,
  type ArchitectureDocument,
  type DocumentDiff,
  type LoadTestObservation,
} from "@infraflow/schema";
import { estimate, runCapacityTestFor } from "./document.ts";
import { analyzeObserved } from "./observed.ts";

/**
 * Comparação entre duas versões (PRD §39, §41, §80).
 *
 * Responde a pergunta do §39 — capacidade, custo e p95 — e acrescenta a
 * eficiência do §41: custo por mil req/s. Duas arquiteturas com a mesma
 * capacidade não são equivalentes se uma custa o dobro.
 *
 * `estimated` e `observed` viajam separados. A comparação só tem lado medido
 * quando **as duas versões** foram testadas — comparar medição de uma com
 * estimativa da outra produziria um número sem significado.
 */

export interface Delta {
  from: number;
  to: number;
  /** `to - from`. Positivo significa que cresceu, não que melhorou. */
  delta: number;
}

export interface VersionSide {
  capacityRps: number;
  monthlyCostUsd: number;
  p95Ms: number;
  /** PRD §41 — custo por mil req/s. `null` quando não há capacidade. */
  costPer1kRps: number | null;
}

export interface ObservedSide {
  maxHealthyRps: number;
  p95Ms: number;
  errorRatePct: number;
}

export interface VersionComparison {
  diff: DocumentDiff;
  estimated: {
    from: VersionSide;
    to: VersionSide;
    capacityRps: Delta;
    monthlyCostUsd: Delta;
    p95Ms: Delta;
  };
  observed?: {
    from: ObservedSide;
    to: ObservedSide;
    maxHealthyRps: Delta;
    p95Ms: Delta;
  };
}

const delta = (from: number, to: number): Delta => ({ from, to, delta: to - from });

function sideOf(document: ArchitectureDocument): VersionSide {
  const numbers = estimate(document);
  const run = runCapacityTestFor(document);

  return {
    capacityRps: numbers.capacityRps,
    monthlyCostUsd: numbers.monthlyCostUsd,
    p95Ms: Math.round(run.p95Ms),
    costPer1kRps:
      numbers.capacityRps > 0
        ? Math.round((numbers.monthlyCostUsd / numbers.capacityRps) * 1000 * 100) / 100
        : null,
  };
}

function observedSide(
  document: ArchitectureDocument,
  observation: LoadTestObservation,
): ObservedSide {
  return {
    maxHealthyRps: Math.round(analyzeObserved(document, observation).maxHealthyRps),
    p95Ms: Math.round(observation.p95Ms),
    errorRatePct: Math.round(observation.errorRatePct * 10) / 10,
  };
}

export interface CompareInput {
  document: ArchitectureDocument;
  observation?: LoadTestObservation;
}

export function compareVersions(from: CompareInput, to: CompareInput): VersionComparison {
  const left = sideOf(from.document);
  const right = sideOf(to.document);

  const comparison: VersionComparison = {
    diff: diffDocuments(from.document, to.document),
    estimated: {
      from: left,
      to: right,
      capacityRps: delta(left.capacityRps, right.capacityRps),
      monthlyCostUsd: delta(left.monthlyCostUsd, right.monthlyCostUsd),
      p95Ms: delta(left.p95Ms, right.p95Ms),
    },
  };

  if (!from.observation || !to.observation) return comparison;

  const leftObserved = observedSide(from.document, from.observation);
  const rightObserved = observedSide(to.document, to.observation);

  return {
    ...comparison,
    observed: {
      from: leftObserved,
      to: rightObserved,
      maxHealthyRps: delta(leftObserved.maxHealthyRps, rightObserved.maxHealthyRps),
      p95Ms: delta(leftObserved.p95Ms, rightObserved.p95Ms),
    },
  };
}
