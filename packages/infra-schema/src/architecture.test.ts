import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseDocument,
  reachableFrom,
  safeParseDocument,
  serializeArchitectureJson,
  toArchitectureJson,
  validateIntegrity,
} from "./architecture.ts";
import type { ArchitectureDocument } from "./graph.ts";

function doc(overrides: Partial<ArchitectureDocument> = {}): ArchitectureDocument {
  return {
    version: 1,
    name: "Arquitetura Web",
    provider: "AWS",
    environment: "dev",
    nodes: [
      {
        kind: "loadGenerator",
        id: "lg",
        name: "Capacity Test",
        position: { x: 0, y: 0 },
        target: {
          protocol: "HTTPS",
          baseUrl: "https://api.example.com",
          headers: "",
          authentication: "",
          timeoutMs: 10_000,
        },
        endpoints: [{ id: "ep", method: "GET", path: "/products", weight: 100 }],
        profile: {
          type: "Capacity",
          startRps: 100,
          incrementRps: 250,
          intervalSeconds: 30,
          maxRps: 5000,
        },
        slo: { p95Ms: 500, p99Ms: 1000, errorRatePct: 1 },
      },
      {
        kind: "resource",
        id: "alb",
        type: "aws.alb",
        name: "public-alb",
        position: { x: 0, y: 100 },
        properties: { scheme: "internet-facing" },
      },
      {
        kind: "resource",
        id: "rds",
        type: "aws.rds",
        name: "orders-db",
        position: { x: 0, y: 200 },
        properties: { storageGb: 100, multiAz: false },
      },
      { kind: "note", id: "n1", variant: "sticky", text: "oi", position: { x: 9, y: 9 } },
      { kind: "group", id: "g1", label: "Observability", position: { x: 0, y: 400 }, width: 300, height: 200 },
    ],
    edges: [
      { id: "e1", source: "lg", target: "alb", kind: "HTTP" },
      { id: "e2", source: "alb", target: "rds", kind: "Database" },
    ],
    ...overrides,
  };
}

describe("parseDocument", () => {
  it("aceita um documento válido", () => {
    assert.equal(parseDocument(doc()).name, "Arquitetura Web");
  });

  it("rejeita versão desconhecida", () => {
    assert.equal(safeParseDocument({ ...doc(), version: 99 }).success, false);
  });

  it("rejeita propriedade que não é escalar", () => {
    const broken = doc();
    // O compiler de OpenTofu precisa de valores serializáveis sem ambiguidade.
    (broken.nodes[1] as { properties: Record<string, unknown> }).properties = { nested: { a: 1 } };
    assert.equal(safeParseDocument(broken).success, false);
  });

  it("rejeita peso de endpoint acima de 100", () => {
    const broken = doc();
    (broken.nodes[0] as { endpoints: { weight: number }[] }).endpoints[0]!.weight = 101;
    assert.equal(safeParseDocument(broken).success, false);
  });
});

describe("toArchitectureJson", () => {
  it("deixa de fora notas e grupos", () => {
    const json = toArchitectureJson(doc());
    assert.deepEqual(
      json.nodes.map((node) => node.id),
      ["alb", "rds"],
    );
  });

  it("promove o load generator a loadTests com os alvos alcançados", () => {
    const json = toArchitectureJson(doc());
    assert.equal(json.loadTests.length, 1);
    assert.deepEqual(json.loadTests[0]!.targets, ["alb", "rds"]);
  });

  it("carrega o environment do documento", () => {
    assert.deepEqual(toArchitectureJson(doc()).environments, [{ name: "dev" }]);
  });

  it("descarta conexões que não tocam nenhum recurso", () => {
    const withNoteEdge = doc();
    withNoteEdge.edges.push({ id: "e3", source: "n1", target: "g1", kind: "HTTP" });
    assert.deepEqual(
      toArchitectureJson(withNoteEdge).edges.map((edge) => edge.id),
      ["e1", "e2"],
    );
  });

  it("serializa de forma estável", () => {
    assert.equal(serializeArchitectureJson(doc()), serializeArchitectureJson(doc()));
  });
});

describe("reachableFrom", () => {
  it("não alcança recurso desconectado", () => {
    const orphan = doc();
    orphan.nodes.push({
      kind: "resource",
      id: "s3",
      type: "aws.s3",
      name: "assets",
      position: { x: 500, y: 0 },
      properties: {},
    });
    assert.deepEqual(reachableFrom(orphan, "lg"), ["alb", "rds"]);
  });

  it("não entra em laço com ciclo", () => {
    const cyclic = doc();
    cyclic.edges.push({ id: "e3", source: "rds", target: "alb", kind: "TCP" });
    assert.deepEqual(reachableFrom(cyclic, "lg"), ["alb", "rds"]);
  });
});

describe("validateIntegrity", () => {
  it("aceita um documento íntegro", () => {
    assert.deepEqual(validateIntegrity(doc()), []);
  });

  it("acusa conexão apontando para elemento inexistente", () => {
    const broken = doc();
    broken.edges.push({ id: "e9", source: "alb", target: "fantasma", kind: "HTTP" });
    const issues = validateIntegrity(broken);
    assert.equal(issues.length, 1);
    assert.equal(issues[0]!.code, "unknown-edge-endpoint");
  });

  it("acusa id duplicado", () => {
    const broken = doc();
    broken.nodes.push({
      kind: "resource",
      id: "alb",
      type: "aws.alb",
      name: "outro",
      position: { x: 1, y: 1 },
      properties: {},
    });
    assert.ok(validateIntegrity(broken).some((issue) => issue.code === "duplicate-id"));
  });

  it("acusa pai que não é grupo", () => {
    const broken = doc();
    (broken.nodes[2] as { parentId?: string }).parentId = "alb";
    assert.ok(validateIntegrity(broken).some((issue) => issue.code === "parent-not-group"));
  });

  it("acusa conexão de um elemento para ele mesmo", () => {
    const broken = doc();
    broken.edges.push({ id: "e9", source: "alb", target: "alb", kind: "HTTP" });
    assert.ok(validateIntegrity(broken).some((issue) => issue.code === "self-edge"));
  });
});
