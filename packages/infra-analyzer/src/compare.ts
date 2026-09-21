import { diffDocuments, type ArchitectureDocument, type DocumentDiff } from "@infraflow/schema";
import { estimate, runCapacityTestFor } from "./document.ts";

/**
 * Comparação entre duas versões (PRD §39, §41, §80).
 *
 * Responde a pergunta do §39 — capacidade, custo e p95 — e acrescenta a
 * eficiência do §41: custo por mil req/s. Duas arquiteturas com a mesma
 * capacidade não são equivalentes se uma custa o dobro.
 *
 * Os números são estimativa do motor de capacidade, sobre os recursos
 * configurados no canvas. Não há lado medido: a comparação é entre dois
 * desenhos, não entre duas execuções.
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

export interface VersionComparison {
  diff: DocumentDiff;
  estimated: {
    from: VersionSide;
    to: VersionSide;
    capacityRps: Delta;
    monthlyCostUsd: Delta;
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

export interface CompareInput {
  document: ArchitectureDocument;
}

export function compareVersions(from: CompareInput, to: CompareInput): VersionComparison {
  const left = sideOf(from.document);
  const right = sideOf(to.document);

  return {
    diff: diffDocuments(from.document, to.document),
    estimated: {
      from: left,
      to: right,
      capacityRps: delta(left.capacityRps, right.capacityRps),
      monthlyCostUsd: delta(left.monthlyCostUsd, right.monthlyCostUsd),
      p95Ms: delta(left.p95Ms, right.p95Ms),
    },
  };
}
