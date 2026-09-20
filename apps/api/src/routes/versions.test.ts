import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.ts";
import { db } from "../db.ts";

/** PRD §80 — v1 → test → modify → v2 → test → compare. */

const suffix = Date.now().toString(36);
const dono = `versoes-${suffix}@exemplo.test`;
const intruso = `versoes-intruso-${suffix}@exemplo.test`;
const password = "uma-senha-boa-123";

let app: FastifyInstance;
let sessaoDono: string;
let sessaoIntruso: string;
let architectureId: string;

const as = (token: string) => ({ infraflow_session: token });

function document(replicas: number) {
  return {
    version: 1,
    name: "Arquitetura versionada",
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
        profile: { type: "Capacity", startRps: 100, incrementRps: 400, intervalSeconds: 10, maxRps: 5000 },
        slo: { p95Ms: 500, p99Ms: 1000, errorRatePct: 1 },
      },
      {
        kind: "resource",
        id: "ecs",
        type: "aws.ecs",
        name: "api",
        position: { x: 0, y: 1 },
        properties: { cpu: "2 vCPU", autoScaling: true, minReplicas: 2, maxReplicas: replicas, desiredReplicas: 2 },
      },
    ],
    edges: [{ id: "a", source: "lg", target: "ecs", kind: "HTTP" }],
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
    payload: { document: document(4) },
  });
  architectureId = workspace.json<{ architectureId: string }>().architectureId;

  // v1 congelada, depois o canvas muda e vira v2 (§80 — modify).
  await app.inject({
    method: "POST",
    url: `/architectures/${architectureId}/versions`,
    cookies: as(sessaoDono),
    payload: { label: "linha de base" },
  });
  await app.inject({
    method: "PUT",
    url: `/architectures/${architectureId}`,
    cookies: as(sessaoDono),
    payload: { document: document(20) },
  });
});

after(async () => {
  await db.user.deleteMany({ where: { email: { in: [dono, intruso] } } });
  await db.$disconnect();
  await app.close();
});

describe("listar versões (PRD §38)", () => {
  it("devolve da mais nova para a mais velha", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/architectures/${architectureId}/versions`,
      cookies: as(sessaoDono),
    });

    assert.equal(response.statusCode, 200);
    const versions = response.json<{ number: number; label: string | null; tested: boolean }[]>();
    assert.deepEqual(versions.map((version) => version.number), [2, 1]);
    assert.equal(versions[1]!.label, "linha de base");
    // Nenhuma foi medida ainda.
    assert.ok(versions.every((version) => version.tested === false));
  });

  it("esconde versões de arquitetura alheia", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/architectures/${architectureId}/versions`,
      cookies: as(sessaoIntruso),
    });
    assert.equal(response.statusCode, 404);
  });
});

describe("comparar versões (PRD §39)", () => {
  it("mostra a capacidade estimada subindo e o diff que a explica", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/architectures/${architectureId}/compare?from=1&to=2`,
      cookies: as(sessaoDono),
    });

    assert.equal(response.statusCode, 200);
    const body = response.json<{
      from: { number: number };
      to: { number: number };
      estimated: { capacityRps: { from: number; to: number; delta: number }; from: { costPer1kRps: number } };
      diff: { identical: boolean; nodes: { changed: { properties: { key: string }[] }[] } };
      observed?: unknown;
    }>();

    assert.equal(body.from.number, 1);
    assert.equal(body.to.number, 2);
    assert.ok(body.estimated.capacityRps.delta > 0);
    assert.ok(body.estimated.from.costPer1kRps > 0);
    assert.equal(body.diff.identical, false);
    assert.ok(
      body.diff.nodes.changed[0]!.properties.some((property) => property.key === "maxReplicas"),
    );
    // Nenhuma das duas foi medida: não há lado observado.
    assert.equal(body.observed, undefined);
  });

  it("recusa versão inexistente", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/architectures/${architectureId}/compare?from=1&to=99`,
      cookies: as(sessaoDono),
    });
    assert.equal(response.statusCode, 404);
  });

  it("recusa parâmetro que não é versão", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/architectures/${architectureId}/compare?from=abc&to=2`,
      cookies: as(sessaoDono),
    });
    assert.equal(response.statusCode, 400);
  });
});

describe("clonar (PRD §80)", () => {
  it("cria uma arquitetura nova a partir da versão escolhida", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/architectures/${architectureId}/clone`,
      cookies: as(sessaoDono),
      payload: { version: 1 },
    });

    assert.equal(response.statusCode, 201);
    const clone = response.json<{ id: string; name: string; fromVersion: number }>();
    assert.equal(clone.fromVersion, 1);
    assert.notEqual(clone.id, architectureId);

    // O clone nasce com uma versão só, e com o documento da origem.
    const versions = await app.inject({
      method: "GET",
      url: `/architectures/${clone.id}/versions`,
      cookies: as(sessaoDono),
    });
    assert.deepEqual(versions.json<{ number: number }[]>().map((v) => v.number), [1]);

    const document = await app.inject({
      method: "GET",
      url: `/architectures/${clone.id}`,
      cookies: as(sessaoDono),
    });
    const graph = document.json<{ document: { name: string; nodes: { id: string }[] } }>();
    assert.equal(graph.document.name, clone.name);
    assert.deepEqual(graph.document.nodes.map((node) => node.id), ["lg", "ecs"]);
  });

  it("a original continua intacta", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/architectures/${architectureId}/versions`,
      cookies: as(sessaoDono),
    });
    assert.equal(response.json<unknown[]>().length, 2);
  });

  it("não clona arquitetura alheia", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/architectures/${architectureId}/clone`,
      cookies: as(sessaoIntruso),
      payload: {},
    });
    assert.equal(response.statusCode, 404);
  });

  it("recusa tudo sem sessão", async () => {
    for (const [method, url] of [
      ["GET", `/architectures/${architectureId}/versions`],
      ["GET", `/architectures/${architectureId}/compare?from=1&to=2`],
      ["POST", `/architectures/${architectureId}/clone`],
    ] as const) {
      const response = await app.inject({ method, url, payload: {} });
      assert.equal(response.statusCode, 401, `${method} ${url}`);
    }
  });
});
