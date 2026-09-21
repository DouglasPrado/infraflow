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
      payload: { kind: "plan", target: "aws" },
    });

    assert.equal(response.statusCode, 202);
    const run = response.json<{ id: string; status: string; slug: string; params: { target: string } }>();
    assert.equal(run.status, "QUEUED");
    assert.equal(run.params.target, "aws");
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
