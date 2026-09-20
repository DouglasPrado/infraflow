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

/**
 * Cada caso aqui é um defeito que a bancada de calibração encontrou rodando k6
 * de verdade contra alvos de latência conhecida. O comentário diz o que a
 * medição mostrava antes da correção.
 */
describe("calibração do gerador", () => {
  it("marca o degrau pelo relógio do cenário, não pelo do VU", () => {
    // Antes: `Date.now()` no módulo, que roda uma vez por VU. Contra um alvo de
    // 200ms, VUs criados no meio do teste marcavam tudo como primeiro degrau —
    // o degrau 1 media 303 req/s para um pedido de 100.
    const script = buildScript(spec());

    assert.match(script, /import exec from "k6\/execution"/);
    assert.match(script, /exec\.scenario\.startTime/);
    assert.doesNotMatch(script, /const START = Date\.now\(\)/);
  });

  it("dimensiona os VUs pela latência esperada, não por uma constante", () => {
    // Antes: `maxRps / 10`, que assume 100ms. Contra 200ms o pool nascia pela
    // metade e o k6 descartava iterações — limite do gerador lido como limite
    // da arquitetura.
    const perfil = { type: "Capacity" as const, startRps: 100, incrementRps: 100, intervalSeconds: 5, maxRps: 1000 };

    const lento = buildScript({ ...spec({ profile: perfil }), expectedLatencyMs: 400 });
    const rápido = buildScript({ ...spec({ profile: perfil }), expectedLatencyMs: 20 });

    const vus = (script: string) => ({
      pré: Number(/preAllocatedVUs: (\d+)/.exec(script)?.[1]),
      max: Number(/maxVUs: (\d+)/.exec(script)?.[1]),
    });

    // Lei de Little: 1000 req/s × 0,4s = 400 simultâneas.
    assert.equal(vus(lento).pré, 600);
    assert.equal(vus(lento).max, 1600);

    // O mesmo perfil num alvo rápido não precisa do mesmo pool.
    assert.ok(vus(rápido).pré < vus(lento).pré);
  });

  it("separa teto da arquitetura de teto do gerador", () => {
    // Antes: só `droppedIterations`, que é idêntico nos dois casos. A bancada
    // produziu os dois com a mesma contagem de descartes e causas opostas.
    const ladder = buildLadder(spec());
    const janela = { startedAt: new Date(0), finishedAt: new Date(15_000) };

    const execução = (degraus: { p95: number; erro: number }[], descartes: number) =>
      parseSummary(
        {
          state: { testRunDurationMs: 15_000 },
          metrics: {
            http_reqs: { values: { count: 100 } },
            dropped_iterations: { values: { count: descartes } },
            ...Object.fromEntries(
              degraus.flatMap((d, i) => [
                [`http_reqs{stage:${i + 1}}`, { values: { count: 100 } }],
                [`http_req_duration{stage:${i + 1}}`, { values: { "p(95)": d.p95 } }],
                [`http_req_failed{stage:${i + 1}}`, { values: { rate: d.erro } }],
              ]),
            ),
          },
        },
        { ladder, ...janela },
      );

    const saudável = [{ p95: 301, erro: 0 }, { p95: 302, erro: 0 }, { p95: 301, erro: 0 }];
    const saturado = [{ p95: 10, erro: 0 }, { p95: 11, erro: 0 }, { p95: 10_000, erro: 0.12 }];

    // Latência plana e sem erro: o alvo aguentava, quem não deu conta foi o
    // gerador — o número não serve de teto.
    assert.equal(execução(saudável, 980).loadCeiling, "generator");

    // Latência inflada e erro subindo: o alvo cedeu, o platô medido é real.
    assert.equal(execução(saturado, 980).loadCeiling, "architecture");

    // Sem descarte não há teto a atribuir.
    assert.equal(execução(saturado, 0).loadCeiling, "none");
  });

  it("não afirma teto da arquitetura sem escada para comparar", () => {
    // Um degrau só não tem linha de base: `generator` é o palpite seguro,
    // porque manda repetir o teste em vez de acreditar num teto falso.
    const único = spec({
      profile: { type: "Capacity", startRps: 100, incrementRps: 100, intervalSeconds: 5, maxRps: 100 },
    });

    const observação = parseSummary(
      {
        state: { testRunDurationMs: 5000 },
        metrics: {
          http_reqs: { values: { count: 100 } },
          dropped_iterations: { values: { count: 50 } },
          "http_reqs{stage:1}": { values: { count: 100 } },
          "http_req_duration{stage:1}": { values: { "p(95)": 9000 } },
          "http_req_failed{stage:1}": { values: { rate: 0.5 } },
        },
      },
      { ladder: buildLadder(único), startedAt: new Date(0), finishedAt: new Date(5000) },
    );

    assert.equal(observação.loadCeiling, "generator");
  });
});
