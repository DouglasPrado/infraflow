import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { collectResourceMetrics } from "./prometheus.ts";

/**
 * Leitura do Prometheus do laboratório (PRD §78).
 *
 * O servidor aqui é de mentira, mas a resposta é a forma exata que o Prometheus
 * devolve — inclusive a unidade, que já vem em porcentagem apesar do sufixo
 * `_ratio` que o exportador acrescenta ao nome da métrica.
 */

let server: Server;
let baseUrl: string;
let consultas: string[] = [];

/** Resposta no formato de `/api/v1/query_range`. */
function range(values: [string, [number, string][]][]) {
  return {
    status: "success",
    data: {
      resultType: "matrix",
      result: values.map(([nodeId, points]) => ({
        metric: { infraflow_node: nodeId, infraflow_lab: "test-XYZ" },
        values: points,
      })),
    },
  };
}

before(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const query = url.searchParams.get("query") ?? "";
    consultas.push(query);

    const body = query.startsWith("container_cpu_utilization_ratio")
      ? range([
          // Mesmo número que o `docker stats` mostra: 19,85%.
          ["rds", [[1789900000, "19.85"], [1789900002, "12.4"]]],
          ["ecs", [[1789900000, "15.82"]]],
        ])
      : range([["rds", [[1789900000, String(29.43 * 1024 * 1024)]]]]);

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

after(() => {
  server.close();
});

describe("coleta de métricas (PRD §78)", () => {
  it("mantém a CPU na escala em que o Prometheus entrega", async () => {
    const samples = await collectResourceMetrics(baseUrl, "test-XYZ", {
      startedAt: new Date(1789900000 * 1000),
      finishedAt: new Date(1789900010 * 1000),
    });

    const cpu = samples.filter((sample) => sample.metric === "cpu");

    // A métrica já vem em porcentagem. Multiplicá-la por cem produzia leituras
    // impossíveis — 1985% de CPU numa máquina de quatro núcleos.
    assert.equal(cpu.find((sample) => sample.nodeId === "rds")?.value, 19.85);
    assert.equal(cpu.find((sample) => sample.nodeId === "ecs")?.value, 15.82);
    assert.ok(cpu.every((sample) => sample.unit === "%"));
  });

  it("converte memória de bytes para MB", async () => {
    const samples = await collectResourceMetrics(baseUrl, "test-XYZ", {
      startedAt: new Date(1789900000 * 1000),
      finishedAt: new Date(1789900010 * 1000),
    });

    const memoria = samples.find((sample) => sample.metric === "memory");
    assert.equal(memoria?.unit, "MB");
    assert.ok(Math.abs((memoria?.value ?? 0) - 29.43) < 0.01);
  });

  it("liga cada amostra ao node do canvas, com instante", async () => {
    const samples = await collectResourceMetrics(baseUrl, "test-XYZ", {
      startedAt: new Date(1789900000 * 1000),
      finishedAt: new Date(1789900010 * 1000),
    });

    assert.ok(samples.every((sample) => ["rds", "ecs"].includes(sample.nodeId)));
    assert.ok(samples.every((sample) => !Number.isNaN(Date.parse(sample.at))));
    // Duas amostras de CPU do banco viraram dois pontos, não um só.
    assert.equal(samples.filter((s) => s.nodeId === "rds" && s.metric === "cpu").length, 2);
  });

  it("recorta a janela da execução e escopa ao laboratório", async () => {
    consultas = [];
    await collectResourceMetrics(baseUrl, "test-XYZ", {
      startedAt: new Date(1789900000 * 1000),
      finishedAt: new Date(1789900010 * 1000),
    });

    assert.ok(consultas.every((query) => query.includes('infraflow_lab="test-XYZ"')));
  });

  it("devolve vazio quando o Prometheus não responde, sem inventar", async () => {
    const samples = await collectResourceMetrics("http://127.0.0.1:1", "test-XYZ", {
      startedAt: new Date(),
      finishedAt: new Date(),
    });
    assert.deepEqual(samples, []);
  });
});
