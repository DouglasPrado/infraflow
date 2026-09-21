import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  connection,
  documentOf,
  loadGeneratorNode,
  referenceArchitecture,
  resourceNode,
} from "./reference.ts";
import { summarize, validateArchitecture } from "./validate.ts";
import type { ValidationIssue } from "./types.ts";

const codes = (issues: ValidationIssue[]) => issues.map((issue) => issue.code);
const find = (issues: ValidationIssue[], code: string) =>
  issues.filter((issue) => issue.code === code);

describe("arquitetura de referência (PRD §65)", () => {
  const issues = validateArchitecture(referenceArchitecture());

  it("não acusa nenhum erro", () => {
    assert.deepEqual(
      issues.filter((issue) => issue.severity === "error"),
      [],
    );
  });

  it("aponta o banco em uma zona só — a recomendação do §25", () => {
    const single = find(issues, "single-availability-zone");
    assert.equal(single.length, 1);
    assert.equal(single[0]!.subjectId, "rds");
  });

  it("não reclama da observabilidade estar fora do caminho da requisição", () => {
    const off = issues.filter((issue) => ["prometheus", "grafana"].includes(issue.subjectId));
    assert.deepEqual(off, []);
  });

  it("não inventa problema de conexão no caminho feliz", () => {
    assert.deepEqual(
      issues.filter((issue) => issue.category === "connection"),
      [],
    );
  });
});

describe("conexões incompatíveis (§72)", () => {
  it("recusa banco originando tráfego para a aplicação", () => {
    const issues = validateArchitecture(
      documentOf(
        [
          loadGeneratorNode(),
          resourceNode("ecs", "aws.ecs"),
          resourceNode("rds", "aws.rds"),
        ],
        [
          connection("load-generator", "ecs", "HTTP"),
          connection("rds", "ecs", "HTTP"),
        ],
      ),
    );

    const invalid = find(issues, "invalid-connection");
    assert.equal(invalid.length, 1);
    assert.equal(invalid[0]!.subjectId, "rds-ecs");
    assert.equal(invalid[0]!.severity, "error");
  });

  it("recusa o Load Generator entrando direto no banco", () => {
    const issues = validateArchitecture(
      documentOf(
        [loadGeneratorNode(), resourceNode("rds", "aws.rds")],
        [connection("load-generator", "rds", "Database")],
      ),
    );

    assert.equal(find(issues, "load-generator-target-invalid").length, 1);
  });

  it("avisa quando o tipo da conexão não corresponde ao destino", () => {
    const issues = validateArchitecture(
      documentOf(
        [loadGeneratorNode(), resourceNode("ecs", "aws.ecs"), resourceNode("rds", "aws.rds")],
        [
          connection("load-generator", "ecs", "HTTP"),
          // O destino é banco; a conexão diz HTTP.
          connection("ecs", "rds", "HTTP"),
        ],
      ),
    );

    const mismatch = find(issues, "connection-kind-mismatch");
    assert.equal(mismatch.length, 1);
    assert.equal(mismatch[0]!.severity, "warning");
  });
});

describe("dependências ausentes (§72)", () => {
  it("acusa balanceador sem destino", () => {
    const issues = validateArchitecture(
      documentOf(
        [loadGeneratorNode(), resourceNode("alb", "aws.alb")],
        [connection("load-generator", "alb", "HTTP")],
      ),
    );

    const missing = find(issues, "missing-dependency");
    assert.equal(missing.length, 1);
    assert.equal(missing[0]!.subjectId, "alb");
    assert.equal(missing[0]!.severity, "error");
  });

  it("acusa Load Generator sem conexão", () => {
    const issues = validateArchitecture(
      documentOf([loadGeneratorNode(), resourceNode("ecs", "aws.ecs")], []),
    );

    assert.ok(codes(issues).includes("load-generator-without-target"));
  });

  it("aceita o Grafana alimentado pela fonte de métricas", () => {
    const issues = validateArchitecture(
      documentOf(
        [resourceNode("prometheus", "opensource.prometheus"), resourceNode("grafana", "opensource.grafana")],
        [connection("prometheus", "grafana", "TCP")],
      ),
    );

    assert.deepEqual(find(issues, "missing-dependency"), []);
  });
});

