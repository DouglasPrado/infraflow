import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, describe, it } from "node:test";
import { LoadTestObservationSchema, slugFor } from "@infraflow/schema";
import { connection, documentOf, loadGeneratorNode, resourceNode } from "@infraflow/validator";
import { db } from "../db.ts";
import { env } from "../env.ts";
import { runLabApply, runLabDestroy } from "./lab.ts";
import { runLoadTest } from "./load-test.ts";

/**
 * O §77 inteiro, com k6 e Docker de verdade: o Load Generator do canvas vira
 * carga real contra o laboratório, e o que volta é medição, não estimativa.
 */

const hasK6 = spawnSync("k6", ["version"], { stdio: "ignore" }).status === 0;
const hasTofu = spawnSync("tofu", ["version"], { stdio: "ignore" }).status === 0;
const hasDocker = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
const canRun = hasK6 && hasTofu && hasDocker;

const suffix = Date.now().toString(36);
const email = `carga-${suffix}@exemplo.test`;

let architectureId: string;
let versionId: string;
let labId: string;

/** Escada curta: o que está sob teste é a medição, não a paciência. */
function architecture() {
  return documentOf(
    [
      loadGeneratorNode("load-generator", {
        endpoints: [
          { id: "a", method: "GET", path: "/products", weight: 70 },
          { id: "b", method: "GET", path: "/checkout", weight: 30 },
        ],
        profile: { type: "Capacity", startRps: 20, incrementRps: 20, intervalSeconds: 3, maxRps: 60 },
        slo: { p95Ms: 800, p99Ms: 1500, errorRatePct: 5 },
      }),
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
  const user = await db.user.create({ data: { email, name: "Carga", passwordHash: "x" } });
  const created = await db.architecture.create({
    data: {
      name: "Teste de carga",
      provider: "AWS",
      environment: "dev",
      project: { create: { ownerId: user.id, name: "Carga", slug: `carga-${suffix}` } },
      versions: { create: { number: 1, graph: architecture() } },
    },
    include: { versions: true },
  });

  architectureId = created.id;
  versionId = created.versions[0]!.id;

  const lab = await db.lab.create({
    data: {
      architectureId,
      versionId,
      slug: slugFor("test"),
      workdir: "",
      expiresAt: new Date(Date.now() + env.labTtlMs),
    },
  });
  labId = lab.id;

  if (canRun) {
    const run = await db.run.create({
      data: { architectureId, versionId, labId, kind: "LAB_APPLY", slug: slugFor("lab-apply"), params: { target: "docker" } },
    });
    await runLabApply(run.id);
  }
});

after(async () => {
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

async function loadTestRun() {
  return db.run.create({
    data: { architectureId, versionId, labId, kind: "LOAD_TEST", slug: slugFor("load-test"), params: { target: "docker" } },
  });
}

describe(
  "teste de carga real (PRD §77)",
  { skip: canRun ? false : "k6, OpenTofu e Docker são necessários" },
  () => {
    it("mede a arquitetura em vez de estimá-la", { timeout: 600_000 }, async () => {
      const lab = await db.lab.findUniqueOrThrow({ where: { id: labId } });
      assert.equal(lab.status, "READY", lab.error ?? "");

      const run = await loadTestRun();
      await runLoadTest(run.id);

      const done = await db.run.findUniqueOrThrow({ where: { id: run.id } });
      assert.equal(done.status, "SUCCEEDED", done.error ?? "");

      const observation = LoadTestObservationSchema.parse(done.result);

      // Requisições de verdade, com latência de verdade.
      assert.ok(observation.requests > 100, `poucas requisições: ${observation.requests}`);
      assert.ok(observation.rps > 0);
      assert.ok(observation.p95Ms > 0);
      assert.ok(observation.durationSeconds >= 9);

      // Um degrau por patamar da escada do canvas (§18, §20).
      assert.deepEqual(
        observation.stages.map((stage) => stage.targetRps),
        [20, 40, 60],
      );

      // A carga oferecida subiu de degrau em degrau.
      assert.ok(
        observation.stages[2]!.rps > observation.stages[0]!.rps,
        `a vazão não cresceu: ${JSON.stringify(observation.stages)}`,
      );

      // O gerador deu conta do que foi pedido.
      assert.equal(observation.droppedIterations, 0);

      assert.match(done.logs, /k6 run/);
    });

    it("associa métricas reais aos nodes do canvas (PRD §36, §78)", { timeout: 600_000 }, async () => {
      const run = await db.run.findFirstOrThrow({
        where: { architectureId, kind: "LOAD_TEST", status: "SUCCEEDED" },
        orderBy: { finishedAt: "desc" },
      });

      const observation = LoadTestObservationSchema.parse(run.result);
      assert.ok(observation.metrics.length > 0, "nenhuma métrica coletada do Prometheus");

      // Cada amostra pertence a um node do canvas, não a um container anônimo.
      const nodes = new Set(observation.metrics.map((sample) => sample.nodeId));
      for (const nodeId of nodes) {
        assert.ok(["proxy", "app", "cache"].includes(nodeId), `node inesperado: ${nodeId}`);
      }
      assert.ok(nodes.has("app"), "faltou métrica da aplicação");

      const cpu = observation.metrics.filter((sample) => sample.metric === "cpu");
      const memoria = observation.metrics.filter((sample) => sample.metric === "memory");
      assert.ok(cpu.length > 0 && memoria.length > 0);
      assert.equal(cpu[0]!.unit, "%");
      assert.equal(memoria[0]!.unit, "MB");

      // Medição, não estimativa: há consumo de memória de verdade.
      assert.ok(memoria.some((sample) => sample.value > 1), "memória medida implausível");

      // As amostras caem dentro da janela da execução.
      const inicio = new Date(observation.startedAt).getTime();
      const fim = new Date(observation.finishedAt).getTime();
      for (const sample of observation.metrics) {
        const at = new Date(sample.at).getTime();
        assert.ok(at >= inicio - 5000 && at <= fim + 5000, `amostra fora da janela: ${sample.at}`);
      }
    });

    it("recusa medir quando não há laboratório pronto", { timeout: 60_000 }, async () => {
      const semLab = await db.run.create({
        data: { architectureId, versionId, kind: "LOAD_TEST", slug: slugFor("load-test"), params: { target: "docker" } },
      });

      await runLoadTest(semLab.id);

      const done = await db.run.findUniqueOrThrow({ where: { id: semLab.id } });
      assert.equal(done.status, "FAILED");
      assert.match(done.error ?? "", /laboratório precisa estar pronto/);
    });
  },
);
