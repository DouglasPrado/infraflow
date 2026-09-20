import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { before, describe, it } from "node:test";
import { canStoreSecrets, MissingSecretKey, open, seal } from "./secrets.ts";

/** PRD §52 — credencial de nuvem é o dado que, vazando, custa dinheiro. */

before(() => {
  process.env.INFRAFLOW_SECRET_KEY = randomBytes(32).toString("base64");
});

describe("segredo em repouso", () => {
  const segredo = JSON.stringify({ accessKeyId: "AKIAEXEMPLO", secretAccessKey: "s3cr3t" });

  it("vai e volta", () => {
    assert.equal(open(seal(segredo)), segredo);
  });

  it("não deixa o texto em claro no que é gravado", () => {
    const selado = seal(segredo);
    for (const parte of [selado.cipher, selado.iv, selado.tag]) {
      assert.doesNotMatch(parte, /AKIAEXEMPLO|s3cr3t/);
    }
  });

  it("cifra diferente a cada vez, com o mesmo texto", () => {
    // IV aleatório: dois segredos iguais não produzem o mesmo registro.
    assert.notEqual(seal(segredo).cipher, seal(segredo).cipher);
  });

  it("recusa ciphertext adulterado em vez de devolver lixo", () => {
    const selado = seal(segredo);
    const corrompido = Buffer.from(selado.cipher, "base64");
    corrompido[0] = corrompido[0] ^ 0xff;

    assert.throws(() => open({ ...selado, cipher: corrompido.toString("base64") }));
  });

  it("recusa quando a etiqueta de autenticação não bate", () => {
    const selado = seal(segredo);
    assert.throws(() => open({ ...selado, tag: randomBytes(16).toString("base64") }));
  });

  it("não decifra com outra chave", () => {
    const selado = seal(segredo);
    const anterior = process.env.INFRAFLOW_SECRET_KEY;
    process.env.INFRAFLOW_SECRET_KEY = randomBytes(32).toString("base64");

    try {
      assert.throws(() => open(selado));
    } finally {
      process.env.INFRAFLOW_SECRET_KEY = anterior;
    }
  });
});

describe("sem chave configurada", () => {
  it("avisa em vez de gravar em claro", () => {
    const anterior = process.env.INFRAFLOW_SECRET_KEY;
    delete process.env.INFRAFLOW_SECRET_KEY;

    try {
      assert.equal(canStoreSecrets(), false);
      assert.throws(() => seal("x"), MissingSecretKey);
    } finally {
      process.env.INFRAFLOW_SECRET_KEY = anterior;
    }
  });

  it("recusa chave de tamanho errado", () => {
    const anterior = process.env.INFRAFLOW_SECRET_KEY;
    process.env.INFRAFLOW_SECRET_KEY = Buffer.from("curta").toString("base64");

    try {
      assert.throws(() => seal("x"), /32 bytes/);
    } finally {
      process.env.INFRAFLOW_SECRET_KEY = anterior;
    }
  });
});
