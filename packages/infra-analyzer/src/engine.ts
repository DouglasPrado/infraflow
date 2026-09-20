import type { AnalyzerNode, EdgeFlow, Graph, LoadPoint, NodeLoad, Slo, Verdict } from "./types.ts";

/**
 * Motor de análise de capacidade.
 *
 * Substitui as curvas ajustadas à mão que o protótipo usava por três coisas que
 * se sustentam sozinhas:
 *
 * 1. **Propagação de tráfego.** A carga percorre o grafo e é atenuada por quem
 *    guarda cache. Antes, todo recurso recebia 100% do RPS gerado — um CDN com
 *    72% de acerto entregava a carga inteira à origem.
 * 2. **Teoria de filas.** A latência sob carga vem de `W = S / (1 − ρ)`, a
 *    fórmula de M/M/1, em vez de um polinômio escolhido para bater com um
 *    exemplo. É ela que faz a latência explodir perto da saturação — o que o
 *    §24 descreve em palavras.
 * 3. **Saudável é o SLO.** A capacidade máxima saudável é o maior RPS em que os
 *    critérios do §19 ainda são cumpridos, achado por busca binária. Antes era
 *    `capacidade × 0.9 × 1.0256`, onde o 1.0256 existia só para o cenário demo
 *    exibir um número específico.
 *
 * Continua sendo **estimativa**: os tempos de serviço e capacidades vêm do
 * registry, não de medição. O k6 do §77 e a Observabilidade do §78 é que
 * transformam isso em observação.
 */

/** Acima disto a fila cresce sem limite; o excedente vira recusa. */
const MAX_STABLE_UTILIZATION = 0.995;

/** A partir daqui o recurso está perto do limite, ainda que dentro do SLO. */
const WARNING_UTILIZATION = 0.85;

/**
 * Ordem topológica pelos edges. Nodes presos em ciclo saem no fim, para a
 * propagação terminar mesmo num grafo mal formado.
 */
function topologicalOrder(nodeIds: string[], edges: Graph["edges"]): string[] {
  const indegree = new Map(nodeIds.map((id) => [id, 0]));
  const outgoing = new Map<string, string[]>();

  for (const edge of edges) {
    if (!indegree.has(edge.target) || !indegree.has(edge.source)) continue;
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }

  const queue = nodeIds.filter((id) => indegree.get(id) === 0);
  const order: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    order.push(current);

    for (const next of outgoing.get(current) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }

  // Sobrou node em ciclo: entra na ordem em que aparece.
  for (const id of nodeIds) {
    if (!order.includes(id)) order.push(id);
  }

  return order;
}

/** Latência do recurso já com fila, pela fórmula de M/M/1. */
function sojournMs(serviceTimeMs: number, utilization: number): number {
  const stable = Math.min(utilization, MAX_STABLE_UTILIZATION);
  return serviceTimeMs / (1 - stable);
}

/**
 * Quantil de uma soma de tempos aproximadamente exponenciais.
 *
 * A soma não é exponencial, então a aproximação normal subestima a cauda.
 * Corrige-se pela expansão de Cornish-Fisher, que usa a assimetria da soma —
 * para um único recurso dominante isso devolve ≈3× a média, que é o valor
 * exato do quantil 95 de uma exponencial.
 */
function tailQuantile(latencies: number[], z: number): number {
  const mean = latencies.reduce((total, value) => total + value, 0);
  if (mean === 0) return 0;

  // Cada parcela é exponencial: variância = média², terceiro momento = 2·média³.
  const variance = latencies.reduce((total, value) => total + value * value, 0);
  const third = latencies.reduce((total, value) => total + 2 * value ** 3, 0);
  const sigma = Math.sqrt(variance);
  if (sigma === 0) return mean;

  const skewness = third / sigma ** 3;
  const adjusted = z + ((z * z - 1) / 6) * skewness;

  return mean + Math.max(0, adjusted) * sigma;
}

const Z95 = 1.6449;
const Z99 = 2.3263;

