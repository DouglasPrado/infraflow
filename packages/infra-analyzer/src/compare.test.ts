import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LoadTestObservation } from "@infraflow/schema";
import { connection, documentOf, loadGeneratorNode, resourceNode } from "@infraflow/validator";
import { compareVersions } from "./compare.ts";

/** PRD §39, §41, §80 — comparar v1 com v2 precisa responder o que melhorou. */

function architecture(overrides: Record<string, string | number | boolean> = {}) {
  return documentOf(
    [
      loadGeneratorNode(),
      resourceNode("alb", "aws.alb", {}, "borda"),
      resourceNode("ecs", "aws.ecs", overrides, "api"),
      resourceNode("rds", "aws.rds", {}, "db"),
    ],
    [
      connection("load-generator", "alb", "HTTP"),
      connection("alb", "ecs", "HTTP"),
      connection("ecs", "rds", "Database"),
    ],
  );
}

function observation(maxRps: number, p95Ms: number): LoadTestObservation {
  const start = Date.parse("2026-09-20T10:00:00.000Z");
  return {
    startedAt: new Date(start).toISOString(),
    finishedAt: new Date(start + 20_000).toISOString(),
    durationSeconds: 20,
    requests: maxRps * 20,
    rps: maxRps,
    p50Ms: p95Ms / 4,
    p95Ms,
    p99Ms: p95Ms * 2,
    errorRatePct: 0,
    meetsSlo: true,
    droppedIterations: 0,
    loadCeiling: "none",
    metrics: [],
    stages: [
      {
        targetRps: maxRps,
        rps: maxRps,
        p95Ms,
        errorRatePct: 0,
        startedAt: new Date(start).toISOString(),
        endedAt: new Date(start + 20_000).toISOString(),
      },
    ],
  };
}

describe("comparação de versões (PRD §39)", () => {
  const menor = { document: architecture({ maxReplicas: 4 }) };
  const maior = { document: architecture({ maxReplicas: 20, cpu: "4 vCPU" }) };

  it("mostra a capacidade estimada subindo", () => {
    const comparison = compareVersions(menor, maior);

    assert.ok(comparison.estimated.capacityRps.delta > 0);
    assert.equal(
      comparison.estimated.capacityRps.to - comparison.estimated.capacityRps.from,
      comparison.estimated.capacityRps.delta,
    );
  });

  it("mostra o custo acompanhando", () => {
    const comparison = compareVersions(menor, maior);
    assert.ok(comparison.estimated.monthlyCostUsd.delta > 0);
  });

  it("calcula a eficiência do §41 — custo por mil req/s", () => {
    const comparison = compareVersions(menor, maior);

    for (const side of [comparison.estimated.from, comparison.estimated.to]) {
      assert.ok(side.costPer1kRps !== null);
      assert.ok(side.costPer1kRps > 0);
    }
    // Mais capacidade pelo mesmo tipo de recurso melhora a eficiência.
    assert.ok(comparison.estimated.to.costPer1kRps! < comparison.estimated.from.costPer1kRps!);
  });

  it("traz o diff junto", () => {
    const comparison = compareVersions(menor, maior);

    assert.equal(comparison.diff.identical, false);
    assert.ok(
      comparison.diff.nodes.changed.some((change) =>
        change.properties.some((property) => property.key === "maxReplicas"),
      ),
    );
  });
});

describe("lado observado", () => {
  it("só aparece quando as duas versões foram medidas", () => {
    const comSomenteUma = compareVersions(
      { document: architecture(), observation: observation(1000, 120) },
      { document: architecture({ maxReplicas: 20 }) },
    );
    assert.equal(comSomenteUma.observed, undefined);
  });

  it("compara medição com medição", () => {
    const comparison = compareVersions(
      { document: architecture(), observation: observation(1200, 410) },
      { document: architecture({ maxReplicas: 20 }), observation: observation(2800, 230) },
    );

    assert.ok(comparison.observed);
    assert.equal(comparison.observed.maxHealthyRps.from, 1200);
    assert.equal(comparison.observed.maxHealthyRps.to, 2800);
    assert.equal(comparison.observed.maxHealthyRps.delta, 1600);
    // Latência caiu: o delta é negativo, e isso é melhora.
    assert.equal(comparison.observed.p95Ms.delta, -180);
  });
});
