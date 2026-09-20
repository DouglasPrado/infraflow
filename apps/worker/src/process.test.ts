import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { execute, failureOf } from "./process.ts";

/** Processos de verdade: é o ponto em que o worker toca o sistema (PRD §51). */

let cwd: string;

before(() => {
  cwd = mkdtempSync(join(tmpdir(), "infraflow-proc-"));
});

after(() => {
  if (cwd) rmSync(cwd, { recursive: true, force: true });
});

describe("isolamento do ambiente (PRD §52)", () => {
  it("não repassa variáveis do worker ao processo filho", async () => {
    process.env.INFRAFLOW_SEGREDO_DE_TESTE = "nao-deve-vazar";

    try {
      const result = await execute("env", [], { cwd });
      assert.doesNotMatch(result.stdout, /nao-deve-vazar/);
      // Nem a URL do banco, que é a variável mais sensível do worker.
      assert.doesNotMatch(result.stdout, /^DATABASE_URL=/m);
    } finally {
      delete process.env.INFRAFLOW_SEGREDO_DE_TESTE;
    }
  });

  it("repassa o que o chamador declara", async () => {
    const result = await execute("env", [], { cwd, env: { MINHA_VAR: "presente" } });
    assert.match(result.stdout, /MINHA_VAR=presente/);
  });

  it("repassa a configuração do OpenTofu que existir no worker", async () => {
    process.env.TF_LOG_TESTE = "trace";
    try {
      const result = await execute("env", [], { cwd });
      assert.match(result.stdout, /TF_LOG_TESTE=trace/);
    } finally {
      delete process.env.TF_LOG_TESTE;
    }
  });
});

describe("limites", () => {
  it("mata o processo que passa do tempo", async () => {
    const result = await execute("sh", ["-c", "sleep 30"], { cwd, timeoutMs: 300 });

    assert.equal(result.timedOut, true);
    assert.equal(result.ok, false);
    assert.match(failureOf(result), /tempo limite/);
  });

  it("guarda a cauda da saída, que é onde o erro aparece", async () => {
    const result = await execute("sh", ["-c", "yes linha | head -c 400000; echo FIM"], { cwd });

    assert.ok(result.output.length < 300_000, "a saída deveria ter sido truncada");
    assert.match(result.output, /FIM/);
    assert.match(result.output, /caracteres omitidos/);
  });

  it("junta stdout e stderr na ordem em que saíram", async () => {
    const result = await execute("sh", ["-c", "echo saida; echo erro >&2"], { cwd });

    assert.match(result.output, /saida/);
    assert.match(result.output, /erro/);
    assert.match(result.stdout, /saida/);
    assert.doesNotMatch(result.stdout, /erro/);
  });

  it("reporta código de saída diferente de zero", async () => {
    const result = await execute("sh", ["-c", "echo falhou >&2; exit 3"], { cwd });

    assert.equal(result.code, 3);
    assert.equal(result.ok, false);
    assert.match(failureOf(result), /código 3/);
  });
});
