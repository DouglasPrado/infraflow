import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.ts";
import { db } from "../db.ts";

/**
 * Testes de integração — exigem o Postgres do `docker compose up -d`.
 * A API é fina, então o que vale testar é a fronteira: o que ela aceita, o que
 * rejeita e com qual código.
 */

const slug = `test-${Date.now().toString(36)}`;
let app: FastifyInstance;
let architectureId: string;

function document(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    name: "Arquitetura de teste",
    provider: "AWS",
    environment: "dev",
    nodes: [
      {
        kind: "resource",
        id: "alb",
        type: "aws.alb",
        name: "public-alb",
        position: { x: 0, y: 0 },
        properties: { scheme: "internet-facing" },
      },
      {
        kind: "note",
        id: "n1",
        variant: "sticky",
        text: "nota",
        position: { x: 9, y: 9 },
        width: 210,
        height: 120,
      },
    ],
    edges: [],
    ...overrides,
  };
}

before(async () => {
  app = await buildApp();
  await app.inject({ method: "POST", url: "/projects", payload: { name: "Teste", slug } });

  const created = await app.inject({
    method: "POST",
    url: `/projects/${slug}/architectures`,
    payload: { document: document() },
  });
  architectureId = created.json<{ id: string }>().id;
});

after(async () => {
  await db.project.deleteMany({ where: { slug } });
  await db.$disconnect();
  await app.close();
});

describe("health", () => {
  it("reporta o banco de pé", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json<{ database: string }>().database, "up");
  });
});

describe("projects", () => {
  it("recusa slug já usado", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/projects",
      payload: { name: "Outro", slug },
    });
    assert.equal(response.statusCode, 409);
  });

  it("recusa slug com formato inválido", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/projects",
      payload: { name: "Outro", slug: "Com Espaço" },
    });
    assert.equal(response.statusCode, 400);
  });

  it("devolve 404 para projeto inexistente", async () => {
    const response = await app.inject({ method: "GET", url: "/projects/nao-existe/architectures" });
    assert.equal(response.statusCode, 404);
  });
});

describe("architectures", () => {
  it("recusa documento que não bate com o schema", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/projects/${slug}/architectures`,
      payload: { document: { version: 1, name: "x" } },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json<{ error: string }>().error, "documento_invalido");
  });

  it("recusa documento estruturalmente válido mas incoerente", async () => {
    const response = await app.inject({
      method: "PUT",
      url: `/architectures/${architectureId}`,
      payload: { document: document({ edges: [{ id: "e", source: "alb", target: "fantasma", kind: "HTTP" }] }) },
    });
    assert.equal(response.statusCode, 422);
    assert.equal(response.json<{ error: string }>().error, "documento_incoerente");
  });

  it("autosave grava por cima sem criar versão", async () => {
    const response = await app.inject({
      method: "PUT",
      url: `/architectures/${architectureId}`,
      payload: { document: document({ environment: "staging" }) },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json<{ version: number }>().version, 1);

    const read = await app.inject({ method: "GET", url: `/architectures/${architectureId}` });
    assert.equal(read.json<{ document: { environment: string } }>().document.environment, "staging");
  });

  it("snapshot cria a próxima versão", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/architectures/${architectureId}/versions`,
      payload: { label: "marco" },
    });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json<{ version: number }>().version, 2);
  });

  it("devolve 404 para arquitetura inexistente", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/architectures/00000000-0000-4000-8000-000000000000",
    });
    assert.equal(response.statusCode, 404);
  });

  it("recusa id que não é uuid", async () => {
    const response = await app.inject({ method: "GET", url: "/architectures/abc" });
    assert.equal(response.statusCode, 400);
  });

  it("projeta architecture.json sem as notas", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/architectures/${architectureId}/architecture.json`,
    });
    assert.equal(response.statusCode, 200);

    const json = response.json<{ nodes: { id: string }[] }>();
    assert.deepEqual(
      json.nodes.map((node) => node.id),
      ["alb"],
    );
  });
});
