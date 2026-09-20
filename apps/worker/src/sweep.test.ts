import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, describe, it } from "node:test";
import { connection, documentOf, loadGeneratorNode, resourceNode } from "@infraflow/validator";
import { db } from "./db.ts";
import { sweepExpiredLabs } from "./sweep.ts";

/**
 * PRD §54 — laboratório com prazo vencido não pode continuar de pé.
 *
 * O ambiente aqui não tem recurso nenhum aplicado: o que está sob teste é a
 * varredura decidir corretamente o que derrubar, não o `destroy` em si — esse
 * tem o próprio teste em `runs/lab.test.ts`.
 */

const hasTofu = spawnSync("tofu", ["version"], { stdio: "ignore" }).status === 0;
const suffix = Date.now().toString(36);
const email = `sweep-${suffix}@exemplo.test`;

let architectureId: string;
let versionId: string;

before(async () => {
  const user = await db.user.create({ data: { email, name: "Sweep", passwordHash: "x" } });
  const created = await db.architecture.create({
    data: {
      name: "Varredura",
      provider: "AWS",
      environment: "dev",
      project: { create: { ownerId: user.id, name: "Sweep", slug: `sweep-${suffix}` } },
      versions: {
        create: {
          number: 1,
          graph: documentOf(
            [loadGeneratorNode(), resourceNode("proxy", "opensource.nginx", {}, "borda")],
            [connection("load-generator", "proxy", "HTTP")],
          ),
        },
      },
    },
    include: { versions: true },
  });

  architectureId = created.id;
  versionId = created.versions[0]!.id;
});

after(async () => {
  await db.user.deleteMany({ where: { email } });
  await db.$disconnect();
});

async function lab(slug: string, expiresAt: Date, status: "READY" | "CREATING" = "READY") {
  return db.lab.create({
    data: { architectureId, versionId, slug, status, workdir: "", expiresAt },
  });
}

describe("varredura de laboratórios (PRD §54)", { skip: hasTofu ? false : "OpenTofu não está instalado" }, () => {
  it("derruba o que venceu e deixa o que ainda vale", { timeout: 300_000 }, async () => {
    const vencido = await lab(`test-venceu-${suffix}`, new Date(Date.now() - 60_000));
    const vigente = await lab(`test-vigente-${suffix}`, new Date(Date.now() + 3_600_000));

    const derrubados = await sweepExpiredLabs();
    assert.equal(derrubados, 1);

    assert.equal((await db.lab.findUniqueOrThrow({ where: { id: vencido.id } })).status, "DESTROYED");
    assert.equal((await db.lab.findUniqueOrThrow({ where: { id: vigente.id } })).status, "READY");

    // A destruição fica registrada como execução, não acontece em silêncio.
    const run = await db.run.findFirstOrThrow({ where: { labId: vencido.id } });
    assert.equal(run.kind, "LAB_DESTROY");
    assert.equal(run.status, "SUCCEEDED");
  });

  it("não mexe em laboratório que ainda está subindo", { timeout: 120_000 }, async () => {
    const subindo = await lab(`test-subindo-${suffix}`, new Date(Date.now() - 60_000), "CREATING");

    await sweepExpiredLabs();

    assert.equal((await db.lab.findUniqueOrThrow({ where: { id: subindo.id } })).status, "CREATING");
  });
});
