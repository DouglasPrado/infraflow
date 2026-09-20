import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, describe, it } from "node:test";
import { referenceArchitecture } from "@infraflow/validator";
import { db } from "../db.ts";
import { runPlan } from "./plan.ts";

/**
 * Integração de verdade: Postgres de pé e OpenTofu instalado.
 *
 * O alvo `aws` é o único que resta, e o provider valida a credencial contra o
 * STS antes de planejar — não há `plan` bem-sucedido sem chave real. O que dá
 * para verificar sem credencial é o que este arquivo cobre: que a execução
 * termina, que a falha vira mensagem legível e que o worker não cai. O caminho
 * feliz exige credencial e está registrado como limitação no README.
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
  it("sem credencial de nuvem, falha com instrução em vez de cair", { timeout: 300_000 }, async () => {
    const run = await createRun("aws", `plan-sem-credencial-${suffix}`);

    await runPlan(run.id);

    const done = await db.run.findUniqueOrThrow({ where: { id: run.id } });
    assert.equal(done.status, "FAILED");
    assert.ok(done.finishedAt);
    // O §52 exige credencial por projeto: a mensagem diz onde configurar.
    assert.match(done.error ?? "", /credencial de nuvem/i);
    assert.match(done.error ?? "", /Configurações/);
  });

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
    assert.ok(done.error);
    assert.ok(done.finishedAt);
  });
});
