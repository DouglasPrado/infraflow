import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildLadder, buildScript, parseSummary, type LoadTestSpec } from "./index.ts";

function spec(overrides: Partial<LoadTestSpec["generator"]> = {}): LoadTestSpec {
  return {
    baseUrl: "http://127.0.0.1:18100",
    generator: {
      target: {
        protocol: "HTTPS",
        baseUrl: "https://api.example.com",
        headers: "Content-Type: application/json",
        authentication: "Bearer token",
        timeoutMs: 10_000,
      },
      endpoints: [
        { id: "a", method: "GET", path: "/products", weight: 40 },
        { id: "b", method: "POST", path: "/checkout", weight: 10 },
      ],
      profile: {
        type: "Capacity",
        startRps: 100,
        incrementRps: 100,
        intervalSeconds: 5,
        maxRps: 300,
      },
      slo: { p95Ms: 500, p99Ms: 1000, errorRatePct: 1 },
      ...overrides,
    },
  };
}

describe("escada de carga (PRD §18)", () => {
  it("sai do perfil configurado", () => {
    assert.deepEqual(
      buildLadder(spec()).map((step) => step.targetRps),
      [100, 200, 300],
    );
  });

  it("cada degrau dura o intervalo do perfil", () => {
    assert.ok(buildLadder(spec()).every((step) => step.durationSeconds === 5));
  });
});

describe("script do k6 (PRD §77)", () => {
  const script = buildScript(spec());

  it("mira o laboratório, não o alvo pretendido do canvas", () => {
    assert.match(script, /const BASE_URL = "http:\/\/127\.0\.0\.1:18100"/);
    assert.doesNotMatch(script, /BASE_URL = "https:\/\/api\.example\.com"/);
  });

  it("leva os endpoints e os pesos do workload", () => {
    assert.match(script, /"path":"\/products","share":0\.8/);
    assert.match(script, /"path":"\/checkout","share":0\.2/);
    assert.match(script, /"method":"POST"/);
  });

  it("transforma o SLO em limiar do próprio k6", () => {
    assert.match(script, /"http_req_duration": \["p\(95\)<500", "p\(99\)<1000"\]/);
    assert.match(script, /"http_req_failed": \["rate<0\.01"\]/);
  });

  it("faz cada degrau ser degrau, não rampa", () => {
    // Duração zero antes de cada patamar: sem isso o k6 interpola a subida.
    assert.match(script, /\{"target":200,"duration":"0s"\},\{"target":200,"duration":"5s"\}/);
  });

  it("declara limiar por degrau para o k6 publicar a medição", () => {
    for (const stage of [1, 2, 3]) {
      assert.match(script, new RegExp(`"http_reqs\\{stage:${stage}\\}"`));
      assert.match(script, new RegExp(`"http_req_duration\\{stage:${stage}\\}"`));
    }
  });

  it("leva cabeçalhos e autenticação do painel", () => {
    assert.match(script, /"Content-Type":"application\/json"/);
    assert.match(script, /"Authorization":"Bearer token"/);
  });

  it("é determinístico", () => {
    assert.equal(buildScript(spec()), buildScript(spec()));
  });

  it("normaliza pesos que não somam 100", () => {
    const script = buildScript(
      spec({
        endpoints: [
          { id: "a", method: "GET", path: "/a", weight: 3 },
          { id: "b", method: "GET", path: "/b", weight: 1 },
        ],
      }),
    );
    assert.match(script, /"path":"\/a","share":0\.75/);
  });
});

describe("leitura do resumo (PRD §77, §78)", () => {
  const ladder = buildLadder(spec());
  const startedAt = new Date("2026-09-20T10:00:00.000Z");
  const finishedAt = new Date("2026-09-20T10:00:15.000Z");

  const summary = {
    state: { testRunDurationMs: 15_000 },
    metrics: {
      http_reqs: { values: { count: 3000, rate: 200 } },
      http_req_failed: { values: { rate: 0.012 }, thresholds: { "rate<0.01": { ok: false } } },
      http_req_duration: {
        values: { "p(50)": 40, "p(95)": 320, "p(99)": 780 },
        thresholds: { "p(95)<500": { ok: true }, "p(99)<1000": { ok: true } },
      },
      dropped_iterations: { values: { count: 12 } },
      "http_reqs{stage:1}": { values: { count: 500, rate: 33 } },
      "http_req_duration{stage:1}": { values: { "p(95)": 90 } },
      "http_req_failed{stage:1}": { values: { rate: 0 } },
      "http_reqs{stage:2}": { values: { count: 1000, rate: 66 } },
      "http_req_duration{stage:2}": { values: { "p(95)": 210 } },
      "http_req_failed{stage:2}": { values: { rate: 0.004 } },
      "http_reqs{stage:3}": { values: { count: 1400, rate: 93 } },
      "http_req_duration{stage:3}": { values: { "p(95)": 760 } },
      "http_req_failed{stage:3}": { values: { rate: 0.03 } },
    },
  };

  const observation = parseSummary(summary, { ladder, startedAt, finishedAt });

  it("lê a vazão e os quantis medidos", () => {
    assert.equal(observation.requests, 3000);
    assert.equal(observation.rps, 200);
    assert.equal(observation.p50Ms, 40);
    assert.equal(observation.p99Ms, 780);
    assert.equal(observation.errorRatePct, 1.2);
  });

  it("calcula a vazão do degrau pela duração dele, não pela da execução", () => {
    // 500 requisições em 5s são 100 req/s, não 33.
    assert.equal(observation.stages[0]!.rps, 100);
    assert.equal(observation.stages[2]!.rps, 280);
  });

  it("guarda o alvo pedido ao lado do alcançado", () => {
    assert.equal(observation.stages[2]!.targetRps, 300);
    assert.equal(observation.stages[2]!.errorRatePct, 3);
  });

  it("reprova o SLO quando o próprio k6 reprovou", () => {
    assert.equal(observation.meetsSlo, false);
  });

  it("registra o que o gerador não conseguiu disparar", () => {
    assert.equal(observation.droppedIterations, 12);
  });

  it("não inventa número quando a métrica não veio", () => {
    const vazio = parseSummary({ state: {}, metrics: {} }, { ladder, startedAt, finishedAt });
    assert.equal(vazio.requests, 0);
    assert.equal(vazio.rps, 0);
    assert.deepEqual(
      vazio.stages.map((stage) => stage.rps),
      [0, 0, 0],
    );
  });
});
