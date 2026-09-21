import {
  isLoadGeneratorNode,
  isResourceNode,
  type ArchitectureDocument,
  type CanvasEdge,
  type CanvasNode,
} from "./graph.ts";
import type { PropertyValue } from "./primitives.ts";

/**
 * Diferença entre duas versões de uma arquitetura (PRD §38, §39, §80).
 *
 * Compara **o que é infraestrutura**: recurso, propriedade, conexão e a
 * configuração do teste. Posição no canvas, nota e grupo ficam de fora — mover
 * um card não muda a arquitetura, e um diff que acusa isso não serve para
 * decidir nada.
 */

export interface PropertyChange {
  key: string;
  from: PropertyValue | undefined;
  to: PropertyValue | undefined;
}

export interface NodeChange {
  id: string;
  name: string;
  /** Presente quando o recurso trocou de tipo (PRD §29). */
  type?: { from: string; to: string };
  renamedFrom?: string;
  properties: PropertyChange[];
}

export interface NodeSummary {
  id: string;
  name: string;
  type: string;
}

export interface EdgeSummary {
  id: string;
  source: string;
  target: string;
  kind: string;
}

export interface DocumentDiff {
  meta: { key: string; from: string; to: string }[];
  nodes: {
    added: NodeSummary[];
    removed: NodeSummary[];
    changed: NodeChange[];
  };
  edges: {
    added: EdgeSummary[];
    removed: EdgeSummary[];
  };
  /** `true` quando nada que importa mudou. */
  identical: boolean;
}

/** Tipo declarado do node, já normalizado — o Load Generator não vem do registry. */
function typeOf(node: CanvasNode): string {
  if (isResourceNode(node)) return node.type;
  if (isLoadGeneratorNode(node)) return "testing.load-generator";
  return node.kind;
}

function nameOf(node: CanvasNode): string {
  if (isResourceNode(node) || isLoadGeneratorNode(node)) return node.name;
  return node.id;
}

/**
 * Propriedades comparáveis de um node.
 *
 * Para o recurso são as do painel. Para o Load Generator são perfil e SLO —
 * mudar a escada de carga muda o que o teste significa, e isso precisa aparecer
 * na comparação tanto quanto trocar a instância do banco.
 */
function propertiesOf(node: CanvasNode): Record<string, PropertyValue> {
  if (isResourceNode(node)) return node.properties;

  if (isLoadGeneratorNode(node)) {
    return {
      "profile.type": node.profile.type,
      "profile.startRps": node.profile.startRps,
      "profile.incrementRps": node.profile.incrementRps,
      "profile.intervalSeconds": node.profile.intervalSeconds,
      "profile.maxRps": node.profile.maxRps,
      "slo.p95Ms": node.slo.p95Ms,
      "slo.p99Ms": node.slo.p99Ms,
      "slo.errorRatePct": node.slo.errorRatePct,
      "target.baseUrl": node.target.baseUrl,
      endpoints: node.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path} ${endpoint.weight}%`).join(", "),
    };
  }

  return {};
}

/** Só o que carrega infraestrutura entra na comparação. */
const comparable = (node: CanvasNode): boolean =>
  isResourceNode(node) || isLoadGeneratorNode(node);

const summary = (node: CanvasNode): NodeSummary => ({
  id: node.id,
  name: nameOf(node),
  type: typeOf(node),
});

const edgeSummary = (edge: CanvasEdge): EdgeSummary => ({
  id: edge.id,
  source: edge.source,
  target: edge.target,
  kind: edge.kind,
});

export function diffDocuments(from: ArchitectureDocument, to: ArchitectureDocument): DocumentDiff {
  const meta: DocumentDiff["meta"] = [];
  for (const key of ["name", "provider", "environment"] as const) {
    if (from[key] !== to[key]) meta.push({ key, from: from[key], to: to[key] });
  }

  const before = new Map(from.nodes.filter(comparable).map((node) => [node.id, node]));
  const after = new Map(to.nodes.filter(comparable).map((node) => [node.id, node]));

  const added = [...after.values()].filter((node) => !before.has(node.id)).map(summary);
  const removed = [...before.values()].filter((node) => !after.has(node.id)).map(summary);

  const changed: NodeChange[] = [];
  for (const [id, current] of after) {
    const previous = before.get(id);
    if (!previous) continue;

    const previousProps = propertiesOf(previous);
    const currentProps = propertiesOf(current);
    const keys = [...new Set([...Object.keys(previousProps), ...Object.keys(currentProps)])].sort();

    const properties = keys.flatMap((key) =>
      previousProps[key] === currentProps[key]
        ? []
        : [{ key, from: previousProps[key], to: currentProps[key] }],
    );

    const typeChanged = typeOf(previous) !== typeOf(current);
    const renamed = nameOf(previous) !== nameOf(current);
    if (properties.length === 0 && !typeChanged && !renamed) continue;

    changed.push({
      id,
      name: nameOf(current),
      ...(typeChanged ? { type: { from: typeOf(previous), to: typeOf(current) } } : {}),
      ...(renamed ? { renamedFrom: nameOf(previous) } : {}),
      properties,
    });
  }

  // Conexão é identificada por origem, destino e tipo: o id é do canvas, e
  // redesenhar a mesma ligação não deveria aparecer como mudança.
  const key = (edge: CanvasEdge) => `${edge.source}\u0000${edge.target}\u0000${edge.kind}`;
  const beforeEdges = new Map(from.edges.map((edge) => [key(edge), edge]));
  const afterEdges = new Map(to.edges.map((edge) => [key(edge), edge]));

  const addedEdges = [...afterEdges.entries()]
    .filter(([id]) => !beforeEdges.has(id))
    .map(([, edge]) => edgeSummary(edge));
  const removedEdges = [...beforeEdges.entries()]
    .filter(([id]) => !afterEdges.has(id))
    .map(([, edge]) => edgeSummary(edge));

  return {
    meta,
    nodes: { added, removed, changed },
    edges: { added: addedEdges, removed: removedEdges },
    identical:
      meta.length === 0 &&
      added.length === 0 &&
      removed.length === 0 &&
      changed.length === 0 &&
      addedEdges.length === 0 &&
      removedEdges.length === 0,
  };
}
