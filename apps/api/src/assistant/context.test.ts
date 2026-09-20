import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LoadTestObservation, PlanSummary } from "@infraflow/schema";
import { connection, documentOf, loadGeneratorNode, resourceNode } from "@infraflow/validator";
import { buildContext, renderContext } from "./context.ts";

/**
 * PRD §81 — o assistente só pode falar do que o sistema apurou.
 *
 * Estes testes são sobre o **contexto**, não sobre o modelo: é aqui que se
 * garante que a resposta terá de onde sair, e que a ausência de dado aparece
 * como ausência.
 */

function architecture() {
  return documentOf(
    [
      loadGeneratorNode(),
      resourceNode("alb", "aws.alb", {}, "public-alb"),
      resourceNode("ecs", "aws.ecs", {}, "api-service"),
      resourceNode("rds", "aws.rds", { multiAz: false }, "orders-db"),
      resourceNode("cdn", "aws.cloudfront", {}, "cdn"),
    ],
    [
      connection("load-generator", "alb", "HTTP"),
      connection("alb", "ecs", "HTTP"),
      connection("ecs", "rds", "Database"),
    ],
  );
}

const START = Date.parse("2026-09-20T10:00:00.000Z");

const observation: LoadTestObservation = {
  startedAt: new Date(START).toISOString(),
  finishedAt: new Date(START + 30_000).toISOString(),
  durationSeconds: 30,
  requests: 6000,
  rps: 200,
  p50Ms: 30,
  p95Ms: 940,
  p99Ms: 1800,
  errorRatePct: 4,
  meetsSlo: false,
  droppedIterations: 0,
  stages: [0, 1, 2].map((index) => ({
    targetRps: 100 * (index + 1),
    rps: 100 * (index + 1),
    p95Ms: index === 2 ? 940 : 80,
    errorRatePct: index === 2 ? 4 : 0,
    startedAt: new Date(START + index * 10_000).toISOString(),
    endedAt: new Date(START + (index + 1) * 10_000).toISOString(),
  })),
  metrics: [0, 1, 2].flatMap((index) => [
    {
      nodeId: "rds",
      metric: "cpu",
      unit: "%",
      value: [30, 64, 97][index]!,
      at: new Date(START + 5_000 + index * 10_000).toISOString(),
    },
    {
      nodeId: "ecs",
      metric: "cpu",
      unit: "%",
      value: [18, 26, 33][index]!,
      at: new Date(START + 5_000 + index * 10_000).toISOString(),
    },
  ]),
};

const plan: PlanSummary = {
  target: "aws",
  add: 12,
  change: 0,
  destroy: 0,
  changes: [{ address: "aws_db_instance.orders_db", type: "aws_db_instance", name: "orders_db", action: "create" }],
  compileWarnings: [],
};

describe("contexto do assistente (PRD §81)", () => {
  const context = buildContext({ document: architecture(), version: 3 });
  const text = renderContext(context);

  it("leva o architecture.json, que é a fonte estruturada (§33)", () => {
    assert.match(text, /architecture\.json/);
    assert.match(text, /"orders-db"/);
    assert.match(text, /"aws\.rds"/);
  });

  it("leva os achados da validação (§72)", () => {
    assert.match(text, /Validação/);
    assert.match(text, /zona só/);
  });

  it("leva os avisos de compilação (§74)", () => {
    // CloudFront não é traduzido pelo compiler deste milestone.
    assert.match(text, /unsupported-resource/);
    assert.match(text, /CloudFront/);
  });

  it("nomeia a leitura de cada número", () => {
    assert.match(text, /# Estimated/);
    assert.match(text, /# Planned/);
    assert.match(text, /# Observed/);
  });
});

describe("o que o sistema não sabe aparece como ausência", () => {
  const text = renderContext(buildContext({ document: architecture(), version: 1 }));

  it("diz que não houve plan", () => {
    assert.match(text, /Nenhum `tofu plan` foi executado/);
  });

  it("diz que não houve laboratório", () => {
    assert.match(text, /Nenhum laboratório foi criado/);
  });

  it("diz que não houve medição, e por que isso importa", () => {
    assert.match(text, /Nenhum teste de carga foi executado/);
    assert.match(text, /seria especulação/);
  });
});

describe("com dados reais do sistema", () => {
  const context = buildContext({
    document: architecture(),
    version: 4,
    plan: { runId: "plan-ABC", summary: plan },
    lab: { slug: "test-XYZ", status: "READY", entryUrl: "http://127.0.0.1:18100" },
    observation: { runId: "load-test-DEF", observation },
  });
  const text = renderContext(context);

  it("leva o plano com o identificador da execução", () => {
    assert.match(text, /plan-ABC/);
    assert.match(text, /Criar: 12/);
    assert.match(text, /aws_db_instance\.orders_db/);
  });

  it("leva o laboratório e sua entrada", () => {
    assert.match(text, /test-XYZ/);
    assert.match(text, /127\.0\.0\.1:18100/);
  });

  it("leva a medição, com escada e erro", () => {
    assert.match(text, /load-test-DEF/);
    assert.match(text, /Vazão sustentada: 200 req\/s/);
    assert.match(text, /SLO: violado/);
    assert.match(text, /pedido 300 req\/s → alcançado 300 req\/s/);
  });

  it("resume a métrica por recurso em pico, não despeja a série", () => {
    assert.match(text, /rds · cpu: pico 97\.0%/);

    // Três amostras viraram um pico. A contagem é dentro da seção de métricas:
    // o recurso reaparece adiante, como candidato a gargalo, e isso é outro dado.
    const secao = text.split("## Métricas por recurso")[1]!.split("## Gargalo")[0]!;
    assert.equal(secao.match(/rds · cpu/g)?.length, 1);
    assert.equal(secao.match(/ecs · cpu/g)?.length, 1);
  });

  it("leva o gargalo observado com a confiança (§79)", () => {
    assert.match(text, /Gargalo observado/);
    assert.match(text, /rds · cpu/);
    assert.match(text, /confiança 0\./);
  });

  it("a análise vem do documento certo: recurso fora do caminho não entra", () => {
    // O CDN não está conectado ao Load Generator neste desenho.
    assert.doesNotMatch(text, /cdn · cpu/);
  });
});

describe("gargalo inconclusivo", () => {
  it("repete o motivo em vez de apontar candidato", () => {
    const saudavel: LoadTestObservation = {
      ...observation,
      meetsSlo: true,
      stages: observation.stages.map((stage) => ({ ...stage, p95Ms: 60, errorRatePct: 0 })),
    };

    const text = renderContext(
      buildContext({
        document: architecture(),
        version: 1,
        observation: { runId: "load-test-OK", observation: saudavel },
      }),
    );

    assert.match(text, /Conclusão: .*não chegou ao limite/);
    assert.doesNotMatch(text, /confiança/);
  });
});
