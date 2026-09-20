import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.ts";
import { db } from "../db.ts";
import { runQueue } from "../queue.ts";

/** Integração — exige Postgres e Redis. A API enfileira; o worker aplica (§51). */

const suffix = Date.now().toString(36);
const dono = `labs-${suffix}@exemplo.test`;
const intruso = `labs-intruso-${suffix}@exemplo.test`;
const password = "uma-senha-boa-123";

let app: FastifyInstance;
let sessaoDono: string;
let sessaoIntruso: string;
let architectureId: string;
let labId: string;

const as = (token: string) => ({ infraflow_session: token });

function document() {
  return {
    version: 1,
    name: "Arquitetura de laboratório",
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
  await app.close();
});

describe("criar laboratório (PRD §76)", () => {
  it("responde 202 com o ambiente em criação e o job na fila", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/architectures/${architectureId}/labs`,
      cookies: as(sessaoDono),
    });

    assert.equal(response.statusCode, 202);
    const lab = response.json<{ id: string; slug: string; status: string; runId: string }>();
    labId = lab.id;

    assert.equal(lab.status, "CREATING");
    // PRD §53 — infra temporária com identificador próprio.
    assert.match(lab.slug, /^test-[0-9A-F]{10}$/);

    const enfileirados = await runQueue.getJobs(["waiting", "active", "delayed"]);
    assert.ok(enfileirados.some((job) => job.data.runId === lab.runId));

    const run = await db.run.findUniqueOrThrow({ where: { id: lab.runId } });
    assert.equal(run.kind, "LAB_APPLY");
    // O laboratório nunca aplica na nuvem (§75).
    assert.deepEqual(run.params, { target: "docker" });
  });

  it("recusa um segundo laboratório enquanto o primeiro vive", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/architectures/${architectureId}/labs`,
      cookies: as(sessaoDono),
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.json<{ error: string }>().error, "laboratorio_em_andamento");
  });

  it("nasce com prazo de validade (§54)", async () => {
    const lab = await db.lab.findUniqueOrThrow({ where: { id: labId } });
    assert.ok(lab.expiresAt.getTime() > Date.now());
  });

  it("não cria laboratório em arquitetura alheia", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/architectures/${architectureId}/labs`,
      cookies: as(sessaoIntruso),
    });
    assert.equal(response.statusCode, 404);
  });
});

describe("destruir laboratório (PRD §54)", () => {
  it("esconde laboratório alheio com 404", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: `/labs/${labId}`,
      cookies: as(sessaoIntruso),
    });
    assert.equal(response.statusCode, 404);
  });

  it("enfileira a destruição", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: `/labs/${labId}`,
      cookies: as(sessaoDono),
    });

    assert.equal(response.statusCode, 202);
    const run = await db.run.findUniqueOrThrow({
      where: { id: response.json<{ runId: string }>().runId },
    });
    assert.equal(run.kind, "LAB_DESTROY");
  });

  it("recusa destruir o que já foi destruído", async () => {
    // Laboratório próprio, gravado já destruído: se o teste reaproveitasse o
    // anterior, um worker ligado poderia mexer no estado no meio do caminho.
    const version = await db.architectureVersion.findFirstOrThrow({ where: { architectureId } });
    const destruido = await db.lab.create({
      data: {
        architectureId,
        versionId: version.id,
        slug: `test-destruido-${suffix}`,
        status: "DESTROYED",
        workdir: "",
        expiresAt: new Date(),
      },
    });

    const response = await app.inject({
      method: "DELETE",
      url: `/labs/${destruido.id}`,
      cookies: as(sessaoDono),
    });
    assert.equal(response.statusCode, 409);
  });
});

describe("acesso", () => {
  it("recusa tudo sem sessão", async () => {
    for (const [method, url] of [
      ["POST", `/architectures/${architectureId}/labs`],
      ["GET", `/architectures/${architectureId}/labs`],
      ["DELETE", `/labs/${labId}`],
    ] as const) {
      const response = await app.inject({ method, url });
      assert.equal(response.statusCode, 401, `${method} ${url}`);
    }
  });
});
