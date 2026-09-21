import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { env } from "./env.ts";
import { createWorkspace } from "./workspace.ts";

/** PRD §52 — execuções não compartilham filesystem. */
describe("diretório de execução", () => {
  it("cria um diretório próprio dentro da raiz configurada", async () => {
    const workspace = await createWorkspace("teste-isolamento");

    assert.ok(workspace.path.startsWith(env.runsRoot));
    assert.ok((await stat(workspace.path)).isDirectory());

    await workspace.remove();
  });

  it("começa vazio mesmo se já existia", async () => {
    const first = await createWorkspace("teste-reuso");
    await first.write([{ name: "antigo.tf", content: "# sobra" }]);

    const second = await createWorkspace("teste-reuso");
    assert.throws(() => readFileSync(join(second.path, "antigo.tf")));

    await second.remove();
  });

  it("recusa nome de arquivo que escaparia do diretório", async () => {
    const workspace = await createWorkspace("teste-escape");

    await assert.rejects(
      workspace.write([{ name: "../fora.tf", content: "x" }]),
      /Nome de arquivo inválido/,
    );

    await workspace.remove();
  });

  it("recusa slug que escaparia da raiz de execuções", async () => {
    await assert.rejects(createWorkspace("../../etc"), /Diretório de execução inválido/);
  });
});
