import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.ts";
import { db } from "../db.ts";

/** Testes de integração — exigem o Postgres do `docker compose up -d`. */

const suffix = Date.now().toString(36);
const email = `auth-${suffix}@exemplo.test`;
const password = "uma-senha-boa-123";

let app: FastifyInstance;

before(async () => {
  app = await buildApp();
});

after(async () => {
  await db.user.deleteMany({ where: { email: { contains: `-${suffix}@exemplo.test` } } });
  await db.$disconnect();
  await app.close();
});

describe("registro", () => {
  it("cria a conta e já abre sessão", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { name: "Pessoa de Teste", email, password },
    });

    assert.equal(response.statusCode, 201);
    assert.equal(response.json<{ user: { email: string } }>().user.email, email);
    assert.ok(response.cookies.some((cookie) => cookie.name === "infraflow_session"));
  });

  it("nunca devolve o hash da senha", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { name: "Outra", email: `outra-${suffix}@exemplo.test`, password },
    });
    assert.equal(response.body.includes("passwordHash"), false);
    assert.equal(response.body.includes(password), false);
  });

  it("recusa e-mail já cadastrado", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { name: "Repetida", email, password },
    });
    assert.equal(response.statusCode, 409);
  });

  it("recusa senha curta", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { name: "Curta", email: `curta-${suffix}@exemplo.test`, password: "1234" },
    });
    assert.equal(response.statusCode, 400);
  });

  it("recusa e-mail malformado", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { name: "Torta", email: "nao-e-email", password },
    });
    assert.equal(response.statusCode, 400);
  });
});

describe("login", () => {
  it("aceita a senha correta", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password },
    });
    assert.equal(response.statusCode, 200);

    const cookie = response.cookies.find((candidate) => candidate.name === "infraflow_session");
    assert.ok(cookie);
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.sameSite?.toLowerCase(), "lax");
  });

  it("aceita e-mail com outra caixa", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: email.toUpperCase(), password },
    });
    assert.equal(response.statusCode, 200);
  });

  it("recusa a senha errada", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password: "senha-errada-123" },
    });
    assert.equal(response.statusCode, 401);
  });

  it("não revela se o e-mail existe", async () => {
    const desconhecido = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: `ninguem-${suffix}@exemplo.test`, password },
    });
    const errada = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password: "senha-errada-123" },
    });

    assert.equal(desconhecido.statusCode, errada.statusCode);
    assert.deepEqual(desconhecido.json(), errada.json());
  });
});

describe("sessão", () => {
  it("recusa /auth/me sem cookie", async () => {
    const response = await app.inject({ method: "GET", url: "/auth/me" });
    assert.equal(response.statusCode, 401);
  });

  it("recusa cookie forjado", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/auth/me",
      cookies: { infraflow_session: "token-inventado" },
    });
    assert.equal(response.statusCode, 401);
  });

  it("reconhece a sessão e o logout a encerra", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password },
    });
    const token = login.cookies.find((cookie) => cookie.name === "infraflow_session")!.value;

    const me = await app.inject({
      method: "GET",
      url: "/auth/me",
      cookies: { infraflow_session: token },
    });
    assert.equal(me.json<{ user: { email: string } }>().user.email, email);

    await app.inject({
      method: "POST",
      url: "/auth/logout",
      cookies: { infraflow_session: token },
    });

    const depois = await app.inject({
      method: "GET",
      url: "/auth/me",
      cookies: { infraflow_session: token },
    });
    assert.equal(depois.statusCode, 401);
  });
});
