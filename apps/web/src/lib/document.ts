import { fromFlow, toFlow, type ArchitectureDocument } from "@infraflow/schema";
import type { InfraEdge, InfraNode } from "./types";

/**
 * Adaptação entre o canvas e o documento persistido.
 *
 * A conversão em si vive em `@infraflow/schema` — a API e os workers também
 * precisam dela. Aqui ficam só os atalhos que a web usa.
 */

export interface DocumentMeta {
  name: string;
  provider: string;
  environment: string;
}

export function toDocument(
  meta: DocumentMeta,
  nodes: InfraNode[],
  edges: InfraEdge[],
): ArchitectureDocument {
  return fromFlow(meta, nodes, edges);
}

export function fromDocument(document: ArchitectureDocument): {
  nodes: InfraNode[];
  edges: InfraEdge[];
} {
  const flow = toFlow(document);
  return {
    nodes: flow.nodes as unknown as InfraNode[],
    edges: flow.edges.map((edge) => ({
      ...edge,
      sourceHandle: edge.sourceHandle ?? undefined,
      targetHandle: edge.targetHandle ?? undefined,
      type: "flow",
      data: edge.data as InfraEdge["data"],
    })) as InfraEdge[],
  };
}

/** Documento inicial de quem entra pela primeira vez (PRD §65, §66). */
export function demoDocument(nodes: InfraNode[], edges: InfraEdge[]): ArchitectureDocument {
  return fromFlow(
    { name: "Arquitetura Web", provider: "AWS", environment: "dev" },
    nodes,
    edges,
  );
}
