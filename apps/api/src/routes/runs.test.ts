import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.ts";
import { db } from "../db.ts";
import { runQueue } from "../queue.ts";

/**
 * Integração — exige Postgres e Redis (`docker compose up -d`).
 *
 * A API não executa nada: o teste confere que ela **enfileira** e devolve 202.
 * Quem roda OpenTofu é o worker (PRD §51), testado no próprio pacote.
 */

const suffix = Date.now().toString(36);
const dono = `runs-${suffix}@exemplo.test`;
const intruso = `runs-intruso-${suffix}@exemplo.test`;
const password = "uma-senha-boa-123";

let app: FastifyInstance;
let sessaoDono: string;
let sessaoIntruso: string;
let architectureId: string;

const as = (token: string) => ({ infraflow_session: token });

function document() {
  return {
    version: 1,
    name: "Arquitetura de execução",
    provider: "AWS",
    environment: "dev",
    nodes: [
      {
        kind: "resource",
        id: "alb",
        type: "aws.alb",
        name: "public-alb",
        position: { x: 0, y: 0 },
        properties: { scheme: "internet-facing", listeners: "HTTP:80" },
      },
    ],
    edges: [],
  };
}

async function registrar(email: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { name: email, email, password },
  });
  return response.cookies.find((cookie) => cookie.name === "infraflow_session")!.value;
}

before(async () => {
  app = await buildApp();
  sessaoDono = await registrar(dono);
  sessaoIntruso = await registrar(intruso);

  const workspace = await app.inject({
    method: "POST",
    url: "/me/workspace",
    cookies: as(sessaoDono),
    payload: { document: document() },
  });
  architectureId = workspace.json<{ architectureId: string }>().architectureId;
});

after(async () => {
  await db.user.deleteMany({ where: { email: { in: [dono, intruso] } } });
  await runQueue.obliterate({ force: true }).catch(() => undefined);
  await db.$disconnect();
  // `app.close()` encerra a fila pelo hook de ciclo de vida.
  await app.close();
});

describe("criar execução (PRD §75)", () => {
  it("responde 202 sem executar nada", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/architectures/${architectureId}/runs`,
      cookies: as(sessaoDono),
      payload: { kind: "plan", target: "docker" },
    });

    assert.equal(response.statusCode, 202);
    const run = response.json<{ id: string; status: string; slug: string; params: { target: string } }>();
    assert.equal(run.status, "QUEUED");
    assert.equal(run.params.target, "docker");
    // PRD §53 — cada execução tem identificador próprio.
    assert.match(run.slug, /^plan-[0-9A-F]{10}$/);

    const enfileirados = await runQueue.getJobs(["waiting", "active", "delayed"]);
    assert.ok(enfileirados.some((job) => job.data.runId === run.id));
  });

  it("recusa uma segunda execução enquanto a primeira não termina", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/architectures/${architectureId}/runs`,
      cookies: as(sessaoDono),
      payload: { kind: "plan" },
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.json<{ error: string }>().error, "execucao_em_andamento");
  });

  it("não cria execução em arquitetura alheia", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/architectures/${architectureId}/runs`,
      cookies: as(sessaoIntruso),
      payload: { kind: "plan" },
    });
    assert.equal(response.statusCode, 404);
  });

  it("recusa tudo sem sessão", async () => {
    for (const [method, url] of [
      ["POST", `/architectures/${architectureId}/runs`],
      ["GET", `/architectures/${architectureId}/runs`],
    ] as const) {
      const response = await app.inject({ method, url, payload: {} });
      assert.equal(response.statusCode, 401, `${method} ${url}`);
    }
  });
});

describe("ler execuções", () => {
  it("lista as execuções da arquitetura", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/architectures/${architectureId}/runs`,
      cookies: as(sessaoDono),
    });

    assert.equal(response.statusCode, 200);
    const runs = response.json<{ id: string; kind: string }[]>();
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.kind, "PLAN");
  });

  it("devolve o log da execução", async () => {
    const [run] = await db.run.findMany({ where: { architectureId }, take: 1 });
    const response = await app.inject({
      method: "GET",
      url: `/runs/${run!.id}`,
      cookies: as(sessaoDono),
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json<{ logs: string }>().logs, "");
    assert.equal(response.json<{ version: number }>().version, 1);
  });

  it("esconde execução alheia com 404", async () => {
    const [run] = await db.run.findMany({ where: { architectureId }, take: 1 });
    const response = await app.inject({
      method: "GET",
      url: `/runs/${run!.id}`,
      cookies: as(sessaoIntruso),
    });
    assert.equal(response.statusCode, 404);
  });
});

