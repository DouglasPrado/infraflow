import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.ts";
import { db } from "../db.ts";

/**
 * PRD §52 — credencial do projeto, cifrada, que nunca volta pela API.
 *
 * O teste não guarda credencial válida da AWS: o que está sob verificação é o
 * contrato — quem pode ler, o que a rota devolve e o que fica no banco.
 */

const suffix = Date.now().toString(36);
const dono = `cred-${suffix}@exemplo.test`;
const intruso = `cred-intruso-${suffix}@exemplo.test`;
const password = "uma-senha-boa-123";

let app: FastifyInstance;
let sessaoDono: string;
let sessaoIntruso: string;
let architectureId: string;

const as = (token: string) => ({ infraflow_session: token });

function document() {
  return {
    version: 1,
    name: "Arquitetura com credencial",
    provider: "AWS",
    environment: "dev",
    nodes: [
      {
        kind: "resource",
        id: "rds",
        type: "aws.rds",
        name: "banco",
        position: { x: 0, y: 0 },
        properties: { instanceClass: "db.t3.medium", storageGb: 100, multiAz: false },
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
  process.env.INFRAFLOW_SECRET_KEY ??= randomBytes(32).toString("base64");

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

describe("leitura da credencial (PRD §52)", () => {
  it("começa sem nenhuma", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/architectures/${architectureId}/credential`,
      cookies: as(sessaoDono),
    });

    assert.equal(response.statusCode, 200);
    const body = response.json<{ configured: boolean; canStore: boolean }>();
    assert.equal(body.configured, false);
    assert.equal(body.canStore, true);
  });

  it("esconde a de outro usuário", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/architectures/${architectureId}/credential`,
      cookies: as(sessaoIntruso),
    });
    assert.equal(response.statusCode, 404);
  });

  it("recusa tudo sem sessão", async () => {
    for (const [method, url] of [
      ["GET", `/architectures/${architectureId}/credential`],
      ["PUT", `/architectures/${architectureId}/credential`],
      ["DELETE", `/architectures/${architectureId}/credential`],
      ["GET", `/architectures/${architectureId}/pricing`],
    ] as const) {
      const response = await app.inject({ method, url, payload: {} });
      assert.equal(response.statusCode, 401, `${method} ${url}`);
    }
  });
});

describe("guardar a credencial", () => {
  it("recusa forma inválida antes de falar com a AWS", async () => {
    const response = await app.inject({
      method: "PUT",
      url: `/architectures/${architectureId}/credential`,
      cookies: as(sessaoDono),
      payload: { region: "REGIÃO INVÁLIDA", accessKeyId: "x", secretAccessKey: "y" },
    });
    assert.equal(response.statusCode, 400);
  });

  it("recusa credencial que a AWS não aceita", { timeout: 60_000 }, async () => {
    const response = await app.inject({
      method: "PUT",
      url: `/architectures/${architectureId}/credential`,
      cookies: as(sessaoDono),
      payload: {
        region: "us-east-1",
        accessKeyId: "AKIAIOSFODNN7EXEMPLO",
        secretAccessKey: "chave-secreta-que-nao-existe-de-verdade",
      },
    });

    // Verificada antes de gravar: credencial inválida não entra no banco.
    assert.equal(response.statusCode, 422);
    assert.equal(response.json<{ error: string }>().error, "credencial_invalida");

    const project = await db.project.findFirstOrThrow({ where: { architectures: { some: { id: architectureId } } } });
    assert.equal(await db.cloudCredential.count({ where: { projectId: project.id } }), 0);
  });

  it("não guarda credencial em projeto alheio", async () => {
    const response = await app.inject({
      method: "PUT",
      url: `/architectures/${architectureId}/credential`,
      cookies: as(sessaoIntruso),
      payload: { region: "us-east-1", accessKeyId: "AKIAIOSFODNN7EXEMPLO", secretAccessKey: "x".repeat(40) },
    });
    assert.equal(response.statusCode, 404);
  });
});

describe("o segredo não volta", () => {
  it("nenhuma rota devolve a chave, nem em campo escondido", async () => {
    const project = await db.project.findFirstOrThrow({
      where: { architectures: { some: { id: architectureId } } },
    });

    // Grava direto no banco, como se tivesse sido verificada.
    const { seal } = await import("@infraflow/db");
    await db.cloudCredential.create({
      data: {
        projectId: project.id,
        provider: "aws",
        region: "us-east-1",
        hint: "…MPLO",
        ...seal(JSON.stringify({ accessKeyId: "AKIASEGREDO", secretAccessKey: "NAO-PODE-VAZAR" })),
        accountId: "000000000000",
        verifiedAt: new Date(),
      },
    });

    const response = await app.inject({
      method: "GET",
      url: `/architectures/${architectureId}/credential`,
      cookies: as(sessaoDono),
    });

    assert.equal(response.statusCode, 200);
    assert.doesNotMatch(response.body, /NAO-PODE-VAZAR|AKIASEGREDO/);

    const body = response.json<{ configured: boolean; hint: string; accountId: string }>();
    assert.equal(body.configured, true);
    assert.equal(body.hint, "…MPLO");
    assert.equal(body.accountId, "000000000000");
  });

  it("o banco guarda cifrado, não em claro", async () => {
    // Escopado ao projeto do teste: o banco de desenvolvimento tem outras.
    const project = await db.project.findFirstOrThrow({
      where: { architectures: { some: { id: architectureId } } },
    });
    const stored = await db.cloudCredential.findFirstOrThrow({
      where: { projectId: project.id },
    });
    assert.doesNotMatch(stored.cipher, /NAO-PODE-VAZAR|AKIASEGREDO/);
    assert.ok(stored.iv.length > 0 && stored.tag.length > 0);
  });

  it("remover apaga do banco", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: `/architectures/${architectureId}/credential`,
      cookies: as(sessaoDono),
    });

    assert.equal(response.statusCode, 204);

    const project = await db.project.findFirstOrThrow({
      where: { architectures: { some: { id: architectureId } } },
    });
    assert.equal(await db.cloudCredential.count({ where: { projectId: project.id } }), 0);
  });
});

describe("preço sem credencial (PRD §40)", () => {
  it("responde que falta credencial, em vez de inventar preço", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/architectures/${architectureId}/pricing`,
      cookies: as(sessaoDono),
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.json<{ error: string }>().error, "credencial_ausente");
  });
});
