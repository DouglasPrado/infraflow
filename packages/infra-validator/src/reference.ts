import { getCatalogItem } from "@infraflow/registry";
import type {
  ArchitectureDocument,
  CanvasEdge,
  CanvasNode,
  EdgeKind,
  LoadGeneratorNode,
  PropertyBag,
  ResourceNode,
} from "@infraflow/schema";

/**
 * Construtores de documento e a arquitetura de referência do PRD §65.
 *
 * Vive em código de produção de propósito: validator, compiler, gerador de
 * relatório e worker precisam todos de **um mesmo** documento conhecido para
 * testar contra. Cinco cópias escritas à mão divergem; esta não.
 */

export function resourceNode(
  id: string,
  type: string,
  overrides: PropertyBag = {},
  name = id,
): ResourceNode {
  const item = getCatalogItem(type);
  if (!item) throw new Error(`Tipo fora do registry: ${type}`);
  return {
    kind: "resource",
    id,
    type,
    name,
    position: { x: 0, y: 0 },
    properties: { ...item.defaults, ...overrides },
  };
}

export function loadGeneratorNode(
  id = "load-generator",
  overrides: Partial<Omit<LoadGeneratorNode, "kind" | "id">> = {},
): LoadGeneratorNode {
  return {
    kind: "loadGenerator",
    id,
    name: "Capacity Test",
    position: { x: 0, y: 0 },
    target: {
      protocol: "HTTPS",
      baseUrl: "https://api.example.com",
      headers: "Content-Type: application/json",
      authentication: "Bearer token",
      timeoutMs: 10_000,
    },
    endpoints: [
      { id: "ep-products", method: "GET", path: "/products", weight: 40 },
      { id: "ep-product", method: "GET", path: "/products/:id", weight: 30 },
      { id: "ep-login", method: "POST", path: "/login", weight: 20 },
      { id: "ep-checkout", method: "POST", path: "/checkout", weight: 10 },
    ],
    profile: { type: "Capacity", startRps: 100, incrementRps: 250, intervalSeconds: 30, maxRps: 5000 },
    slo: { p95Ms: 500, p99Ms: 1000, errorRatePct: 1 },
    ...overrides,
  };
}

export function connection(source: string, target: string, kind: EdgeKind): CanvasEdge {
  return { id: `${source}-${target}`, source, target, kind };
}

export function documentOf(nodes: CanvasNode[], edges: CanvasEdge[]): ArchitectureDocument {
  return { version: 1, name: "Arquitetura Web", provider: "AWS", environment: "dev", nodes, edges };
}

/**
 * A arquitetura de referência do PRD §65: e-commerce com CDN, balanceador,
 * serviço, banco, cache, bucket e observabilidade à parte.
 */
export function referenceArchitecture(): ArchitectureDocument {
  return documentOf(
    [
      loadGeneratorNode(),
      resourceNode("cloudfront", "aws.cloudfront", {}, "cdn"),
      resourceNode("alb", "aws.alb", {}, "public-alb"),
      resourceNode("ecs", "aws.ecs", {}, "api-service"),
      resourceNode("rds", "aws.rds", {}, "orders-db"),
      resourceNode("redis", "opensource.redis", {}, "session-cache"),
      resourceNode("s3", "aws.s3", {}, "product-assets"),
      resourceNode("prometheus", "opensource.prometheus", {}, "metrics"),
      resourceNode("grafana", "opensource.grafana", {}, "dashboards"),
      { kind: "note", id: "note", variant: "sticky", text: "autoscaling", position: { x: 0, y: 0 } },
    ],
    [
      connection("load-generator", "cloudfront", "HTTP"),
      connection("cloudfront", "alb", "HTTP"),
      connection("alb", "ecs", "HTTP"),
      connection("ecs", "rds", "Database"),
      connection("ecs", "redis", "TCP"),
      connection("ecs", "s3", "Storage"),
      connection("prometheus", "grafana", "TCP"),
    ],
  );
}
