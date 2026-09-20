import {
  isLoadGeneratorNode,
  isResourceNode,
  reachableFrom,
  type ArchitectureDocument,
  type LoadTestObservation,
  type ObservedStage,
  type ResourceMetric,
} from "@infraflow/schema";
import { sloOf } from "./document.ts";

/**
 * Gargalo a partir de **medição** (PRD §37, §79).
 *
 * Distinto do gargalo estimado do `engine.ts`: aquele deduz quem satura
 * primeiro a partir das capacidades declaradas no registry; este correlaciona
 * o que o k6 ofereceu (§77) com o que os recursos gastaram (§78) e aponta quem
 * acompanhou a carga até ela ceder.
 *
 * Quando não dá para concluir, **não conclui**. Um teste que nunca violou o
 * SLO não encontrou gargalo nenhum; um gerador que descartou iterações mediu o
 * limite da própria máquina. Dizer o contrário seria transformar estimativa em
 * observação, que é o risco do §85.
 */

/** Saída do §37: recurso, métrica, valor, instante e confiança. */
export interface ObservedBottleneck {
  nodeId: string;
  metric: string;
  value: number;
  unit: string;
  timestamp: string;
  /** 0 a 1. Quanto a evidência separa este recurso dos demais. */
  confidence: number;
  reason: string;
}

export interface ObservedAnalysis {
  /** Maior degrau sustentado dentro do SLO (PRD §19, §20). */
  maxHealthyRps: number;
  /** Primeiro degrau que violou o SLO, quando houve. */
  breakingStage?: ObservedStage;
  candidates: ObservedBottleneck[];
  /** Por que não há conclusão. Presente exatamente quando não há candidato. */
  inconclusive?: string;
}

const within = (sample: ResourceMetric, from: number, to: number): boolean => {
  const at = new Date(sample.at).getTime();
  return at >= from && at <= to;
};

/**
 * Correlação de Pearson entre duas séries.
 *
 * É o que separa "gastou CPU" de "gastou CPU **por causa da carga**": um
 * container de observabilidade também esquenta durante o teste, mas não
 * acompanha a escada.
 */
function correlation(left: number[], right: number[]): number {
  const size = Math.min(left.length, right.length);
  if (size < 3) return 0;

  const meanLeft = left.slice(0, size).reduce((sum, value) => sum + value, 0) / size;
  const meanRight = right.slice(0, size).reduce((sum, value) => sum + value, 0) / size;

  let covariance = 0;
  let varianceLeft = 0;
  let varianceRight = 0;

  for (let index = 0; index < size; index += 1) {
    const deltaLeft = left[index]! - meanLeft;
    const deltaRight = right[index]! - meanRight;
    covariance += deltaLeft * deltaRight;
    varianceLeft += deltaLeft * deltaLeft;
    varianceRight += deltaRight * deltaRight;
  }

  const denominator = Math.sqrt(varianceLeft * varianceRight);
  return denominator === 0 ? 0 : covariance / denominator;
}

/** Média das amostras de um recurso dentro de uma janela. */
function meanIn(samples: ResourceMetric[], from: number, to: number): number | undefined {
  const inside = samples.filter((sample) => within(sample, from, to));
  if (inside.length === 0) return undefined;
  return inside.reduce((sum, sample) => sum + sample.value, 0) / inside.length;
}

/**
 * Quanto a série do recurso acompanhou a escada de carga.
 *
 * Com três pontos ou mais isso é correlação. Com dois, correlação não existe —
 * dois pontos sempre se ajustam a uma reta. O que dois pontos sustentam é
 * crescimento relativo, e a diferença entre as duas leituras entra na confiança
 * da conclusão.
 */
function tracking(values: number[], loads: number[]): { value: number; basis: Basis } {
  if (values.length >= 3) {
    return { value: Math.max(0, correlation(values, loads)), basis: "correlation" };
  }
  if (values.length < 2) return { value: 0, basis: "growth" };

  const loadGrowth = (loads.at(-1)! - loads[0]!) / Math.max(1, loads[0]!);
  if (loadGrowth <= 0) return { value: 0, basis: "growth" };

  const growth = (values.at(-1)! - values[0]!) / Math.max(1, values[0]!);
  return { value: Math.max(0, Math.min(1, growth / loadGrowth)), basis: "growth" };
}

type Basis = "correlation" | "growth";

interface Evidence {
  nodeId: string;
  metric: string;
  unit: string;
  /** Maior valor observado na janela em que a arquitetura cedeu. */
  peak: number;
  timestamp: string;
  /** Quanto a série acompanhou a escada de carga. */
  tracking: number;
  basis: Basis;
}

function describeBasis(entry: Evidence): string {
  return entry.basis === "correlation"
    ? `correlação ${entry.tracking.toFixed(2)}`
    : `crescimento relativo ${entry.tracking.toFixed(2)}, sem degraus suficientes para correlacionar`;
}