/** Aplica uma carga ao grafo e devolve a situação de cada recurso. */
export function evaluate(graph: Graph, offeredRps: number, slo: Slo): LoadPoint {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const order = topologicalOrder(
    [...graph.origins, ...graph.nodes.map((node) => node.id)],
    graph.edges,
  );

  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }

  // --- propagação: quem guarda cache absorve parte da carga ---
  const arrival = new Map<string, number>();
  for (const origin of graph.origins) arrival.set(origin, offeredRps);

  /** Latência acumulada até o recurso, pelo caminho mais lento. */
  const pathLatencies = new Map<string, number[]>();
  for (const origin of graph.origins) pathLatencies.set(origin, []);

  const loads = new Map<string, NodeLoad>();
  const flows: EdgeFlow[] = [];

  for (const id of order) {
    const incoming = arrival.get(id) ?? 0;
    const node = byId.get(id);

    let forwarded = incoming;
    let ownPath = pathLatencies.get(id) ?? [];

    if (node) {
      const utilization = node.capacityRps > 0 ? incoming / node.capacityRps : 0;
      const latencyMs = sojournMs(node.serviceTimeMs, utilization);

      // Saturado, o recurso só entrega o que cabe na capacidade.
      const rejectedRatio = utilization > 1 ? 1 - 1 / utilization : 0;
      const admitted = incoming * (1 - rejectedRatio);

      loads.set(id, {
        nodeId: id,
        arrivalRps: incoming,
        utilization,
        latencyMs,
        rejectedRatio,
        // Lei de Little: simultaneidade = chegada × tempo de permanência.
        concurrency: admitted * (latencyMs / 1000),
      });

      ownPath = [...ownPath, latencyMs];
      pathLatencies.set(id, ownPath);

      // Só o que não estava em cache segue adiante.
      forwarded = admitted * (1 - node.cacheHitRatio);
    }

    for (const next of outgoing.get(id) ?? []) {
      arrival.set(next, (arrival.get(next) ?? 0) + forwarded);
      flows.push({ source: id, target: next, rps: forwarded });

      // Guarda o caminho mais lento até cada recurso.
      const candidate = ownPath;
      const current = pathLatencies.get(next);
      const sum = (list: number[]) => list.reduce((total, value) => total + value, 0);
      if (!current || sum(candidate) > sum(current)) pathLatencies.set(next, candidate);
    }
  }

  const nodeLoads = [...loads.values()];

  // --- latência fim a fim pelo caminho mais lento ---
  let slowest: number[] = [];
  for (const [id, path] of pathLatencies) {
    if (!byId.has(id)) continue;
    const total = path.reduce((sum, value) => sum + value, 0);
    if (total > slowest.reduce((sum, value) => sum + value, 0)) slowest = path;
  }

  const meanMs = slowest.reduce((total, value) => total + value, 0);
  const p95Ms = tailQuantile(slowest, Z95);
  const p99Ms = tailQuantile(slowest, Z99);

  // Uma requisição só dá certo se nenhum recurso do caminho a recusar.
  const success = nodeLoads.reduce((total, load) => total * (1 - load.rejectedRatio), 1);
  const errorRatePct = (1 - success) * 100;

  const peak = nodeLoads.reduce<NodeLoad | undefined>(
    (worst, load) => (!worst || load.utilization > worst.utilization ? load : worst),
    undefined,
  );

  const meetsSlo =
    p95Ms <= slo.p95Ms && p99Ms <= slo.p99Ms && errorRatePct <= slo.errorRatePct;

  const verdict: Verdict = !meetsSlo
    ? "fail"
    : (peak?.utilization ?? 0) >= WARNING_UTILIZATION
      ? "warning"
      : "ok";

  return {
    offeredRps,
    nodes: nodeLoads,
    edges: flows,
    meanMs,
    p95Ms,
    p99Ms,
    errorRatePct,
    meetsSlo,
    verdict,
    bottleneckNodeId: peak?.nodeId,
  };
}

/**
 * Folga usada no planejamento. Dimensionar para rodar no limite não deixa
 * margem para pico, falha de zona ou implantação — 70% é a referência usual.
 */
export const PLANNING_HEADROOM = 0.7;

/**
 * Maior carga que ainda cumpre o SLO — a definição de "saudável" do PRD §19,
 * achada por busca binária em vez de estimada por um fator fixo.
 *
 * `maxUtilization` distingue as duas leituras que o §85 manda não confundir:
 * o teste vai até o limite (1), o planejamento para na folga (0.7).
 */
export function maxHealthyRps(
  graph: Graph,
  slo: Slo,
  ceilingRps: number,
  maxUtilization = 1,
): number {
  if (graph.nodes.length === 0 || graph.origins.length === 0) return 0;

  const acceptable = (rps: number) => {
    const point = evaluate(graph, rps, slo);
    const peak = point.nodes.reduce((worst, load) => Math.max(worst, load.utilization), 0);
    return point.meetsSlo && peak <= maxUtilization;
  };

  if (!acceptable(1)) return 0;

  let low = 1;
  let high = Math.max(2, Math.round(ceilingRps));
  if (acceptable(high)) return high;

  // 24 iterações resolvem qualquer teto prático até a unidade.
  for (let step = 0; step < 24 && high - low > 1; step += 1) {
    const middle = Math.floor((low + high) / 2);
    if (acceptable(middle)) low = middle;
    else high = middle;
  }

  return low;
}

/**
 * Capacidade para planejamento: o maior RPS que cumpre o SLO **e** mantém a
 * folga. É deliberadamente menor que o resultado do teste — `Estimated` nunca
 * deve se confundir com `Observed` (PRD §85).
 */
export function plannedCapacityRps(graph: Graph, slo: Slo, ceilingRps: number): number {
  return maxHealthyRps(graph, slo, ceilingRps, PLANNING_HEADROOM);
}

/** Recurso que limita a arquitetura: o mais saturado na carga informada. */
export function bottleneckAt(graph: Graph, rps: number, slo: Slo): AnalyzerNode | undefined {
  const point = evaluate(graph, rps, slo);
  return graph.nodes.find((node) => node.id === point.bottleneckNodeId);
}