describe("teste de carga (PRD §77)", () => {
  it("recusa medir sem laboratório pronto", async () => {
    // A execução anterior já terminou? Limpa para não colidir com o 409 de
    // execução em andamento, que é outra regra.
    await db.run.updateMany({
      where: { architectureId, status: { in: ["QUEUED", "RUNNING"] } },
      data: { status: "FAILED", finishedAt: new Date(), error: "encerrada pelo teste" },
    });

    const response = await app.inject({
      method: "POST",
      url: `/architectures/${architectureId}/runs`,
      cookies: as(sessaoDono),
      payload: { kind: "load-test" },
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.json<{ error: string }>().error, "laboratorio_nao_esta_pronto");
  });

  it("enfileira contra o laboratório pronto, sempre no alvo docker", async () => {
    const version = await db.architectureVersion.findFirstOrThrow({ where: { architectureId } });
    const lab = await db.lab.create({
      data: {
        architectureId,
        versionId: version.id,
        slug: `test-pronto-${suffix}`,
        status: "READY",
        entryUrl: "http://127.0.0.1:18999",
        entryPort: 18999,
        workdir: "/tmp/nao-usado",
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    const response = await app.inject({
      method: "POST",
      url: `/architectures/${architectureId}/runs`,
      cookies: as(sessaoDono),
      payload: { kind: "load-test" },
    });

    assert.equal(response.statusCode, 202);
    const run = await db.run.findUniqueOrThrow({
      where: { id: response.json<{ id: string }>().id },
    });

    assert.equal(run.kind, "LOAD_TEST");
    assert.equal(run.labId, lab.id);
    // A carga nunca vai para a nuvem: mede-se o laboratório (§76).
    assert.deepEqual(run.params, { target: "docker" });
  });
});

describe("análise de gargalo observado (PRD §79)", () => {
  it("correlaciona a medição com a topologia ao ler a execução", async () => {
    const version = await db.architectureVersion.findFirstOrThrow({ where: { architectureId } });

    // Documento com caminho de carga: borda → aplicação → banco.
    await db.architectureVersion.update({
      where: { id: version.id },
      data: {
        graph: {
          version: 1,
          name: "Com caminho",
          provider: "AWS",
          environment: "dev",
          nodes: [
            {
              kind: "loadGenerator",
              id: "lg",
              name: "Capacity",
              position: { x: 0, y: 0 },
              target: { protocol: "HTTP", baseUrl: "http://x", headers: "", authentication: "", timeoutMs: 1000 },
              endpoints: [{ id: "e", method: "GET", path: "/", weight: 100 }],
              profile: { type: "Capacity", startRps: 100, incrementRps: 100, intervalSeconds: 10, maxRps: 300 },
              slo: { p95Ms: 500, p99Ms: 1000, errorRatePct: 1 },
            },
            { kind: "resource", id: "ecs", type: "aws.ecs", name: "api", position: { x: 0, y: 1 }, properties: {} },
            { kind: "resource", id: "rds", type: "aws.rds", name: "db", position: { x: 0, y: 2 }, properties: {} },
          ],
          edges: [
            { id: "a", source: "lg", target: "ecs", kind: "HTTP" },
            { id: "b", source: "ecs", target: "rds", kind: "Database" },
          ],
        },
      },
    });

    const start = Date.parse("2026-09-20T10:00:00.000Z");
    const stage = (targetRps: number, p95Ms: number, errorRatePct: number, index: number) => ({
      targetRps,
      rps: targetRps,
      p95Ms,
      errorRatePct,
      startedAt: new Date(start + index * 10_000).toISOString(),
      endedAt: new Date(start + (index + 1) * 10_000).toISOString(),
    });
    const sample = (nodeId: string, value: number, index: number) => ({
      nodeId,
      metric: "cpu",
      unit: "%",
      value,
      at: new Date(start + 5_000 + index * 10_000).toISOString(),
    });

    const run = await db.run.create({
      data: {
        architectureId,
        versionId: version.id,
        kind: "LOAD_TEST",
        slug: `load-test-analise-${suffix}`,
        status: "SUCCEEDED",
        finishedAt: new Date(),
        params: { target: "docker" },
        result: {
          startedAt: new Date(start).toISOString(),
          finishedAt: new Date(start + 30_000).toISOString(),
          durationSeconds: 30,
          requests: 6000,
          rps: 200,
          p50Ms: 30,
          p95Ms: 400,
          p99Ms: 900,
          errorRatePct: 1.5,
          meetsSlo: false,
          droppedIterations: 0,
          loadCeiling: "none",
          stages: [stage(100, 60, 0, 0), stage(200, 150, 0, 1), stage(300, 900, 5, 2)],
          metrics: [
            sample("rds", 30, 0),
            sample("rds", 65, 1),
            sample("rds", 97, 2),
            sample("ecs", 18, 0),
            sample("ecs", 26, 1),
            sample("ecs", 33, 2),
          ],
        },
      },
    });

    const response = await app.inject({
      method: "GET",
      url: `/runs/${run.id}`,
      cookies: as(sessaoDono),
    });

    assert.equal(response.statusCode, 200);
    const body = response.json<{
      analysis?: {
        maxHealthyRps: number;
        breakingStage?: { targetRps: number };
        candidates: { nodeId: string; metric: string; confidence: number }[];
        inconclusive?: string;
      };
    }>();

    assert.ok(body.analysis, "a leitura deveria trazer a análise");
    assert.equal(body.analysis.candidates[0]?.nodeId, "rds");
    assert.equal(body.analysis.breakingStage?.targetRps, 300);
    assert.equal(body.analysis.maxHealthyRps, 200);
    assert.equal(body.analysis.inconclusive, undefined);
  });

  it("não traz análise para execução que não é teste de carga", async () => {
    const [plan] = await db.run.findMany({ where: { architectureId, kind: "PLAN" }, take: 1 });
    if (!plan) return;

    const response = await app.inject({
      method: "GET",
      url: `/runs/${plan.id}`,
      cookies: as(sessaoDono),
    });

    assert.equal(response.json<{ analysis?: unknown }>().analysis, undefined);
  });
});
