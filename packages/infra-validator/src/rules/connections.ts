import type { Category, EdgeKind } from "@infraflow/schema";
import type { Topology } from "../topology.ts";
import type { ValidationIssue } from "../types.ts";

/**
 * Conexões incompatíveis (PRD §72 — *connections invalid*).
 *
 * O sentido da conexão é o sentido do tráfego (PRD §13). Quem pode chamar quem
 * não é preferência de estilo: um banco não chama a aplicação, um balanceador
 * não entrega tráfego HTTP direto a um cache, e o Load Generator do §15 fala
 * HTTP — só entra por quem atende HTTP.
 */

/** Para onde cada categoria pode **enviar** tráfego. */
const ALLOWED_TARGETS: Record<Category, Category[]> = {
  compute: [
    "compute",
    "database",
    "cache",
    "storage",
    "queue",
    "network",
    "observability",
    "external",
    "generic",
  ],
  // Um CDN pode servir de origem um bucket; um balanceador entrega a compute.
  network: ["compute", "network", "storage", "observability", "external", "generic"],
  // Réplica e CDC são conexões legítimas entre bancos. Fora isso, banco é folha.
  database: ["database", "observability", "external", "generic"],
  cache: ["cache", "observability", "external", "generic"],
  storage: ["observability", "external", "generic"],
  // Fila entrega a quem consome.
  queue: ["compute", "observability", "external", "generic"],
  observability: ["observability", "external", "generic"],
  testing: ["compute", "network", "external", "generic"],
  external: ["compute", "database", "cache", "storage", "queue", "network", "observability", "external", "generic"],
  generic: ["compute", "database", "cache", "storage", "queue", "network", "observability", "external", "generic"],
};

/** Tipo de tráfego que cada categoria recebe (PRD §13). */
const EXPECTED_KIND: Partial<Record<Category, EdgeKind>> = {
  database: "Database",
  cache: "TCP",
  storage: "Storage",
  queue: "Queue",
  compute: "HTTP",
  network: "HTTP",
};

/** Por onde o Load Generator pode entrar: quem atende HTTP de fora. */
const LOAD_GENERATOR_TARGETS: Category[] = ["network", "compute", "external", "generic"];

export function connectionIssues(topology: Topology): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const originIds = new Set(topology.origins.map((node) => node.id));

  for (const edge of topology.edges) {
    const target = topology.resources.get(edge.target);

    if (originIds.has(edge.source)) {
      if (target?.category && !LOAD_GENERATOR_TARGETS.includes(target.category)) {
        issues.push({
          code: "load-generator-target-invalid",
          category: "connection",
          severity: "error",
          subjectId: edge.id,
          message: `O Load Generator envia HTTP direto para ${target.title}, que não atende HTTP.`,
          hint: "Aponte a carga para um balanceador ou para a aplicação.",
        });
      }
      continue;
    }

    const source = topology.resources.get(edge.source);
    if (!source?.category || !target?.category) continue;

    if (!ALLOWED_TARGETS[source.category].includes(target.category)) {
      issues.push({
        code: "invalid-connection",
        category: "connection",
        severity: "error",
        subjectId: edge.id,
        message: `${source.title} não origina tráfego para ${target.title}.`,
        hint: "Inverta o sentido da conexão ou remova-a.",
      });
      continue;
    }

    const expected = EXPECTED_KIND[target.category];
    if (expected && edge.kind !== expected) {
      issues.push({
        code: "connection-kind-mismatch",
        category: "connection",
        severity: "warning",
        subjectId: edge.id,
        message: `A conexão para ${target.title} está marcada como ${edge.kind}, mas ${target.title} recebe ${expected}.`,
        hint: `Troque o tipo da conexão para ${expected}.`,
      });
    }
  }

  return issues;
}
