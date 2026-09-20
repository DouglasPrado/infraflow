import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluate, maxHealthyRps } from "./engine.ts";
import { runCapacityTest } from "./run.ts";
import type { AnalyzerNode, Graph, Slo } from "./types.ts";

const SLO: Slo = { p95Ms: 500, p99Ms: 1000, errorRatePct: 1 };

function node(id: string, over: Partial<AnalyzerNode> = {}): AnalyzerNode {
  return {
    id,
    type: `test.${id}`,
    capacityRps: 1000,
    serviceTimeMs: 10,
    cacheHitRatio: 0,
    ...over,
  };
}

/** Corrente simples: origem → a → b. */
function chain(...nodes: AnalyzerNode[]): Graph {
  return {
    origins: ["lg"],
    nodes,
    edges: nodes.map((current, index) => ({
      source: index === 0 ? "lg" : nodes[index - 1]!.id,
      target: current.id,
    })),
  };
}

const load = (point: ReturnType<typeof evaluate>, id: string) =>
  point.nodes.find((entry) => entry.nodeId === id)!;

describe("propagação de tráfego", () => {
  it("entrega toda a carga a um recurso sem cache", () => {
    const point = evaluate(chain(node("a")), 500, SLO);
    assert.equal(load(point, "a").arrivalRps, 500);
  });

  it("cache absorve a carga e só o resto segue adiante", () => {
    const graph = chain(node("cdn", { cacheHitRatio: 0.72, capacityRps: 50_000 }), node("origem"));
    const point = evaluate(graph, 1000, SLO);

    assert.equal(load(point, "cdn").arrivalRps, 1000);
    // Era este o erro do motor antigo: a origem recebia os 1000.
    assert.equal(Math.round(load(point, "origem").arrivalRps), 280);
  });

  it("soma o que chega por caminhos diferentes", () => {
    const graph: Graph = {
      origins: ["lg"],
      nodes: [node("a", { capacityRps: 10_000 }), node("b", { capacityRps: 10_000 }), node("db")],
      edges: [
        { source: "lg", target: "a" },
        { source: "lg", target: "b" },
        { source: "a", target: "db" },
        { source: "b", target: "db" },
      ],
    };
    assert.equal(load(evaluate(graph, 100, SLO), "db").arrivalRps, 200);
  });

  it("não entra em laço com ciclo no grafo", () => {
    const graph: Graph = {
      origins: ["lg"],
      nodes: [node("a"), node("b")],
      edges: [
        { source: "lg", target: "a" },
        { source: "a", target: "b" },
        { source: "b", target: "a" },
      ],
    };
    assert.ok(Number.isFinite(evaluate(graph, 100, SLO).meanMs));
  });
});

describe("latência por teoria de filas", () => {
  it("em carga baixa, a latência tende ao tempo de serviço", () => {
    const point = evaluate(chain(node("a", { serviceTimeMs: 10, capacityRps: 10_000 })), 1, SLO);
    assert.ok(Math.abs(load(point, "a").latencyMs - 10) < 0.02);
  });

  it("a 50% de utilização, dobra — é a fórmula de M/M/1", () => {
    const point = evaluate(chain(node("a", { serviceTimeMs: 10, capacityRps: 1000 })), 500, SLO);
    assert.ok(Math.abs(load(point, "a").latencyMs - 20) < 0.01);
  });

  it("cresce sem limite perto da saturação", () => {
    const g = (rps: number) => evaluate(chain(node("a", { capacityRps: 1000 })), rps, SLO);
    const meio = load(g(500), "a").latencyMs;
    const quase = load(g(950), "a").latencyMs;
    assert.ok(quase > meio * 5, `${quase} deveria disparar frente a ${meio}`);
  });

  it("soma a latência ao longo do caminho", () => {
    const graph = chain(
      node("a", { serviceTimeMs: 10, capacityRps: 100_000 }),
      node("b", { serviceTimeMs: 30, capacityRps: 100_000 }),
    );
    assert.ok(Math.abs(evaluate(graph, 10, SLO).meanMs - 40) < 0.1);
  });

  it("p95 de um recurso dominante fica perto de 3× a média, como manda a exponencial", () => {
    const point = evaluate(chain(node("a", { serviceTimeMs: 100, capacityRps: 100_000 })), 10, SLO);
    const razao = point.p95Ms / point.meanMs;
    assert.ok(razao > 2.7 && razao < 3.4, `razão p95/média = ${razao.toFixed(2)}`);
  });

  it("p99 é sempre maior que p95", () => {
    const point = evaluate(chain(node("a"), node("b", { serviceTimeMs: 40 })), 300, SLO);
    assert.ok(point.p99Ms > point.p95Ms);
  });
});