export function analyzeObserved(
  document: ArchitectureDocument,
  observation: LoadTestObservation,
): ObservedAnalysis {
  const slo = sloOf(document);

  const healthy = observation.stages.filter(
    (stage) => stage.p95Ms <= slo.p95Ms && stage.errorRatePct <= slo.errorRatePct,
  );
  const maxHealthyRps = healthy.reduce((best, stage) => Math.max(best, stage.rps), 0);
  const breakingStage = observation.stages.find(
    (stage) => stage.p95Ms > slo.p95Ms || stage.errorRatePct > slo.errorRatePct,
  );

  const inconclusive = (reason: string): ObservedAnalysis => ({
    maxHealthyRps,
    ...(breakingStage ? { breakingStage } : {}),
    candidates: [],
    inconclusive: reason,
  });

  if (observation.stages.length === 0) {
    return inconclusive("A execução não registrou degraus.");
  }

  if (!breakingStage) {
    return inconclusive(
      `A arquitetura cumpriu o SLO em toda a escada, até ${Math.round(maxHealthyRps)} req/s. Não houve gargalo a identificar: o teste não chegou ao limite.`,
    );
  }

  /**
   * Descarte só invalida a leitura quando o teto foi do **gerador**.
   *
   * Quando o alvo satura, a latência infla e os VUs ficam presos esperando: o
   * k6 descarta, mas o platô medido é o limite real da arquitetura. Tratar os
   * dois casos igual jogaria fora justamente o resultado que o teste existe
   * para encontrar.
   */
  if (observation.loadCeiling === "generator") {
    return inconclusive(
      `O gerador descartou ${observation.droppedIterations} iterações enquanto o alvo seguia saudável: a carga oferecida ficou abaixo da pedida, então o limite encontrado é o da máquina que gera, não o da arquitetura.`,
    );
  }

  if (observation.metrics.length === 0) {
    return inconclusive(
      "Não houve coleta de métricas por recurso, então não há como atribuir o limite a um recurso específico.",
    );
  }

  // Só o que a carga alcança pode ser o gargalo dela (PRD §21).
  const origins = document.nodes.filter(isLoadGeneratorNode);
  const onPath = new Set(origins.flatMap((origin) => reachableFrom(document, origin.id)));
  const resources = new Map(document.nodes.filter(isResourceNode).map((node) => [node.id, node]));

  const breakingFrom = new Date(breakingStage.startedAt).getTime();
  const breakingTo = new Date(breakingStage.endedAt).getTime();

  // Série de carga por degrau, para correlacionar com a série de cada recurso.
  const offered = observation.stages.map((stage) => stage.rps);

  const evidence: Evidence[] = [];
  const keys = new Set(observation.metrics.map((sample) => `${sample.nodeId}\u0000${sample.metric}`));

  for (const key of keys) {
    const [nodeId = "", metric = ""] = key.split("\u0000");
    if (!onPath.has(nodeId) || !resources.has(nodeId)) continue;

    const samples = observation.metrics.filter(
      (sample) => sample.nodeId === nodeId && sample.metric === metric,
    );

    const inBreaking = samples.filter((sample) => within(sample, breakingFrom, breakingTo));
    if (inBreaking.length === 0) continue;

    const worst = inBreaking.reduce((best, sample) => (sample.value > best.value ? sample : best));

    // Média por degrau: é a série que se compara com a escada de carga.
    const perStage = observation.stages.map((stage) =>
      meanIn(samples, new Date(stage.startedAt).getTime(), new Date(stage.endedAt).getTime()),
    );
    const paired = perStage.flatMap((value, index) =>
      value === undefined ? [] : [{ value, load: offered[index] ?? 0 }],
    );

    const followed = tracking(
      paired.map((entry) => entry.value),
      paired.map((entry) => entry.load),
    );

    evidence.push({
      nodeId,
      metric,
      unit: worst.unit,
      peak: worst.value,
      timestamp: worst.at,
      tracking: followed.value,
      basis: followed.basis,
    });
  }

  if (evidence.length === 0) {
    return inconclusive(
      "Nenhum recurso no caminho da carga tem métrica na janela em que o SLO foi violado.",
    );
  }

  /**
   * Pontuação.
   *
   * Duas coisas precisam ser verdadeiras para um recurso ser o gargalo: ele
   * consumiu mais que os outros **e** consumiu acompanhando a carga. O produto
   * derruba tanto o recurso caro que ficou constante quanto o que acompanhou a
   * carga gastando pouco.
   */
  const highest = new Map<string, number>();
  for (const entry of evidence) {
    highest.set(entry.metric, Math.max(highest.get(entry.metric) ?? 0, entry.peak));
  }

  const scored = evidence
    .map((entry) => {
      const relative = entry.peak / (highest.get(entry.metric) || 1);
      return { entry, score: relative * entry.tracking };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);

  if (scored.length === 0) {
    return inconclusive(
      "Nenhum recurso acompanhou o crescimento da carga: o limite não está no consumo dos recursos medidos.",
    );
  }

  const best = scored[0]!;
  const runnerUp = scored[1]?.score ?? 0;

  /**
   * Confiança: o quanto o primeiro se separa do segundo, temperado pela força
   * da correlação. Empate técnico não vira certeza.
   */
  const separation = (best.score - runnerUp) / best.score;
  const raw = separation * 0.6 + best.entry.tracking * 0.4;
  // Escada curta demais para correlacionar: a conclusão vale menos.
  const ceiling = best.entry.basis === "correlation" ? 0.99 : 0.6;
  const confidence = Math.min(ceiling, Math.max(0.1, raw));

  const name = resources.get(best.entry.nodeId)?.name ?? best.entry.nodeId;

  return {
    maxHealthyRps,
    breakingStage,
    candidates: scored.slice(0, 3).map((item, index) => ({
      nodeId: item.entry.nodeId,
      metric: item.entry.metric,
      value: item.entry.peak,
      unit: item.entry.unit,
      timestamp: item.entry.timestamp,
      confidence: index === 0 ? confidence : Math.min(confidence, item.score / best.score) * 0.6,
      reason:
        index === 0
          ? `${name} atingiu ${item.entry.peak.toFixed(1)}${item.entry.unit} de ${item.entry.metric} no degrau de ${Math.round(breakingStage.targetRps)} req/s, acompanhando a carga (${describeBasis(item.entry)}).`
          : `Também acompanhou a carga, com consumo menor (${describeBasis(item.entry)}).`,
    })),
  };
}
