import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.ts";
import { db } from "../db.ts";

/** Testes de integração — exigem o Postgres do `docker compose up -d`. */

const suffix = Date.now().toString(36);
const dono = `dono-${suffix}@exemplo.test`;
const intruso = `intruso-${suffix}@exemplo.test`;
const password = "uma-senha-boa-123";

let app: FastifyInstance;
let sessaoDono: string;
let sessaoIntruso: string;
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

async function registrar(email: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { name: email, email, password },
  });
  return response.cookies.find((cookie) => cookie.name === "infraflow_session")!.value;
}

const as = (token: string) => ({ infraflow_session: token });

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
  await db.$disconnect();
  await app.close();
});

describe("acesso", () => {
  it("recusa tudo sem sessão", async () => {
    for (const [method, url] of [
      ["GET", "/me/architectures"],
      ["POST", "/me/workspace"],
      ["GET", `/architectures/${architectureId}`],
      ["PUT", `/architectures/${architectureId}`],
      ["POST", `/architectures/${architectureId}/versions`],
      ["GET", `/architectures/${architectureId}/architecture.json`],
    ] as const) {
      const response = await app.inject({ method, url, payload: {} });
      assert.equal(response.statusCode, 401, `${method} ${url}`);
    }
  });

  it("esconde a arquitetura de outro usuário com 404, não 403", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/architectures/${architectureId}`,
      cookies: as(sessaoIntruso),
    });
    // 403 confirmaria que o recurso existe.
    assert.equal(response.statusCode, 404);
  });

  it("impede outro usuário de gravar por cima", async () => {
    const response = await app.inject({
      method: "PUT",
      url: `/architectures/${architectureId}`,
      cookies: as(sessaoIntruso),
      payload: { document: document({ name: "invadida" }) },
    });
    assert.equal(response.statusCode, 404);

    const leitura = await app.inject({
      method: "GET",
      url: `/architectures/${architectureId}`,
      cookies: as(sessaoDono),
    });
    assert.equal(leitura.json<{ document: { name: string } }>().document.name, "Arquitetura de teste");
  });

  it("não lista a arquitetura alheia", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/me/architectures",
      cookies: as(sessaoIntruso),
    });
    assert.deepEqual(response.json(), []);
  });
});

describe("workspace", () => {
  it("é idempotente: não cria uma segunda arquitetura", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/me/workspace",
      cookies: as(sessaoDono),
      payload: { document: document({ name: "outra" }) },
    });

    assert.equal(response.json<{ created: boolean }>().created, false);
    assert.equal(response.json<{ architectureId: string }>().architectureId, architectureId);
  });
});

describe("persistência", () => {
  it("recusa documento que não bate com o schema", async () => {
    const response = await app.inject({
      method: "PUT",
      url: `/architectures/${architectureId}`,
      cookies: as(sessaoDono),
      payload: { document: { version: 1, name: "x" } },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json<{ error: string }>().error, "documento_invalido");
  });

  it("recusa documento válido no schema mas incoerente", async () => {
    const response = await app.inject({
      method: "PUT",
      url: `/architectures/${architectureId}`,
      cookies: as(sessaoDono),
      payload: {
        document: document({ edges: [{ id: "e", source: "alb", target: "fantasma", kind: "HTTP" }] }),
      },
    });
    assert.equal(response.statusCode, 422);
    assert.equal(response.json<{ error: string }>().error, "documento_incoerente");
  });

  it("autosave grava por cima sem criar versão", async () => {
    const response = await app.inject({
      method: "PUT",
      url: `/architectures/${architectureId}`,
      cookies: as(sessaoDono),
      payload: { document: document({ environment: "staging" }) },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json<{ version: number }>().version, 1);

    const leitura = await app.inject({
      method: "GET",
      url: `/architectures/${architectureId}`,
      cookies: as(sessaoDono),
    });
    assert.equal(leitura.json<{ document: { environment: string } }>().document.environment, "staging");
  });

  it("snapshot cria a próxima versão", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/architectures/${architectureId}/versions`,
      cookies: as(sessaoDono),
      payload: { label: "marco" },
    });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json<{ version: number }>().version, 2);
  });

  it("recusa id que não é uuid", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/architectures/abc",
      cookies: as(sessaoDono),
    });
    assert.equal(response.statusCode, 400);
  });

  it("projeta architecture.json sem as notas", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/architectures/${architectureId}/architecture.json`,
      cookies: as(sessaoDono),
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(
      response.json<{ nodes: { id: string }[] }>().nodes.map((node) => node.id),
      ["alb"],
    );
  });
});
