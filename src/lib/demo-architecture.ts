import { getCatalogItem } from "./catalog";
import type { EdgeKind, InfraEdge, InfraNode, LoadGeneratorNodeData } from "./types";

/**
 * Arquitetura com que o protótipo abre (PRD §65) e cenário de teste (PRD §66).
 * Contexto: E-commerce API.
 */

function resource(
  id: string,
  type: string,
  name: string,
  position: { x: number; y: number },
  overrides: Record<string, string | number | boolean> = {},
  parentId?: string,
): InfraNode {
  const item = getCatalogItem(type);
  if (!item) throw new Error(`Tipo desconhecido no cenário demo: ${type}`);

  return {
    id,
    type: "resource",
    position,
    ...(parentId ? { parentId, extent: "parent" as const } : {}),
    data: {
      type,
      name,
      props: { ...item.defaults, ...overrides },
      state: "default",
    },
  };
}

export const DEMO_LOAD_GENERATOR: LoadGeneratorNodeData = {
  name: "Capacity Test",
  target: {
    protocol: "HTTPS",
    baseUrl: "https://api.example.com",
    headers: "Content-Type: application/json",
    authentication: "Bearer token",
    timeoutMs: 10000,
  },
  endpoints: [
    { id: "ep-products", method: "GET", path: "/products", weight: 40 },
    { id: "ep-product", method: "GET", path: "/products/:id", weight: 30 },
    { id: "ep-login", method: "POST", path: "/login", weight: 20 },
    { id: "ep-checkout", method: "POST", path: "/checkout", weight: 10 },
  ],
  profile: {
    type: "Capacity",
    startRps: 100,
    incrementRps: 250,
    intervalSeconds: 30,
    maxRps: 5000,
  },
  slo: {
    p95Ms: 500,
    p99Ms: 1000,
    errorRatePct: 1,
  },
  state: "default",
};

export function createDemoNodes(): InfraNode[] {
  return [
    // O group precede os filhos — exigência do React Flow para sub-flows.
    {
      id: "group-observability",
      type: "group",
      position: { x: -230, y: 990 },
      style: { width: 560, height: 215 },
      data: { label: "Observability" },
    },
    {
      id: "load-generator",
      type: "loadGenerator",
      position: { x: 50, y: 0 },
      data: DEMO_LOAD_GENERATOR,
    },
    resource("cloudfront", "aws.cloudfront", "cdn", { x: 50, y: 200 }),
    resource("alb", "aws.alb", "public-alb", { x: 50, y: 375 }),
    resource("ecs", "aws.ecs", "api-service", { x: 50, y: 565 }),
    resource("rds", "aws.rds", "orders-db", { x: -230, y: 780 }),
    resource("redis", "opensource.redis", "session-cache", { x: 50, y: 780 }),
    resource("s3", "aws.s3", "product-assets", { x: 330, y: 780 }),
    resource("prometheus", "opensource.prometheus", "metrics", { x: 30, y: 65 }, {}, "group-observability"),
    resource("grafana", "opensource.grafana", "dashboards", { x: 300, y: 65 }, {}, "group-observability"),
    {
      id: "note-autoscaling",
      type: "note",
      position: { x: 400, y: 540 },
      style: { width: 210, height: 120 },
      data: {
        variant: "sticky",
        text: "Escalonamento automático baseado em CPU e requisições.",
      },
    },
  ];
}

export function createDemoEdges(): InfraEdge[] {
  const edge = (source: string, target: string, kind: EdgeKind): InfraEdge => ({
    id: `${source}-${target}`,
    source,
    target,
    sourceHandle: "bottom",
    targetHandle: "top",
    type: "flow",
    data: { kind },
  });

  return [
    edge("load-generator", "cloudfront", "HTTP"),
    edge("cloudfront", "alb", "HTTP"),
    edge("alb", "ecs", "HTTP"),
    edge("ecs", "rds", "Database"),
    edge("ecs", "redis", "TCP"),
    edge("ecs", "s3", "Storage"),
    {
      id: "prometheus-grafana",
      source: "prometheus",
      target: "grafana",
      sourceHandle: "right",
      targetHandle: "left",
      type: "flow",
      data: { kind: "TCP" },
    },
  ];
}
