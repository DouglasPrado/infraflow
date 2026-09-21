import { getCatalogItem } from "@infraflow/registry";
import {
  isLoadGeneratorNode,
  isResourceNode,
  type ArchitectureDocument,
  type CanvasEdge,
  type LoadGeneratorNode,
} from "@infraflow/schema";
import type { ResolvedResource } from "./types.ts";

/**
 * Leitura do documento que todas as regras compartilham.
 *
 * Calcular alcançabilidade e ciclos uma vez evita que cada regra percorra o
 * grafo por conta própria — e garante que todas enxerguem a mesma topologia.
 */
export interface Topology {
  document: ArchitectureDocument;
  /** Recursos de infraestrutura, já resolvidos contra o registry. */
  resources: Map<string, ResolvedResource>;
  /** Load Generators — as origens de tráfego do canvas (PRD §15). */
  origins: LoadGeneratorNode[];
  /** Conexões cujas duas pontas existem. */
  edges: CanvasEdge[];
  outgoing: Map<string, CanvasEdge[]>;
  incoming: Map<string, CanvasEdge[]>;
  /** Ids alcançáveis a partir de alguma origem, seguindo o sentido do tráfego. */
  reachable: Set<string>;
  /** Recursos a um salto de uma origem — quem recebe a carga de frente. */
  firstHop: Set<string>;
  /** Componentes fortemente conexos com mais de um node: dependência circular. */
  cycles: string[][];
}

function label(type: string): string {
  return getCatalogItem(type)?.title ?? type;
}

export function buildTopology(document: ArchitectureDocument): Topology {
  const resources = new Map<string, ResolvedResource>();
  for (const node of document.nodes) {
    if (!isResourceNode(node)) continue;
    const item = getCatalogItem(node.type);
    resources.set(node.id, {
      id: node.id,
      type: node.type,
      name: node.name,
      properties: node.properties,
      category: item?.category,
      title: label(node.type),
    });
  }

  const origins = document.nodes.filter(isLoadGeneratorNode);
  const known = new Set<string>([...resources.keys(), ...origins.map((node) => node.id)]);

  // Notas e grupos não carregam tráfego: conexão que os envolve não é topologia.
  const edges = document.edges.filter(
    (edge) => known.has(edge.source) && known.has(edge.target) && edge.source !== edge.target,
  );

  const outgoing = new Map<string, CanvasEdge[]>();
  const incoming = new Map<string, CanvasEdge[]>();
  for (const edge of edges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
  }

  const reachable = new Set<string>();
  const firstHop = new Set<string>();
  const queue = origins.map((node) => node.id);
  for (const id of queue) reachable.add(id);

  for (const origin of origins) {
    for (const edge of outgoing.get(origin.id) ?? []) firstHop.add(edge.target);
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const edge of outgoing.get(current) ?? []) {
      if (reachable.has(edge.target)) continue;
      reachable.add(edge.target);
      queue.push(edge.target);
    }
  }

  return {
    document,
    resources,
    origins,
    edges,
    outgoing,
    incoming,
    reachable,
    firstHop,
    cycles: stronglyConnected([...known], outgoing),
  };
}

/**
 * Componentes fortemente conexos com mais de um node (Tarjan).
 *
 * Um ciclo de dependências não é só feio: o motor de capacidade ordena o grafo
 * topologicamente para propagar tráfego, e um ciclo não tem ordem.
 */
function stronglyConnected(ids: string[], outgoing: Map<string, CanvasEdge[]>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  const visit = (id: string): void => {
    index.set(id, counter);
    low.set(id, counter);
    counter += 1;
    stack.push(id);
    onStack.add(id);

    for (const edge of outgoing.get(id) ?? []) {
      const next = edge.target;
      if (!index.has(next)) {
        visit(next);
        low.set(id, Math.min(low.get(id) ?? 0, low.get(next) ?? 0));
      } else if (onStack.has(next)) {
        low.set(id, Math.min(low.get(id) ?? 0, index.get(next) ?? 0));
      }
    }

    if (low.get(id) !== index.get(id)) return;

    const component: string[] = [];
    for (;;) {
      const member = stack.pop();
      if (member === undefined) break;
      onStack.delete(member);
      component.push(member);
      if (member === id) break;
    }
    if (component.length > 1) components.push(component.sort());
  };

  for (const id of ids) {
    if (!index.has(id)) visit(id);
  }

  return components;
}
