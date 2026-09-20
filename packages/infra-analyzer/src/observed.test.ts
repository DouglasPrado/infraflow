import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LoadTestObservation, ResourceMetric } from "@infraflow/schema";
import {
  connection,
  documentOf,
  loadGeneratorNode,
  resourceNode,
} from "@infraflow/validator";
import { analyzeObserved } from "./observed.ts";

/**
 * O §79 pede correlação entre carga, latência, erro e métrica de recurso.
 * Estes testes montam execuções sintéticas para conferir que a conclusão vem
 * da evidência — e que ela **não vem** quando a evidência falta.
 */

const START = Date.parse("2026-09-20T10:00:00.000Z");
const STAGE_MS = 10_000;

function architecture() {
  return documentOf(
    [
      loadGeneratorNode("load-generator", {
        slo: { p95Ms: 500, p99Ms: 1000, errorRatePct: 1 },
      }),
      resourceNode("alb", "aws.alb", {}, "borda"),
      resourceNode("ecs", "aws.ecs", {}, "api"),
      resourceNode("rds", "aws.rds", {}, "orders-db"),
      // Fora do caminho da carga: não pode ser apontado como gargalo dela.
      resourceNode("prometheus", "opensource.prometheus", {}, "metrics"),
    ],
    [
      connection("load-generator", "alb", "HTTP"),
      connection("alb", "ecs", "HTTP"),
      connection("ecs", "rds", "Database"),
    ],
  );
}

/** Uma amostra por segundo dentro do degrau. */
function series(nodeId: string, metric: string, unit: string, perStage: number[]): ResourceMetric[] {
  return perStage.flatMap((value, stage) =>
    [0, 2, 4, 6, 8].map((offset) => ({
      nodeId,
      metric,
      unit,
      value,
      at: new Date(START + stage * STAGE_MS + offset * 1000).toISOString(),
    })),
  );
}

function observation(overrides: Partial<LoadTestObservation> = {}): LoadTestObservation {
  const stages = [
    { targetRps: 100, rps: 100, p95Ms: 60, errorRatePct: 0 },
    { targetRps: 200, rps: 200, p95Ms: 120, errorRatePct: 0 },
    { targetRps: 300, rps: 295, p95Ms: 940, errorRatePct: 4 },
  ].map((stage, index) => ({
    ...stage,
    startedAt: new Date(START + index * STAGE_MS).toISOString(),
    endedAt: new Date(START + (index + 1) * STAGE_MS).toISOString(),
  }));

  return {
    startedAt: new Date(START).toISOString(),
    finishedAt: new Date(START + 3 * STAGE_MS).toISOString(),
    durationSeconds: 30,
    requests: 5950,
    rps: 198,
    p50Ms: 40,
    p95Ms: 380,
    p99Ms: 910,
    errorRatePct: 1.3,
    meetsSlo: false,
    droppedIterations: 0,
    stages,
    metrics: [
      // O banco acompanha a carga e satura.
      ...series("rds", "cpu", "%", [32, 68, 97]),
      // A aplicação cresce menos.
      ...series("ecs", "cpu", "%", [18, 30, 44]),
      // A borda quase não sente.
      ...series("alb", "cpu", "%", [4, 6, 8]),
    ],
    loadCeiling: "none",
    ...overrides,
  };
}

