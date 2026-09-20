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
      ["GET", `/architectures/${architectureId}/validation`],
      ["GET", `/architectures/${architectureId}/reports`],
      ["GET", `/architectures/${architectureId}/reports/GOAL.md`],
      ["GET", `/architectures/${architectureId}/opentofu`],
      ["GET", `/architectures/${architectureId}/opentofu/main.tf`],
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

describe("validação semântica (PRD §72)", () => {
  it("aponta o balanceador sem destino do documento gravado", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/architectures/${architectureId}/validation`,
      cookies: as(sessaoDono),
    });

    assert.equal(response.statusCode, 200);
    const body = response.json<{
      summary: { errors: number; blocking: boolean };
      issues: { code: string; subjectId: string }[];
    }>();

    // O documento de teste tem um ALB sozinho: sem destino e sem quem o alcance.
    assert.ok(body.issues.some((issue) => issue.code === "missing-dependency"));
    assert.equal(body.summary.blocking, true);
  });

  it("não valida arquitetura de outro usuário", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/architectures/${architectureId}/validation`,
      cookies: as(sessaoIntruso),
    });
    assert.equal(response.statusCode, 404);
  });
});

describe("relatórios (PRD §73)", () => {
  it("lista os artefatos da versão corrente", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/architectures/${architectureId}/reports`,
      cookies: as(sessaoDono),
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(
      response.json<{ files: { name: string }[] }>().files.map((file) => file.name),
      ["ARCHITECTURE.md", "CAPACITY.md", "LOAD-TEST.md", "GOAL.md", "architecture.json"],
    );
  });

  it("entrega o artefato como anexo, gerado do documento gravado", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/architectures/${architectureId}/reports/ARCHITECTURE.md`,
      cookies: as(sessaoDono),
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"] as string, /text\/markdown/);
    assert.equal(
      response.headers["content-disposition"],
      'attachment; filename="ARCHITECTURE.md"',
    );
    // O nome do recurso vem do documento persistido, não de texto fixo.
    assert.match(response.body, /`public-alb`/);
  });

  it("recusa nome que não é artefato conhecido", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/architectures/${architectureId}/reports/..%2F..%2Fetc%2Fpasswd`,
      cookies: as(sessaoDono),
    });
    assert.equal(response.statusCode, 400);
  });

  it("não gera relatório de arquitetura alheia", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/architectures/${architectureId}/reports/GOAL.md`,
      cookies: as(sessaoIntruso),
    });
    assert.equal(response.statusCode, 404);
  });
});

describe("OpenTofu (PRD §74)", () => {
  it("lista os arquivos e o que não foi traduzido", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/architectures/${architectureId}/opentofu`,
      cookies: as(sessaoDono),
    });

    assert.equal(response.statusCode, 200);
    const body = response.json<{
      target: string;
      files: { name: string }[];
      compiledNodeIds: string[];
      warnings: { code: string }[];
    }>();

    assert.equal(body.target, "aws");
    assert.deepEqual(
      body.files.map((file) => file.name),
      ["providers.tf", "main.tf", "variables.tf", "outputs.tf", "terraform.tfvars.example"],
    );
    assert.deepEqual(body.compiledNodeIds, ["alb"]);
    assert.ok(body.warnings.length > 0);
  });

  it("entrega o main.tf compilado do documento gravado", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/architectures/${architectureId}/opentofu/main.tf`,
      cookies: as(sessaoDono),
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["content-disposition"], 'attachment; filename="main.tf"');
    assert.match(response.body, /resource "aws_vpc" "main"/);
    assert.match(response.body, /resource "aws_lb" "public_alb"/);
  });

  it("recusa arquivo fora da lista do §34", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/architectures/${architectureId}/opentofu/secrets.tf`,
      cookies: as(sessaoDono),
    });
    assert.equal(response.statusCode, 400);
  });

  it("não compila arquitetura alheia", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/architectures/${architectureId}/opentofu`,
      cookies: as(sessaoIntruso),
    });
    assert.equal(response.statusCode, 404);
  });
});
