import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ArchitectureJsonSchema } from "@infraflow/schema";
import type { LoadTestObservation } from "@infraflow/schema";
import {
  connection,
  documentOf,
  loadGeneratorNode,
  referenceArchitecture,
  resourceNode,
} from "@infraflow/validator";
import { generateReport, generateReports, REPORT_FILES } from "./index.ts";

const contentOf = (name: string, context: Parameters<typeof generateReport>[1]) =>
  generateReport(name, context)!.content;

const reference = { document: referenceArchitecture(), version: 3 };

const observation: LoadTestObservation = {
  startedAt: "2026-09-20T10:00:00.000Z",
  finishedAt: "2026-09-20T10:05:00.000Z",
  durationSeconds: 300,
  requests: 412_500,
  rps: 1375,
  p50Ms: 88,
  p95Ms: 412,
  p99Ms: 903,
  errorRatePct: 0.4,
  meetsSlo: true,
  droppedIterations: 0,
  metrics: [],
  stages: [
    {
      targetRps: 1000,
      rps: 998,
      p95Ms: 210,
      errorRatePct: 0,
      startedAt: "2026-09-20T10:00:00.000Z",
      endedAt: "2026-09-20T10:02:30.000Z",
    },
    {
      targetRps: 1500,
      rps: 1375,
      p95Ms: 412,
      errorRatePct: 0.4,
      startedAt: "2026-09-20T10:02:30.000Z",
      endedAt: "2026-09-20T10:05:00.000Z",
    },
  ],
};

describe("artefatos do §73", () => {
  it("gera os quatro documentos mais o architecture.json", () => {
    assert.deepEqual(
      REPORT_FILES.map((file) => file.name),
      ["ARCHITECTURE.md", "CAPACITY.md", "LOAD-TEST.md", "GOAL.md", "architecture.json"],
    );
    assert.equal(generateReports(reference).length, REPORT_FILES.length);
  });

  it("não devolve nada para nome desconhecido", () => {
    assert.equal(generateReport("SEGREDO.md", reference), undefined);
  });

  it("é determinístico — mesma entrada, mesmo byte", () => {
    assert.deepEqual(generateReports(reference), generateReports(reference));
  });

  it("nenhum artefato sai vazio", () => {
    for (const file of generateReports(reference)) {
      assert.ok(file.content.trim().length > 0, file.name);
    }
  });
});

