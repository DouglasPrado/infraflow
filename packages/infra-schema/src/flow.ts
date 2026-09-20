import {
  ArchitectureDocumentSchema,
  DOCUMENT_VERSION,
  type ArchitectureDocument,
  type CanvasNode,
} from "./graph.ts";
import type { Position } from "./primitives.ts";

/**
 * Ponte entre o canvas e o documento persistido (PRD §70 — serialization).
 *
 * Trabalha sobre uma forma **estrutural**, não sobre os tipos do React Flow: o
 * pacote de schema não pode depender de biblioteca de UI, e os nodes do React
 * Flow satisfazem esta forma naturalmente.
 */

export interface FlowNodeLike {
  id: string;
  type?: string;
  position: Position;
  data: Record<string, unknown>;
  parentId?: string;
  style?: { width?: number | string; height?: number | string };
}

export interface FlowEdgeLike {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  data?: { kind?: unknown } | undefined;
}

export interface DocumentMeta {
  name: string;
  provider: string;
  environment: string;
}

function size(value: number | string | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

const DEFAULT_NOTE = { width: 210, height: 120 };
const DEFAULT_GROUP = { width: 360, height: 220 };

/**
 * Canvas → documento. Nodes de tipo desconhecido são descartados.
 *
 * O estado do canvas é entrada não confiável — vem da UI, com campos de
 * simulação misturados. Montamos a forma solta e deixamos o Zod ser o portão:
 * se o canvas produzir algo inválido, isto lança em vez de persistir lixo.
 */
export function fromFlow(
  meta: DocumentMeta,
  nodes: FlowNodeLike[],
  edges: FlowEdgeLike[],
): ArchitectureDocument {
  const canvasNodes = nodes.flatMap((node): unknown[] => {
    const data = node.data;

    switch (node.type) {
      case "resource":
        return [
          {
            kind: "resource",
            id: node.id,
            type: data.type,
            name: data.name,
            position: node.position,
            properties: data.props ?? {},
            ...(node.parentId ? { parentId: node.parentId } : {}),
          },
        ];

      case "loadGenerator":
        return [
          {
            kind: "loadGenerator",
            id: node.id,
            name: data.name,
            position: node.position,
            target: data.target,
            endpoints: data.endpoints,
            profile: data.profile,
            slo: data.slo,
          },
        ];

      case "note":
        return [
          {
            kind: "note",
            id: node.id,
            variant: data.variant ?? "sticky",
            text: data.text ?? "",
            position: node.position,
            width: size(node.style?.width, DEFAULT_NOTE.width),
            height: size(node.style?.height, DEFAULT_NOTE.height),
          },
        ];

      case "group":
        return [
          {
            kind: "group",
            id: node.id,
            label: data.label ?? "",
            position: node.position,
            width: size(node.style?.width, DEFAULT_GROUP.width),
            height: size(node.style?.height, DEFAULT_GROUP.height),
          },
        ];

      default:
        return [];
    }
  });

  const canvasEdges = edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
    ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
    kind: edge.data?.kind ?? "HTTP",
  }));

  return ArchitectureDocumentSchema.parse({
    version: DOCUMENT_VERSION,
    name: meta.name,
    provider: meta.provider,
    environment: meta.environment,
    nodes: canvasNodes,
    edges: canvasEdges,
  });
}

/**
 * Documento → canvas. Os grupos vêm primeiro: o React Flow exige que o pai
 * apareça antes dos filhos no array de nodes.
 */
export function toFlow(document: ArchitectureDocument): {
  nodes: FlowNodeLike[];
  edges: FlowEdgeLike[];
} {
  const build = (node: CanvasNode): FlowNodeLike => {
    switch (node.kind) {
      case "resource":
        return {
          id: node.id,
          type: "resource",
          position: node.position,
          ...(node.parentId ? { parentId: node.parentId } : {}),
          data: { type: node.type, name: node.name, props: node.properties, state: "default" },
        };

      case "loadGenerator":
        return {
          id: node.id,
          type: "loadGenerator",
          position: node.position,
          data: {
            name: node.name,
            target: node.target,
            endpoints: node.endpoints,
            profile: node.profile,
            slo: node.slo,
            state: "default",
          },
        };

      case "note":
        return {
          id: node.id,
          type: "note",
          position: node.position,
          style: { width: node.width ?? DEFAULT_NOTE.width, height: node.height ?? DEFAULT_NOTE.height },
          data: { variant: node.variant, text: node.text },
        };

      case "group":
        return {
          id: node.id,
          type: "group",
          position: node.position,
          style: { width: node.width, height: node.height },
          data: { label: node.label },
        };
    }
  };

  const groups = document.nodes.filter((node) => node.kind === "group");
  const rest = document.nodes.filter((node) => node.kind !== "group");

  return {
    nodes: [...groups, ...rest].map(build),
    edges: document.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
      data: { kind: edge.kind },
    })),
  };
}
