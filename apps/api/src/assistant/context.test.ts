import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlanSummary } from "@infraflow/schema";
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

  it("diz que não há medição, e que os números são estimativa", () => {
    assert.match(text, /não mede execução real/);
    assert.match(text, /estimativa do motor/);
  });
});

describe("com dados reais do sistema", () => {
  const context = buildContext({
    document: architecture(),
    version: 4,
    plan: { runId: "plan-ABC", summary: plan },
  });
  const text = renderContext(context);

  it("leva o plano com o identificador da execução", () => {
    assert.match(text, /plan-ABC/);
    assert.match(text, /Criar: 12/);
    assert.match(text, /aws_db_instance\.orders_db/);
  });
});