describe("ARCHITECTURE.md", () => {
  it("descreve os recursos que estão no documento, não um texto fixo", () => {
    const content = contentOf("ARCHITECTURE.md", reference);

    assert.match(content, /# Architecture — Arquitetura Web/);
    assert.match(content, /RDS PostgreSQL/);
    assert.match(content, /`orders-db`/);
    assert.match(content, /`session-cache`/);
    // Propriedade real do node, não rótulo genérico.
    assert.match(content, /`instanceClass`/);
  });

  it("acompanha a renomeação de um recurso", () => {
    const renamed = documentOf(
      [loadGeneratorNode(), resourceNode("db", "aws.rds", {}, "faturamento")],
      [],
    );
    const content = contentOf("ARCHITECTURE.md", { document: renamed });

    assert.match(content, /`faturamento`/);
    assert.doesNotMatch(content, /orders-db/);
  });

  it("lista os achados da validação", () => {
    const content = contentOf("ARCHITECTURE.md", reference);
    assert.match(content, /## Validation/);
    assert.match(content, /zona só/);
  });

  it("mostra por onde a carga entra", () => {
    const content = contentOf("ARCHITECTURE.md", reference);
    assert.match(content, /## Entry points/);
    assert.match(content, /https:\/\/api\.example\.com/);
  });
});

describe("CAPACITY.md", () => {
  it("separa Estimated de Observed", () => {
    const content = contentOf("CAPACITY.md", reference);

    assert.match(content, /## Estimated/);
    assert.match(content, /## Observed/);
    assert.match(content, /Nenhuma execução real registrada/);
    // A folga de planejamento precisa continuar explícita (PRD §85).
    assert.match(content, /Planning capacity/);
    assert.match(content, /Test ceiling/);
  });

  it("escreve a medição quando existe execução", () => {
    const content = contentOf("CAPACITY.md", {
      ...reference,
      observed: { run: observation, runId: "load-test-01J8Z2F" },
    });

    assert.match(content, /load-test-01J8Z2F/);
    assert.match(content, /Sustained throughput: 1,375 req\/s/);
    assert.match(content, /SLO: cumprido/);
    assert.doesNotMatch(content, /Nenhuma execução real registrada/);
  });

  it("escreve o gargalo que a medição aponta (§79)", () => {
    const stage = (targetRps: number, rps: number, p95Ms: number, errorRatePct: number, index: number) => ({
      targetRps,
      rps,
      p95Ms,
      errorRatePct,
      startedAt: new Date(Date.parse("2026-09-20T10:00:00.000Z") + index * 10_000).toISOString(),
      endedAt: new Date(Date.parse("2026-09-20T10:00:00.000Z") + (index + 1) * 10_000).toISOString(),
    });

    const sample = (nodeId: string, value: number, index: number) => ({
      nodeId,
      metric: "cpu",
      unit: "%",
      value,
      at: new Date(Date.parse("2026-09-20T10:00:05.000Z") + index * 10_000).toISOString(),
    });

    const content = contentOf("CAPACITY.md", {
      ...reference,
      observed: {
        run: {
          ...observation,
          meetsSlo: false,
          stages: [
            stage(100, 100, 60, 0, 0),
            stage(300, 300, 180, 0, 1),
            stage(600, 590, 980, 6, 2),
          ],
          metrics: [
            sample("rds", 30, 0),
            sample("rds", 64, 1),
            sample("rds", 96, 2),
            sample("ecs", 20, 0),
            sample("ecs", 28, 1),
            sample("ecs", 35, 2),
          ],
        },
      },
    });

    assert.match(content, /### Bottleneck \(observed\)/);
    assert.match(content, /RDS PostgreSQL `orders-db` \| `cpu` \| 96\.0%/);
    assert.doesNotMatch(content, /não chegou ao limite/);
  });

  it("diz quando a medição não permite concluir o gargalo", () => {
    const content = contentOf("CAPACITY.md", {
      ...reference,
      observed: { run: observation },
    });

    // A execução de referência cumpriu o SLO: não há gargalo a apontar.
    assert.match(content, /### Bottleneck \(observed\)/);
    assert.match(content, /não chegou ao limite/);
  });

  it("resume a série medida em pico e média por recurso", () => {
    const content = contentOf("CAPACITY.md", {
      ...reference,
      observed: {
        run: observation,
        metrics: [
          { nodeId: "rds", metric: "cpu", unit: "%", value: 61.4, at: "2026-09-20T10:03:00.000Z" },
          { nodeId: "rds", metric: "cpu", unit: "%", value: 96.2, at: "2026-09-20T10:04:00.000Z" },
        ],
      },
    });

    assert.match(content, /RDS PostgreSQL `orders-db` \| `cpu` \| 96\.2%/);
  });

  it("muda quando a configuração do recurso muda", () => {
    const small = documentOf(
      [loadGeneratorNode(), resourceNode("ecs", "aws.ecs", { maxReplicas: 2 })],
      [connection("load-generator", "ecs", "HTTP")],
    );
    const large = documentOf(
      [loadGeneratorNode(), resourceNode("ecs", "aws.ecs", { maxReplicas: 40 })],
      [connection("load-generator", "ecs", "HTTP")],
    );

    assert.notEqual(contentOf("CAPACITY.md", { document: small }), contentOf("CAPACITY.md", { document: large }));
  });
});

describe("LOAD-TEST.md", () => {
  it("descreve o workload configurado", () => {
    const content = contentOf("LOAD-TEST.md", reference);

    assert.match(content, /`\/checkout`/);
    assert.match(content, /\| POST \| `\/login` \| 20% \|/);
    assert.match(content, /p95 < 500ms/);
  });

  it("mostra o caminho que a carga percorre", () => {
    const content = contentOf("LOAD-TEST.md", reference);
    assert.match(content, /## Path under load/);
    assert.match(content, /CloudFront/);
  });

  it("avisa quando não há Load Generator", () => {
    const content = contentOf("LOAD-TEST.md", {
      document: documentOf([resourceNode("ecs", "aws.ecs")], []),
    });
    assert.match(content, /Nenhum Load Generator/);
  });
});

describe("GOAL.md", () => {
  it("carrega o escopo real da arquitetura", () => {
    const content = contentOf("GOAL.md", reference);

    assert.match(content, /Resources to provision: 8/);
    assert.match(content, /environment `dev`/);
    assert.match(content, /version v3/);
    assert.match(content, /architecture\.json` has priority/);
  });

  it("lista os bloqueios quando a validação acusa erro", () => {
    const broken = documentOf(
      [loadGeneratorNode(), resourceNode("rds", "aws.rds")],
      [connection("load-generator", "rds", "Database")],
    );
    const content = contentOf("GOAL.md", { document: broken });

    assert.match(content, /## Known blockers/);
    assert.match(content, /tráfego externo diretamente/);
  });

  it("diz que não há bloqueio quando a arquitetura passa", () => {
    assert.match(contentOf("GOAL.md", reference), /não encontrou nenhum bloqueio/);
  });
});

describe("architecture.json", () => {
  it("continua válido contra o contrato do §33", () => {
    const parsed = ArchitectureJsonSchema.safeParse(
      JSON.parse(contentOf("architecture.json", reference)),
    );
    assert.equal(parsed.success, true);
  });

  it("não leva nota nem grupo", () => {
    const parsed = ArchitectureJsonSchema.parse(
      JSON.parse(contentOf("architecture.json", reference)),
    );
    assert.equal(parsed.nodes.length, 8);
    assert.ok(parsed.nodes.every((node) => node.type.includes(".")));
  });
});