describe("saturação e erro", () => {
  it("não recusa nada abaixo da capacidade", () => {
    assert.equal(evaluate(chain(node("a", { capacityRps: 1000 })), 900, SLO).errorRatePct, 0);
  });

  it("recusa o excedente quando a carga passa da capacidade", () => {
    const point = evaluate(chain(node("a", { capacityRps: 1000 })), 2000, SLO);
    // Metade da carga não cabe.
    assert.ok(Math.abs(load(point, "a").rejectedRatio - 0.5) < 0.01);
    assert.ok(Math.abs(point.errorRatePct - 50) < 1);
  });

  it("aponta o recurso mais saturado como gargalo", () => {
    const graph = chain(
      node("largo", { capacityRps: 100_000 }),
      node("estreito", { capacityRps: 500 }),
    );
    assert.equal(evaluate(graph, 400, SLO).bottleneckNodeId, "estreito");
  });
});

describe("capacidade saudável vem do SLO", () => {
  it("SLO mais folgado permite mais carga", () => {
    const graph = chain(node("a", { capacityRps: 10_000, serviceTimeMs: 20 }));
    const apertado = maxHealthyRps(graph, { ...SLO, p95Ms: 100 }, 10_000);
    const folgado = maxHealthyRps(graph, { ...SLO, p95Ms: 400 }, 10_000);
    assert.ok(folgado > apertado, `${folgado} deveria superar ${apertado}`);
  });

  it("nunca devolve carga que viola o SLO", () => {
    const graph = chain(node("a", { capacityRps: 5000, serviceTimeMs: 25 }));
    const healthy = maxHealthyRps(graph, SLO, 5000);
    assert.equal(evaluate(graph, healthy, SLO).meetsSlo, true);
    assert.equal(evaluate(graph, healthy + 1, SLO).meetsSlo, false);
  });

  it("devolve zero quando nem a carga mínima cumpre o SLO", () => {
    const graph = chain(node("a", { serviceTimeMs: 5000, capacityRps: 10_000 }));
    assert.equal(maxHealthyRps(graph, SLO, 1000), 0);
  });

  it("aumentar a capacidade do gargalo aumenta a capacidade saudável", () => {
    const antes = chain(node("app", { capacityRps: 100_000 }), node("db", { capacityRps: 1000 }));
    const depois = chain(node("app", { capacityRps: 100_000 }), node("db", { capacityRps: 4000 }));
    assert.ok(maxHealthyRps(depois, SLO, 20_000) > maxHealthyRps(antes, SLO, 20_000));
  });
});

describe("execução do teste", () => {
  it("para no primeiro degrau que viola o SLO", () => {
    const graph = chain(node("db", { capacityRps: 600, serviceTimeMs: 20 }));
    const run = runCapacityTest(graph, { startRps: 100, incrementRps: 100, maxRps: 5000 }, SLO);

    assert.equal(run.steps.at(-1)?.verdict, "fail");
    assert.equal(run.steps.filter((step) => step.verdict === "fail").length, 1);
  });

  it("vai até o máximo quando a arquitetura aguenta tudo", () => {
    const graph = chain(node("a", { capacityRps: 1_000_000, serviceTimeMs: 1 }));
    const run = runCapacityTest(graph, { startRps: 100, incrementRps: 100, maxRps: 500 }, SLO);

    assert.equal(run.breakingPointRps, null);
    assert.equal(run.steps.length, 5);
  });

  it("mede as conexões pela Lei de Little", () => {
    // 1000 req/s com 50ms de permanência ocupam 50 conexões simultâneas.
    const graph = chain(
      node("db", { capacityRps: 100_000, serviceTimeMs: 50, concurrencyLimit: 100 }),
    );
    const run = runCapacityTest(graph, { startRps: 1000, incrementRps: 1000, maxRps: 1000 }, SLO);
    const conexoes = run.bottleneckMetrics.find((metric) => metric.key === "concurrency");

    assert.ok(conexoes, "o gargalo com limite de simultaneidade deve reportar conexões");
    assert.ok(Math.abs(conexoes.value - 50) <= 2, `${conexoes.value}% deveria ficar perto de 50%`);
  });

  it("devolve resultado vazio sem recursos", () => {
    const run = runCapacityTest({ origins: ["lg"], nodes: [], edges: [] }, { startRps: 1, incrementRps: 1, maxRps: 1 }, SLO);
    assert.equal(run.maxHealthyRps, 0);
  });
});