describe("recursos inalcançáveis (§72)", () => {
  it("acusa recurso conectado que nenhuma origem alcança", () => {
    const issues = validateArchitecture(
      documentOf(
        [
          loadGeneratorNode(),
          resourceNode("ecs", "aws.ecs"),
          resourceNode("rds", "aws.rds"),
          // Ilha: o worker consome o próprio banco, mas ninguém chama o worker.
          resourceNode("worker", "aws.ecs"),
          resourceNode("jobs-db", "aws.rds"),
        ],
        [
          connection("load-generator", "ecs", "HTTP"),
          connection("ecs", "rds", "Database"),
          connection("worker", "jobs-db", "Database"),
        ],
      ),
    );

    const unreachable = find(issues, "unreachable-resource");
    assert.deepEqual(
      unreachable.map((issue) => issue.subjectId),
      ["jobs-db", "worker"],
    );
  });

  it("acusa recurso solto no canvas", () => {
    const issues = validateArchitecture(
      documentOf(
        [loadGeneratorNode(), resourceNode("ecs", "aws.ecs"), resourceNode("s3", "aws.s3")],
        [connection("load-generator", "ecs", "HTTP")],
      ),
    );

    const orphans = find(issues, "orphan-resource");
    assert.deepEqual(
      orphans.map((issue) => issue.subjectId),
      ["s3"],
    );
  });

  it("acusa dependência circular", () => {
    const issues = validateArchitecture(
      documentOf(
        [
          loadGeneratorNode(),
          resourceNode("a", "aws.ecs"),
          resourceNode("b", "aws.ecs"),
        ],
        [
          connection("load-generator", "a", "HTTP"),
          connection("a", "b", "HTTP"),
          connection("b", "a", "HTTP"),
        ],
      ),
    );

    const circular = find(issues, "circular-dependency");
    assert.equal(circular.length, 2);
    assert.equal(circular[0]!.severity, "error");
  });
});

describe("segurança (§72)", () => {
  it("acusa banco recebendo tráfego externo de frente", () => {
    const issues = validateArchitecture(
      documentOf(
        [loadGeneratorNode(), resourceNode("rds", "aws.rds")],
        [connection("load-generator", "rds", "Database")],
      ),
    );

    const exposed = find(issues, "datastore-exposed");
    assert.equal(exposed.length, 1);
    assert.equal(exposed[0]!.severity, "error");
  });

  it("acusa bucket sem criptografia", () => {
    const issues = validateArchitecture(
      documentOf([resourceNode("s3", "aws.s3", { encryption: "None" })], []),
    );

    assert.ok(codes(issues).includes("storage-unencrypted"));
  });

  it("acusa balanceador sem listener HTTPS", () => {
    const issues = validateArchitecture(
      documentOf(
        [loadGeneratorNode(), resourceNode("alb", "aws.alb", { listeners: "HTTP:80" }), resourceNode("ecs", "aws.ecs")],
        [connection("load-generator", "alb", "HTTP"), connection("alb", "ecs", "HTTP")],
      ),
    );

    assert.ok(codes(issues).includes("traffic-without-tls"));
  });

  it("avisa quando a aplicação recebe carga sem balanceador na frente", () => {
    const issues = validateArchitecture(
      documentOf(
        [loadGeneratorNode(), resourceNode("ecs", "aws.ecs")],
        [connection("load-generator", "ecs", "HTTP")],
      ),
    );

    assert.ok(codes(issues).includes("compute-exposed"));
  });
});

describe("disponibilidade (§72)", () => {
  it("acusa serviço com uma tarefa só", () => {
    const issues = validateArchitecture(
      documentOf(
        [resourceNode("ecs", "aws.ecs", { autoScaling: false, desiredReplicas: 1 })],
        [],
      ),
    );

    assert.ok(codes(issues).includes("single-instance"));
  });

  it("não reclama de serviço com piso de duas tarefas e autoscaling", () => {
    const issues = validateArchitecture(
      documentOf(
        [resourceNode("ecs", "aws.ecs", { autoScaling: true, minReplicas: 2 })],
        [],
      ),
    );

    assert.deepEqual(find(issues, "single-instance"), []);
  });

  it("acusa teto de réplicas abaixo do desejado", () => {
    const issues = validateArchitecture(
      documentOf(
        [resourceNode("ecs", "aws.ecs", { desiredReplicas: 8, maxReplicas: 4 })],
        [],
      ),
    );

    const invalid = find(issues, "invalid-replica-range");
    assert.equal(invalid.length, 1);
    assert.equal(invalid[0]!.severity, "error");
  });

  it("acusa cache que recusa escrita ao encher", () => {
    const issues = validateArchitecture(
      documentOf([resourceNode("redis", "opensource.redis", { evictionPolicy: "noeviction" })], []),
    );

    assert.ok(codes(issues).includes("cache-without-eviction"));
  });
});

describe("resultado", () => {
  it("é determinístico e ordenado por severidade", () => {
    const document = documentOf(
      [
        loadGeneratorNode(),
        resourceNode("rds", "aws.rds"),
        resourceNode("s3", "aws.s3", { encryption: "None", versioning: false }),
      ],
      [connection("load-generator", "rds", "Database")],
    );

    const first = validateArchitecture(document);
    const second = validateArchitecture(document);

    assert.deepEqual(first, second);
    assert.equal(first[0]!.severity, "error");
    assert.ok(first.at(-1)!.severity === "warning");
  });

  it("resume erros e avisos", () => {
    const issues = validateArchitecture(referenceArchitecture());
    const summary = summarize(issues);

    assert.equal(summary.errors, 0);
    assert.equal(summary.blocking, false);
    assert.equal(summary.warnings, issues.length);
  });
});
