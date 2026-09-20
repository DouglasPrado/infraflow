import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, describe, it } from "node:test";
import { PlanSummarySchema } from "@infraflow/schema";
import { referenceArchitecture } from "@infraflow/validator";
import { db } from "../db.ts";
import { runPlan } from "./plan.ts";

/**
 * Integração de verdade: Postgres de pé e OpenTofu instalado.
 *
 * O alvo é o `docker`, que planeja sem credencial nenhuma — é o que torna o
 * §75 verificável aqui. O alvo `aws` exige credencial e está registrado como
 * limitação no README.
 */

const hasTofu = spawnSync("tofu", ["version"], { stdio: "ignore" }).status === 0;
const suffix = Date.now().toString(36);
const email = `worker-${suffix}@exemplo.test`;

let architectureId: string;
let versionId: string;

before(async () => {
  const user = await db.user.create({
    data: { email, name: "Worker", passwordHash: "x" },
  });

  const architecture = await db.architecture.create({
    data: {
      name: "Arquitetura Web",
      provider: "AWS",
      environment: "dev",
      project: { create: { ownerId: user.id, name: "Worker", slug: `worker-${suffix}` } },
      versions: { create: { number: 1, graph: referenceArchitecture() } },
    },
    include: { versions: true },
  });

  architectureId = architecture.id;
  versionId = architecture.versions[0]!.id;
});

after(async () => {
  await db.user.deleteMany({ where: { email } });
  await db.$disconnect();
});

async function createRun(target: string, slug: string) {
  return db.run.create({
    data: { architectureId, versionId, kind: "PLAN", slug, params: { target } },
  });
}

describe("plan (PRD §75)", { skip: hasTofu ? false : "OpenTofu não está instalado" }, () => {
  it(
    "roda tofu init e plan de verdade e grava o resumo",
    { timeout: 300_000 },
    async () => {
      const run = await createRun("docker", `plan-teste-${suffix}`);

      await runPlan(run.id);

      const done = await db.run.findUniqueOrThrow({ where: { id: run.id } });
      assert.equal(done.status, "SUCCEEDED", done.error ?? "");
      assert.ok(done.startedAt);
      assert.ok(done.finishedAt);

      const summary = PlanSummarySchema.parse(done.result);
      assert.equal(summary.target, "docker");
      // A arquitetura de referência vira rede, imagens e seis containers.
      assert.ok(summary.add >= 7, `esperava criar vários recursos, veio ${summary.add}`);
      assert.equal(summary.destroy, 0);
      assert.ok(
        summary.changes.some((change) => change.type === "docker_container"),
        "o plano deveria conter containers",
      );

      // O que não foi traduzido acompanha o plano, não some.
      assert.ok(summary.compileWarnings.some((warning) => warning.code === "unsupported-resource"));

      // O log traz a saída dos comandos, que é o que o workspace mostra.
      assert.match(done.logs, /tofu init/);
      assert.match(done.logs, /tofu plan/);
    },
  );

  it("grava a falha em vez de derrubar o worker", { timeout: 300_000 }, async () => {
    const run = await db.run.create({
      data: {
        architectureId,
        versionId,
        kind: "PLAN",
        slug: `plan-invalido-${suffix}`,
        // Alvo fora do contrato: a execução precisa terminar como falha legível.
        params: { target: "nuvem-inexistente" },
      },
    });

    await runPlan(run.id);

    const done = await db.run.findUniqueOrThrow({ where: { id: run.id } });
    assert.equal(done.status, "FAILED");
    assert.ok(done.error && done.error.length > 0);
    assert.ok(done.finishedAt);
  });
});
