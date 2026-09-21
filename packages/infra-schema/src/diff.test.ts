import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diffDocuments } from "./diff.ts";
import type { ArchitectureDocument, CanvasNode } from "./graph.ts";

/** PRD §38, §39 — o diff precisa responder o que mudou na arquitetura. */

function resource(id: string, type: string, name: string, properties = {}): CanvasNode {
  return { kind: "resource", id, type, name, position: { x: 0, y: 0 }, properties };
}

function document(nodes: CanvasNode[], edges: ArchitectureDocument["edges"] = []): ArchitectureDocument {
  return { version: 1, name: "App", provider: "AWS", environment: "dev", nodes, edges };
}

const base = document(
  [
    resource("ecs", "aws.ecs", "api", { desiredReplicas: 2, cpu: "2 vCPU" }),
    resource("rds", "aws.rds", "orders-db", { instanceClass: "db.t3.medium", multiAz: false }),
  ],
  [{ id: "e1", source: "ecs", target: "rds", kind: "Database" }],
);

describe("diff de arquitetura", () => {
  it("não acusa mudança quando nada mudou", () => {
    const diff = diffDocuments(base, document(base.nodes, base.edges));
    assert.equal(diff.identical, true);
  });

  it("ignora movimento no canvas", () => {
    const movido = document(
      base.nodes.map((node) => ({ ...node, position: { x: 900, y: 900 } })),
      base.edges,
    );
    assert.equal(diffDocuments(base, movido).identical, true);
  });

  it("ignora nota e grupo", () => {
    const comNota = document(
      [
        ...base.nodes,
        { kind: "note", id: "n", variant: "sticky", text: "lembrete", position: { x: 0, y: 0 } },
      ],
      base.edges,
    );
    assert.equal(diffDocuments(base, comNota).identical, true);
  });

  it("aponta propriedade alterada", () => {
    const maior = document(
      [
        resource("ecs", "aws.ecs", "api", { desiredReplicas: 6, cpu: "2 vCPU" }),
        base.nodes[1]!,
      ],
      base.edges,
    );

    const diff = diffDocuments(base, maior);
    assert.equal(diff.identical, false);
    assert.equal(diff.nodes.changed.length, 1);
    assert.deepEqual(diff.nodes.changed[0]!.properties, [
      { key: "desiredReplicas", from: 2, to: 6 },
    ]);
  });

  it("aponta recurso trocado pela alternativa (§29)", () => {
    const trocado = document(
      [base.nodes[0]!, resource("rds", "opensource.postgresql", "orders-db", {})],
      base.edges,
    );

    const diff = diffDocuments(base, trocado);
    assert.deepEqual(diff.nodes.changed[0]!.type, {
      from: "aws.rds",
      to: "opensource.postgresql",
    });
  });

  it("aponta recurso adicionado e removido", () => {
    const outro = document(
      [base.nodes[0]!, resource("redis", "opensource.redis", "cache", {})],
      [],
    );

    const diff = diffDocuments(base, outro);
    assert.deepEqual(diff.nodes.added.map((node) => node.id), ["redis"]);
    assert.deepEqual(diff.nodes.removed.map((node) => node.id), ["rds"]);
    assert.deepEqual(diff.edges.removed.map((edge) => edge.id), ["e1"]);
  });

  it("aponta renomeação", () => {
    const renomeado = document(
      [base.nodes[0]!, resource("rds", "aws.rds", "faturamento", { instanceClass: "db.t3.medium", multiAz: false })],
      base.edges,
    );

    assert.equal(diffDocuments(base, renomeado).nodes.changed[0]!.renamedFrom, "orders-db");
  });

  it("não acusa conexão redesenhada com outro id", () => {
    const redesenhado = document(base.nodes, [
      { id: "outro-id", source: "ecs", target: "rds", kind: "Database" },
    ]);
    assert.equal(diffDocuments(base, redesenhado).identical, true);
  });

  it("acusa conexão que mudou de tipo", () => {
    const outroTipo = document(base.nodes, [
      { id: "e1", source: "ecs", target: "rds", kind: "TCP" },
    ]);

    const diff = diffDocuments(base, outroTipo);
    assert.equal(diff.edges.added.length, 1);
    assert.equal(diff.edges.removed.length, 1);
  });

  it("aponta mudança de ambiente", () => {
    const producao = { ...base, environment: "prod" };
    assert.deepEqual(diffDocuments(base, producao).meta, [
      { key: "environment", from: "dev", to: "prod" },
    ]);
  });
});
