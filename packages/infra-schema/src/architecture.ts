import { z } from "zod";
import {
  ArchitectureDocumentSchema,
  CanvasEdgeSchema,
  LoadProfileSchema,
  LoadTargetSchema,
  SloSchema,
  WorkloadEndpointSchema,
  isLoadGeneratorNode,
  isResourceNode,
  type ArchitectureDocument,
  type CanvasNode,
} from "./graph.ts";
import { IdSchema, PropertyBagSchema } from "./primitives.ts";

/**
 * `architecture.json` — a fonte estruturada para automação (PRD §33).
 *
 * Tem **prioridade sobre os documentos gerados**, então carrega só o que é
 * infraestrutura: notas e grupos ficam de fora. É uma projeção do documento do
 * canvas, nunca uma segunda fonte de verdade.
 */

export const ARCHITECTURE_JSON_VERSION = 1;

export const ArchitectureJsonNodeSchema = z.object({
  id: IdSchema,
  type: z.string().min(1),
  name: z.string().min(1),
  properties: PropertyBagSchema,
});

export const ArchitectureJsonEdgeSchema = CanvasEdgeSchema.pick({
  id: true,
  source: true,
  target: true,
  kind: true,
});

export const ArchitectureJsonLoadTestSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  target: LoadTargetSchema,
  endpoints: z.array(WorkloadEndpointSchema),
  profile: LoadProfileSchema,
  slo: SloSchema,
  /** Recursos que recebem a carga, na ordem em que foram alcançados. */
  targets: z.array(IdSchema),
});

export const ArchitectureJsonSchema = z.object({
  version: z.literal(ARCHITECTURE_JSON_VERSION),
  nodes: z.array(ArchitectureJsonNodeSchema),
  edges: z.array(ArchitectureJsonEdgeSchema),
  loadTests: z.array(ArchitectureJsonLoadTestSchema),
  environments: z.array(z.object({ name: z.string().min(1) })),
});
export type ArchitectureJson = z.infer<typeof ArchitectureJsonSchema>;

/**
 * Recursos alcançáveis a partir de uma origem, seguindo os edges no sentido
 * origem → destino. É o mesmo percurso que decide quem recebe carga (PRD §21).
 */
export function reachableFrom(document: ArchitectureDocument, originId: string): string[] {
  const outgoing = new Map<string, string[]>();
  for (const edge of document.edges) {
    const list = outgoing.get(edge.source);
    if (list) list.push(edge.target);
    else outgoing.set(edge.source, [edge.target]);
  }

  const resourceIds = new Set(document.nodes.filter(isResourceNode).map((node) => node.id));
  const seen = new Set<string>();
  const ordered: string[] = [];
  const queue = [originId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;

    for (const next of outgoing.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      if (resourceIds.has(next)) ordered.push(next);
      queue.push(next);
    }
  }

  return ordered;
}

/** PRD §33 — projeta o documento do canvas no contrato de automação. */
export function toArchitectureJson(document: ArchitectureDocument): ArchitectureJson {
  const resourceIds = new Set(document.nodes.filter(isResourceNode).map((node) => node.id));

  return {
    version: ARCHITECTURE_JSON_VERSION,
    nodes: document.nodes.filter(isResourceNode).map((node) => ({
      id: node.id,
      type: node.type,
      name: node.name,
      properties: node.properties,
    })),
    // Conexões puramente visuais (para nota ou grupo) não descrevem infraestrutura.
    edges: document.edges
      .filter((edge) => resourceIds.has(edge.target) || resourceIds.has(edge.source))
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        kind: edge.kind,
      })),
    loadTests: document.nodes.filter(isLoadGeneratorNode).map((node) => ({
      id: node.id,
      name: node.name,
      target: node.target,
      endpoints: node.endpoints,
      profile: node.profile,
      slo: node.slo,
      targets: reachableFrom(document, node.id),
    })),
    environments: [{ name: document.environment }],
  };
}

/** Problema estrutural encontrado no documento. */
export interface IntegrityIssue {
  code: "unknown-edge-endpoint" | "duplicate-id" | "unknown-parent" | "parent-not-group" | "self-edge";
  message: string;
  subjectId: string;
}

/**
 * Integridade referencial do documento — não julga a arquitetura.
 * As regras de arquitetura (conexão inválida, dependência faltando, problema de
 * segurança) são o Architecture Validator do Milestone 3 (PRD §72).
 */
export function validateIntegrity(document: ArchitectureDocument): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const byId = new Map<string, CanvasNode>();

  for (const node of document.nodes) {
    if (byId.has(node.id)) {
      issues.push({
        code: "duplicate-id",
        message: `Mais de um elemento usa o id "${node.id}".`,
        subjectId: node.id,
      });
      continue;
    }
    byId.set(node.id, node);
  }

  for (const node of document.nodes) {
    const parentId = node.kind === "resource" ? node.parentId : undefined;
    if (parentId === undefined) continue;

    const parent = byId.get(parentId);
    if (!parent) {
      issues.push({
        code: "unknown-parent",
        message: `"${node.id}" aponta para o grupo inexistente "${parentId}".`,
        subjectId: node.id,
      });
    } else if (parent.kind !== "group") {
      issues.push({
        code: "parent-not-group",
        message: `"${node.id}" está contido em "${parentId}", que não é um grupo.`,
        subjectId: node.id,
      });
    }
  }

  const edgeIds = new Set<string>();
  for (const edge of document.edges) {
    if (edgeIds.has(edge.id)) {
      issues.push({
        code: "duplicate-id",
        message: `Mais de uma conexão usa o id "${edge.id}".`,
        subjectId: edge.id,
      });
    }
    edgeIds.add(edge.id);

    if (edge.source === edge.target) {
      issues.push({
        code: "self-edge",
        message: `A conexão "${edge.id}" liga "${edge.source}" a si mesmo.`,
        subjectId: edge.id,
      });
    }

    for (const endpoint of [edge.source, edge.target]) {
      if (!byId.has(endpoint)) {
        issues.push({
          code: "unknown-edge-endpoint",
          message: `A conexão "${edge.id}" aponta para o elemento inexistente "${endpoint}".`,
          subjectId: edge.id,
        });
      }
    }
  }

  return issues;
}

/** Desserializa e valida um documento vindo do disco, da API ou do banco. */
export function parseDocument(input: unknown): ArchitectureDocument {
  return ArchitectureDocumentSchema.parse(input);
}

export function safeParseDocument(input: unknown) {
  return ArchitectureDocumentSchema.safeParse(input);
}

/** Serializa de forma estável — o mesmo documento produz sempre o mesmo texto. */
export function serializeArchitectureJson(document: ArchitectureDocument): string {
  return `${JSON.stringify(toArchitectureJson(document), null, 2)}\n`;
}
