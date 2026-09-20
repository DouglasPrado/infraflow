import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.ts";
import type { AssistantRequest } from "../assistant/claude.ts";
import { buildPrompt } from "../assistant/claude.ts";
import { db } from "../db.ts";

/**
 * PRD §81 — o assistente responde a partir do que o sistema apurou.
 *
 * O transporte é substituído por um espião: o que está sob teste é o contexto
 * que chega ao modelo, não o modelo. Assim o teste roda sem credencial e sem
 * gastar chamada.
 */

const suffix = Date.now().toString(36);
const dono = `assistente-${suffix}@exemplo.test`;
const intruso = `assistente-intruso-${suffix}@exemplo.test`;
const password = "uma-senha-boa-123";

let app: FastifyInstance;
let sessaoDono: string;
let sessaoIntruso: string;
let architectureId: string;

/** Última requisição que chegaria ao modelo. */
let recebido: AssistantRequest | null = null;

const as = (token: string) => ({ infraflow_session: token });

function document() {
  return {
    version: 1,
    name: "Arquitetura do assistente",
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
      { kind: "resource", id: "ecs", type: "aws.ecs", name: "api-service", position: { x: 0, y: 1 }, properties: {} },
      {
        kind: "resource",
        id: "rds",
        type: "aws.rds",
        name: "orders-db",
        position: { x: 0, y: 2 },
        properties: { multiAz: false },
      },
    ],
    edges: [
      { id: "a", source: "lg", target: "ecs", kind: "HTTP" },
      { id: "b", source: "ecs", target: "rds", kind: "Database" },
    ],
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
  app = await buildApp({
    assistant: {
      transport: async (request) => {
        recebido = request;
        return {
          text: "resposta do modelo",
          model: "claude-opus-5",
          usage: { inputTokens: 100, outputTokens: 20 },
        };
      },
    },
  });

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

describe("tarefas do assistente (PRD §81)", () => {
  it("lista exatamente as seis do §81", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/assistant/tasks",
      cookies: as(sessaoDono),
    });

    assert.equal(response.statusCode, 200);
    const body = response.json<{ available: boolean; tasks: { task: string }[] }>();

    assert.equal(body.available, true);
    assert.deepEqual(body.tasks.map((task) => task.task), [
      "explain-architecture",
      "explain-bottleneck",
      "suggest-improvements",
      "explain-tradeoffs",
      "generate-documentation",
      "prepare-agent-instructions",
    ]);
  });

  it("recusa tarefa fora da lista", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/architectures/${architectureId}/assistant`,
      cookies: as(sessaoDono),
      payload: { task: "escrever-poema" },
    });
    assert.equal(response.statusCode, 400);
  });
});

describe("o contexto que chega ao modelo", () => {
  it("carrega o que o sistema apurou sobre esta arquitetura", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/architectures/${architectureId}/assistant`,
      cookies: as(sessaoDono),
      payload: { task: "explain-architecture" },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json<{ text: string }>().text, "resposta do modelo");
    assert.ok(recebido);

    const prompt = buildPrompt(recebido);

    // O grafo real, não uma descrição genérica.
    assert.match(prompt, /"orders-db"/);
    assert.match(prompt, /"api-service"/);
    // A validação encontrou o banco em zona única.
    assert.match(prompt, /zona só/);
    // Nada foi executado ainda, e isso está dito.
    assert.match(prompt, /Nenhum `tofu plan` foi executado/);
    // E que os números são estimativa, não medição.
    assert.match(prompt, /não mede execução real/);
    // A tarefa pedida está no prompt.
    assert.match(prompt, /Explique esta arquitetura/);
  });

  it("repassa a pergunta do usuário dentro do escopo da tarefa", async () => {
    await app.inject({
      method: "POST",
      url: `/architectures/${architectureId}/assistant`,
      cookies: as(sessaoDono),
      payload: { task: "suggest-improvements", question: "Dá para cortar custo sem perder capacidade?" },
    });

    const prompt = buildPrompt(recebido!);
    assert.match(prompt, /Dá para cortar custo sem perder capacidade\?/);
    assert.match(prompt, /dentro do escopo da tarefa/);
  });
});

describe("acesso", () => {
  it("não responde sobre arquitetura alheia", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/architectures/${architectureId}/assistant`,
      cookies: as(sessaoIntruso),
      payload: { task: "explain-architecture" },
    });
    assert.equal(response.statusCode, 404);
  });

  it("recusa tudo sem sessão", async () => {
    for (const [method, url] of [
      ["GET", "/assistant/tasks"],
      ["POST", `/architectures/${architectureId}/assistant`],
    ] as const) {
      const response = await app.inject({ method, url, payload: { task: "explain-architecture" } });
      assert.equal(response.statusCode, 401, `${method} ${url}`);
    }
  });
});

describe("sem credencial", () => {
  it("diz que o assistente está indisponível em vez de inventar resposta", async () => {
    const semTransporte = await buildApp();

    try {
      const response = await semTransporte.inject({
        method: "POST",
        url: `/architectures/${architectureId}/assistant`,
        cookies: as(sessaoDono),
        payload: { task: "explain-architecture" },
      });

      // Com credencial no ambiente o transporte real assume; sem ela, 503.
      const esperado = process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN ? 200 : 503;
      assert.equal(response.statusCode, esperado);
      if (esperado === 503) {
        assert.equal(response.json<{ error: string }>().error, "assistente_indisponivel");
      }
    } finally {
      await semTransporte.close();
    }
  });
});
