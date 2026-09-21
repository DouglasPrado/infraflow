import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fromFlow, toFlow, type FlowEdgeLike, type FlowNodeLike } from "./flow.ts";

const meta = { name: "Arquitetura Web", provider: "AWS", environment: "dev" };

const nodes: FlowNodeLike[] = [
  {
    id: "g1",
    type: "group",
    position: { x: 0, y: 400 },
    style: { width: 520, height: 215 },
    data: { label: "Observability" },
  },
  {
    id: "lg",
    type: "loadGenerator",
    position: { x: 0, y: 0 },
    data: {
      name: "Capacity Test",
      state: "running",
      rps: 3000,
      target: {
        protocol: "HTTPS",
        baseUrl: "https://api.example.com",
        headers: "",
        authentication: "",
        timeoutMs: 10_000,
      },
      endpoints: [{ id: "ep", method: "GET", path: "/products", weight: 100 }],
      profile: { type: "Capacity", startRps: 100, incrementRps: 250, intervalSeconds: 30, maxRps: 5000 },
      slo: { p95Ms: 500, p99Ms: 1000, errorRatePct: 1 },
    },
  },
  {
    id: "prom",
    type: "resource",
    position: { x: 30, y: 60 },
    parentId: "g1",
    data: { type: "opensource.prometheus", name: "metrics", props: { retentionDays: 15 }, state: "warning" },
  },
  {
    id: "n1",
    type: "note",
    position: { x: 9, y: 9 },
    data: { variant: "sticky", text: "escala por CPU" },
  },
];

const edges: FlowEdgeLike[] = [
  { id: "e1", source: "lg", target: "prom", sourceHandle: "bottom", targetHandle: "top", data: { kind: "HTTP" } },
];

describe("fromFlow", () => {
  it("converte cada tipo de node do canvas", () => {
    const doc = fromFlow(meta, nodes, edges);
    assert.deepEqual(
      doc.nodes.map((node) => node.kind),
      ["group", "loadGenerator", "resource", "note"],
    );
  });

  it("descarta estado de simulação — ele não é do documento", () => {
    const doc = fromFlow(meta, nodes, edges);
    const resource = doc.nodes.find((node) => node.id === "prom");
    assert.deepEqual(resource, {
      kind: "resource",
      id: "prom",
      type: "opensource.prometheus",
      name: "metrics",
      position: { x: 30, y: 60 },
      properties: { retentionDays: 15 },
      parentId: "g1",
    });
  });

  it("ignora node de tipo desconhecido", () => {
    const doc = fromFlow(meta, [...nodes, { id: "x", type: "alien", position: { x: 0, y: 0 }, data: {} }], edges);
    assert.equal(doc.nodes.some((node) => node.id === "x"), false);
  });

  it("assume HTTP quando a conexão não declara tipo", () => {
    const doc = fromFlow(meta, nodes, [{ id: "e2", source: "lg", target: "prom" }]);
    assert.equal(doc.edges[0]!.kind, "HTTP");
  });

  it("dá tamanho padrão para nota sem style", () => {
    const doc = fromFlow(meta, nodes, edges);
    const note = doc.nodes.find((node) => node.id === "n1");
    assert.equal(note?.kind === "note" && note.width, 210);
  });

  it("rejeita canvas inválido em vez de gravar lixo", () => {
    assert.throws(() =>
      fromFlow(meta, [{ id: "bad", type: "resource", position: { x: 0, y: 0 }, data: { type: "", name: "" } }], []),
    );
  });
});

describe("round-trip", () => {
  it("preserva o documento ao voltar para o canvas e de volta", () => {
    const original = fromFlow(meta, nodes, edges);
    const flow = toFlow(original);
    const again = fromFlow(meta, flow.nodes, flow.edges);
    assert.deepEqual(again, original);
  });

  it("devolve os grupos antes dos filhos, como o React Flow exige", () => {
    const flow = toFlow(fromFlow(meta, nodes, edges));
    const groupIndex = flow.nodes.findIndex((node) => node.id === "g1");
    const childIndex = flow.nodes.findIndex((node) => node.id === "prom");
    assert.ok(groupIndex < childIndex);
  });

  it("volta com os nodes em estado limpo", () => {
    const flow = toFlow(fromFlow(meta, nodes, edges));
    const resource = flow.nodes.find((node) => node.id === "prom");
    assert.equal(resource?.data.state, "default");
  });
});
