import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { CATALOG } from "@infraflow/registry";
import { connection, documentOf, loadGeneratorNode, resourceNode } from "@infraflow/validator";
import { emit } from "./index.ts";

/**
 * O pipeline do §74 termina em `tofu fmt` e `tofu validate`. Estes testes
 * fecham essa ponta com o binário de verdade.
 *
 * `fmt` roda sempre que o OpenTofu estiver instalado: é rápido e offline, e
 * pega qualquer desvio de formatação do gerador. `validate` exige `tofu init`,
 * que baixa ~766 MB de provider da AWS — fica atrás de `INFRAFLOW_TOFU_VALIDATE=1`
 * para não pendurar a suíte inteira num download.
 */

const hasTofu = spawnSync("tofu", ["version"], { stdio: "ignore" }).status === 0;
const validateEnabled = process.env.INFRAFLOW_TOFU_VALIDATE === "1";

let workdir: string;
let todosDir: string;

function document() {
  return documentOf(
    [
      loadGeneratorNode(),
      resourceNode("alb", "aws.alb", {}, "public-alb"),
      resourceNode("ecs", "aws.ecs", {}, "api-service"),
      resourceNode("rds", "aws.rds", {}, "orders-db"),
      resourceNode("redis", "aws.elasticache", { nodes: 2, multiAz: true }, "session-cache"),
      resourceNode("s3", "aws.s3", {}, "product-assets"),
    ],
    [
      connection("load-generator", "alb", "HTTP"),
      connection("alb", "ecs", "HTTP"),
      connection("ecs", "rds", "Database"),
      connection("ecs", "redis", "TCP"),
      connection("ecs", "s3", "Storage"),
    ],
  );
}

/**
 * Um documento com **todo** tipo que o compiler sabe emitir.
 *
 * A arquitetura de referência exercita cinco recursos; o resto passaria sem
 * ninguém olhar. Foi assim que cinco grupos de segurança saíram referenciados
 * mas não declarados — HCL que tipa, compila e o OpenTofu recusa.
 */
function todosOsTipos() {
  const emissiveis = CATALOG.filter((item) => item.provider === "aws").map((item) => item.type);
  return documentOf(
    [
      loadGeneratorNode(),
      ...emissiveis.map((type) => {
        const slug = type.split(".")[1]!;
        return resourceNode(slug, type, {}, slug);
      }),
    ],
    [],
  );
}

before(() => {
  workdir = mkdtempSync(join(tmpdir(), "infraflow-compile-"));
  for (const file of emit(document()).files) {
    writeFileSync(join(workdir, file.name), file.content);
  }

  todosDir = mkdtempSync(join(tmpdir(), "infraflow-todos-"));
  for (const file of emit(todosOsTipos()).files) {
    writeFileSync(join(todosDir, file.name), file.content);
  }
});

after(() => {
  if (workdir) rmSync(workdir, { recursive: true, force: true });
  if (todosDir) rmSync(todosDir, { recursive: true, force: true });
});

describe("OpenTofu de verdade", { skip: hasTofu ? false : "OpenTofu não está instalado" }, () => {
  it("o que o compiler gera já está no formato canônico", () => {
    const result = spawnSync("tofu", ["fmt", "-check", "-no-color", "-diff", workdir], {
      encoding: "utf8",
    });

    assert.equal(result.stdout, "", `tofu fmt reescreveria a saída:\n${result.stdout}`);
    assert.equal(result.status, 0);
  });

  it(
    "o que o compiler gera passa no tofu validate",
    { skip: validateEnabled ? false : "defina INFRAFLOW_TOFU_VALIDATE=1 (baixa o provider da AWS)" },
    () => {
      execFileSync("tofu", ["init", "-no-color", "-input=false", "-backend=false"], {
        cwd: workdir,
        stdio: "pipe",
      });

      const output = execFileSync("tofu", ["validate", "-no-color"], {
        cwd: workdir,
        encoding: "utf8",
      });

      assert.match(output, /Success/);
    },
  );

  it("todo recurso do catálogo gera HCL canônico", () => {
    const result = spawnSync("tofu", ["fmt", "-check", "-no-color", "-diff", todosDir], {
      encoding: "utf8",
    });

    assert.equal(result.stdout, "", `tofu fmt reescreveria a saída:\n${result.stdout}`);
    assert.equal(result.status, 0);
  });

  it(
    "todo recurso do catálogo passa no tofu validate",
    { skip: validateEnabled ? false : "defina INFRAFLOW_TOFU_VALIDATE=1 (baixa o provider da AWS)" },
    () => {
      execFileSync("tofu", ["init", "-no-color", "-input=false", "-backend=false"], {
        cwd: todosDir,
        stdio: "pipe",
      });

      const output = execFileSync("tofu", ["validate", "-no-color"], {
        cwd: todosDir,
        encoding: "utf8",
      });

      assert.match(output, /Success/);
    },
  );
});
