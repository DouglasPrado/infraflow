import { LoadTestObservationSchema, type LoadTestObservation } from "@infraflow/schema";
import type { LadderStep } from "./types.ts";

/**
 * Do resumo do k6 para o vocabulário de observação (PRD §37, §77, §78).
 *
 * É aqui que medição vira dado do produto. Nada é estimado: o que não veio do
 * k6 não é preenchido por aproximação.
 */

interface MetricValues {
  [statistic: string]: number | undefined;
}

interface Metric {
  values?: MetricValues;
}

interface K6Summary {
  metrics?: Record<string, Metric | undefined>;
  state?: { testRunDurationMs?: number };
}

function statistic(summary: K6Summary, metric: string, name: string): number | undefined {
  return summary.metrics?.[metric]?.values?.[name];
}

const zero = (value: number | undefined) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

export interface ParseOptions {
  ladder: LadderStep[];
  startedAt: Date;
  finishedAt: Date;
}

/**
 * Quanto a latência precisa inflar para a degradação ser do alvo, e não ruído.
 *
 * Dois é folgado de propósito: variação de rede e de coleta sobe o p95 em
 * dezenas de porcento sem que nada tenha saturado. Só o dobro do degrau mais
 * calmo é sinal de fila se formando.
 */
const INFLAÇÃO_DE_SATURAÇÃO = 2;

/** Erro acima disto não é ruído: o alvo começou a recusar. */
const ERRO_DE_SATURAÇÃO_PCT = 1;

/**
 * De quem foi o teto (PRD §77).
 *
 * O k6 conta descartes da execução inteira, sem rótulo de degrau — não dá para
 * saber *quando* faltou VU. Mas dá para saber se o **alvo** se degradou durante
 * a escada, e é isso que separa as duas causas: VU preso em alvo lento é teto da
 * arquitetura; VU faltando com alvo saudável é teto do gerador.
 */
function ceilingOf(
  dropped: number,
  stages: { p95Ms: number; errorRatePct: number }[],
): "none" | "architecture" | "generator" {
  if (dropped <= 0) return "none";

  // O degrau mais leve é a linha de base: a arquitetura sem fila.
  const base = stages[0];
  if (!base || stages.length < 2) return "generator";

  const inflou = stages.some((stage) => stage.p95Ms >= base.p95Ms * INFLAÇÃO_DE_SATURAÇÃO);
  const recusou = stages.some(
    (stage) => stage.errorRatePct - base.errorRatePct >= ERRO_DE_SATURAÇÃO_PCT,
  );

  return inflou || recusou ? "architecture" : "generator";
}

export function parseSummary(raw: unknown, options: ParseOptions): LoadTestObservation {
  const summary = raw as K6Summary;
  const durationSeconds = zero(summary.state?.testRunDurationMs) / 1000;

  const requests = zero(statistic(summary, "http_reqs", "count"));
  const failedRate = zero(statistic(summary, "http_req_failed", "rate"));

  /**
   * O `rate` da submétrica é calculado sobre a execução inteira, não sobre o
   * degrau — então a vazão do degrau sai da contagem dividida pela duração
   * dele. Usar o `rate` do k6 aqui subestimaria todos os degraus.
   */
  let elapsed = 0;
  const stages = options.ladder.map((step) => {
    const suffix = `{stage:${step.index}}`;
    const count = zero(statistic(summary, `http_reqs${suffix}`, "count"));

    // A janela do degrau sai do próprio perfil: o k6 executa os patamares em
    // sequência, na duração configurada.
    const startedAt = new Date(options.startedAt.getTime() + elapsed * 1000);
    elapsed += step.durationSeconds;
    const endedAt = new Date(options.startedAt.getTime() + elapsed * 1000);

    return {
      targetRps: step.targetRps,
      rps: step.durationSeconds > 0 ? count / step.durationSeconds : 0,
      p95Ms: zero(statistic(summary, `http_req_duration${suffix}`, "p(95)")),
      errorRatePct: zero(statistic(summary, `http_req_failed${suffix}`, "rate")) * 100,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
    };
  });

  /** Iteração que o executor quis disparar sem ter VU livre. */
  const dropped = zero(statistic(summary, "dropped_iterations", "count"));

  /** O SLO é o próprio k6 quem afere, pelos limiares do §19. */
  const thresholds = summary.metrics ?? {};
  const meetsSlo = ["http_req_duration", "http_req_failed"].every((name) => {
    const entry = thresholds[name] as { thresholds?: Record<string, { ok?: boolean }> } | undefined;
    const rules = entry?.thresholds ?? {};
    return Object.values(rules).every((rule) => rule.ok !== false);
  });

  return LoadTestObservationSchema.parse({
    loadCeiling: ceilingOf(dropped, stages),
    startedAt: options.startedAt.toISOString(),
    finishedAt: options.finishedAt.toISOString(),
    durationSeconds,
    requests: Math.round(requests),
    rps: durationSeconds > 0 ? requests / durationSeconds : 0,
    p50Ms: zero(statistic(summary, "http_req_duration", "p(50)") ?? statistic(summary, "http_req_duration", "med")),
    p95Ms: zero(statistic(summary, "http_req_duration", "p(95)")),
    p99Ms: zero(statistic(summary, "http_req_duration", "p(99)")),
    errorRatePct: failedRate * 100,
    meetsSlo,
    droppedIterations: Math.round(dropped),
    stages,
  });
}
