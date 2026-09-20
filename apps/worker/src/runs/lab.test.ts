import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, describe, it } from "node:test";
import { LabApplyResultSchema, slugFor } from "@infraflow/schema";
import { connection, documentOf, loadGeneratorNode, resourceNode } from "@infraflow/validator";
import { db } from "../db.ts";
import { env } from "../env.ts";
import { runLabApply, runLabDestroy } from "./lab.ts";

/**
 * O fluxo inteiro do §76 com Docker de verdade: apply, deploy, ready, destroy.
 *
 * A arquitetura é pequena de propósito — proxy, aplicação e cache —, mas
 * exercita o que importa: a topologia do canvas vira rede real e a aplicação
 * conversa com a dependência declarada.
 */

const hasTofu = spawnSync("tofu", ["version"], { stdio: "ignore" }).status === 0;
const hasDocker = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
const canRun = hasTofu && hasDocker;

const suffix = Date.now().toString(36);
const email = `lab-worker-${suffix}@exemplo.test`;

let architectureId: string;
let versionId: string;
let labId: string;
let labSlug: string;

/** Prefixo dos containers do laboratório, como o compiler o escreve. */
const containerPrefix = () => `infraflow-${labSlug}`.toLowerCase();

function architecture() {
  return documentOf(
    [
      loadGeneratorNode(),
      resourceNode("proxy", "opensource.nginx", {}, "borda"),
      resourceNode("app", "opensource.docker", {}, "aplicacao"),
      resourceNode("cache", "opensource.redis", {}, "cache"),
    ],
    [
      connection("load-generator", "proxy", "HTTP"),
      connection("proxy", "app", "HTTP"),
      connection("app", "cache", "TCP"),
    ],
  );
}

before(async () => {
  const user = await db.user.create({ data: { email, name: "Lab", passwordHash: "x" } });
  const created = await db.architecture.create({
    data: {
      name: "Laboratorio de teste",
      provider: "AWS",
      environment: "dev",
      project: { create: { ownerId: user.id, name: "Lab", slug: `lab-worker-${suffix}` } },
      versions: { create: { number: 1, graph: architecture() } },
    },
    include: { versions: true },
  });

  architectureId = created.id;
  versionId = created.versions[0]!.id;
  labSlug = slugFor("test");

  const lab = await db.lab.create({
    data: {
      architectureId,
      versionId,
      slug: labSlug,
      workdir: "",
      expiresAt: new Date(Date.now() + env.labTtlMs),
    },
  });
  labId = lab.id;
});

after(async () => {
  // Não deixa container órfão nem quando o teste falha no meio (§54).
  if (canRun) {
    const lab = await db.lab.findUnique({ where: { id: labId } });
    if (lab && lab.status !== "DESTROYED") {
      const run = await db.run.create({
        data: { architectureId, versionId, labId, kind: "LAB_DESTROY", slug: slugFor("lab-destroy"), params: { target: "docker" } },
      });
      await runLabDestroy(run.id).catch(() => undefined);
    }
  }

  await db.user.deleteMany({ where: { email } });
  await db.$disconnect();
});

describe(
  "ciclo de vida do laboratório (PRD §76)",
  { skip: canRun ? false : "OpenTofu e Docker são necessários" },
  () => {
    it("sobe a infraestrutura e só fica pronto quando ela responde", { timeout: 600_000 }, async () => {
      const run = await db.run.create({
        data: { architectureId, versionId, labId, kind: "LAB_APPLY", slug: slugFor("lab-apply"), params: { target: "docker" } },
      });

      await runLabApply(run.id);

      const done = await db.run.findUniqueOrThrow({ where: { id: run.id } });
      assert.equal(done.status, "SUCCEEDED", done.error ?? "");

      const result = LabApplyResultSchema.parse(done.result);
      assert.equal(result.readiness.ready, true);
      assert.match(result.entryUrl, /^http:\/\/127\.0\.0\.1:\d+$/);

      // Cada node do canvas virou um container identificável (§78).
      assert.deepEqual(
        result.containers.map((container) => container.nodeId).sort(),
        ["app", "cache", "proxy"],
      );

      const lab = await db.lab.findUniqueOrThrow({ where: { id: labId } });
      assert.equal(lab.status, "READY");
      assert.ok(lab.readyAt);
      assert.ok(lab.entryPort);
    });

    it("a requisição atravessa a topologia desenhada", { timeout: 60_000 }, async () => {
      const lab = await db.lab.findUniqueOrThrow({ where: { id: labId } });
      const response = await fetch(lab.entryUrl!);
      const body = (await response.json()) as {
        ok: boolean;
        service: string;
        checks: { name: string; ok: boolean; detail: string }[];
      };

      assert.equal(response.status, 200);
      // A carga entrou pelo proxy e chegou à aplicação.
      assert.equal(body.service, "aplicacao");
      // Que, por sua vez, exercitou o cache declarado no canvas.
      const cache = body.checks.find((check) => check.name === "cache");
      assert.equal(cache?.ok, true);
      assert.equal(cache?.detail, "+PONG");
    });

    it("só a porta de entrada é publicada (§52)", { timeout: 60_000 }, () => {
      // O filtro do docker é sensível a caixa e o prefixo do container é
      // minúsculo; a lista gravada no laboratório é a fonte certa.
      const published = spawnSync(
        "docker",
        ["ps", "--filter", `name=${containerPrefix()}`, "--format", "{{.Names}} {{.Ports}}"],
        { encoding: "utf8" },
      ).stdout.trim().split("\n").filter(Boolean);

      assert.equal(published.length, 3, `esperava três containers, veio:\n${published.join("\n")}`);

      const expostos = published.filter((line) => line.includes("127.0.0.1:"));
      assert.equal(expostos.length, 1, `esperava uma porta publicada, veio:\n${published.join("\n")}`);
      assert.match(expostos[0]!, /borda/);
    });

    it("destrói tudo o que subiu (§54)", { timeout: 300_000 }, async () => {
      const run = await db.run.create({
        data: { architectureId, versionId, labId, kind: "LAB_DESTROY", slug: slugFor("lab-destroy"), params: { target: "docker" } },
      });

      await runLabDestroy(run.id);

      const done = await db.run.findUniqueOrThrow({ where: { id: run.id } });
      assert.equal(done.status, "SUCCEEDED", done.error ?? "");

      const lab = await db.lab.findUniqueOrThrow({ where: { id: labId } });
      assert.equal(lab.status, "DESTROYED");
      assert.equal(lab.entryUrl, null);

      const restantes = spawnSync(
        "docker",
        ["ps", "-a", "--filter", `name=${containerPrefix()}`, "--format", "{{.Names}}"],
        { encoding: "utf8" },
      ).stdout.trim();
      assert.equal(restantes, "", `sobraram containers: ${restantes}`);
    });
  },
);