describe("gargalo observado (PRD §37, §79)", () => {
  it("aponta o recurso que acompanhou a carga até ela ceder", () => {
    const analysis = analyzeObserved(architecture(), observation());

    assert.equal(analysis.inconclusive, undefined);
    assert.equal(analysis.candidates[0]?.nodeId, "rds");
    assert.equal(analysis.candidates[0]?.metric, "cpu");
    assert.equal(analysis.candidates[0]?.value, 97);
    assert.equal(analysis.candidates[0]?.unit, "%");
    assert.ok(analysis.candidates[0].confidence > 0.3);
    // A saída do §37 carrega o instante da medição.
    assert.match(analysis.candidates[0].timestamp, /^2026-09-20T10:00:2\d/);
  });

  it("identifica o degrau em que o SLO foi violado", () => {
    const analysis = analyzeObserved(architecture(), observation());

    assert.equal(analysis.breakingStage?.targetRps, 300);
    // Maior degrau que ainda cumpriu o SLO.
    assert.equal(analysis.maxHealthyRps, 200);
  });

  it("não aponta recurso fora do caminho da carga", () => {
    const comRuido = observation({
      metrics: [
        ...observation().metrics,
        // Prometheus esquenta durante o teste, mas não recebe a carga.
        ...series("prometheus", "cpu", "%", [50, 80, 99]),
      ],
    });

    const analysis = analyzeObserved(architecture(), comRuido);
    assert.ok(analysis.candidates.every((candidate) => candidate.nodeId !== "prometheus"));
  });

  it("ignora consumo alto que não acompanha a carga", () => {
    const constante = observation({
      metrics: [
        // Consome mais que todos, mas do começo ao fim, sem relação com a carga.
        ...series("ecs", "cpu", "%", [99, 99, 99]),
        ...series("rds", "cpu", "%", [30, 60, 92]),
      ],
    });

    const analysis = analyzeObserved(architecture(), constante);
    assert.equal(analysis.candidates[0]?.nodeId, "rds");
  });
});

describe("escada curta", () => {
  it("usa crescimento relativo e diz que não houve correlação", () => {
    const curto: LoadTestObservation = {
      ...observation(),
      stages: observation().stages.slice(0, 2).map((stage, index) => ({
        ...stage,
        p95Ms: index === 1 ? 940 : 60,
        errorRatePct: index === 1 ? 4 : 0,
      })),
      metrics: [...series("rds", "cpu", "%", [30, 96]), ...series("ecs", "cpu", "%", [20, 35])],
    };

    const analysis = analyzeObserved(architecture(), curto);

    assert.equal(analysis.candidates[0]?.nodeId, "rds");
    assert.match(analysis.candidates[0].reason, /sem degraus suficientes para correlacionar/);
    // Dois pontos não sustentam certeza.
    assert.ok(analysis.candidates[0].confidence <= 0.6);
  });
});

describe("quando não dá para concluir, não conclui", () => {
  it("não inventa gargalo se o SLO nunca foi violado", () => {
    const saudavel = observation({
      meetsSlo: true,
      stages: observation().stages.map((stage) => ({ ...stage, p95Ms: 80, errorRatePct: 0 })),
    });

    const analysis = analyzeObserved(architecture(), saudavel);
    assert.deepEqual(analysis.candidates, []);
    assert.match(analysis.inconclusive ?? "", /não chegou ao limite/);
    assert.equal(analysis.maxHealthyRps, 295);
  });

  it("acusa o gerador quando foi ele o limite", () => {
    const analysis = analyzeObserved(
      architecture(),
      observation({ droppedIterations: 340, loadCeiling: "generator" }),
    );

    assert.deepEqual(analysis.candidates, []);
    assert.match(analysis.inconclusive ?? "", /máquina que gera/);
  });

  it("não descarta a leitura quando quem cedeu foi a arquitetura", () => {
    // Alvo saturado descarta iterações do mesmo jeito que gerador fraco. Tratar
    // os dois como inconclusivos jogaria fora o platô — que é o resultado.
    const analysis = analyzeObserved(
      architecture(),
      observation({ droppedIterations: 340, loadCeiling: "architecture" }),
    );

    assert.equal(analysis.inconclusive, undefined);
    assert.ok(analysis.candidates.length > 0, "o gargalo deveria ter sido atribuído");
  });

  it("não atribui recurso sem métrica coletada", () => {
    const analysis = analyzeObserved(architecture(), observation({ metrics: [] }));

    assert.deepEqual(analysis.candidates, []);
    assert.match(analysis.inconclusive ?? "", /coleta de métricas/);
  });

  it("não conclui quando a medição não cobre o degrau que cedeu", () => {
    const foraDaJanela = observation({
      metrics: series("rds", "cpu", "%", [30, 60]).map((sample) => ({
        ...sample,
        at: new Date(START - 60_000).toISOString(),
      })),
    });

    const analysis = analyzeObserved(architecture(), foraDaJanela);
    assert.deepEqual(analysis.candidates, []);
    assert.ok(analysis.inconclusive);
  });
});
