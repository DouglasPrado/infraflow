import type { ResourceMetric } from "@infraflow/schema";

/**
 * Coleta das métricas do laboratório (PRD §36, §78).
 *
 * O Prometheus do laboratório já recebe os pontos com o id do node do canvas
 * como rótulo — o trabalho aqui é só recortar a janela da execução e traduzir
 * para o vocabulário de observação.
 *
 * O que não veio **não é preenchido**: série ausente significa ausência de
 * medição, nunca recurso ocioso.
 */

interface RangeQuery {
  metric: string;
  unit: string;
  promql: (labSlug: string) => string;
  /** Converte o valor bruto do Prometheus para a unidade declarada. */
  scale: (value: number) => number;
}

const QUERIES: RangeQuery[] = [
  {
    metric: "cpu",
    unit: "%",
    promql: (lab) => `container_cpu_utilization_ratio{infraflow_lab="${lab}"}`,
    /**
     * Já vem em porcentagem, apesar do sufixo `_ratio` que o exportador do
     * Prometheus acrescenta. Conferido contra o `docker stats`: o mesmo
     * container marca 0,11% lá e 0,1027 aqui. Multiplicar por cem produzia
     * leituras impossíveis — 2600% de CPU numa máquina de quatro núcleos.
     */
    scale: (value) => value,
  },
  {
    metric: "memory",
    unit: "MB",
    promql: (lab) => `container_memory_usage_total_bytes{infraflow_lab="${lab}"}`,
    scale: (value) => value / (1024 * 1024),
  },
];

interface RangeResponse {
  status?: string;
  data?: {
    result?: { metric?: Record<string, string>; values?: [number, string][] }[];
  };
}

/** No máximo isto de pontos por métrica: série longa não melhora a conclusão. */
const MAX_POINTS = 120;

export interface CollectWindow {
  startedAt: Date;
  finishedAt: Date;
}

export async function collectResourceMetrics(
  prometheusUrl: string,
  labSlug: string,
  window: CollectWindow,
): Promise<ResourceMetric[]> {
  const start = window.startedAt.getTime() / 1000;
  const end = window.finishedAt.getTime() / 1000;
  const step = Math.max(2, Math.ceil((end - start) / MAX_POINTS));

  const samples: ResourceMetric[] = [];

  for (const query of QUERIES) {
    const url = new URL("/api/v1/query_range", prometheusUrl);
    url.searchParams.set("query", query.promql(labSlug));
    url.searchParams.set("start", String(start));
    url.searchParams.set("end", String(end));
    url.searchParams.set("step", String(step));

    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (!response?.ok) continue;

    const body = (await response.json().catch(() => null)) as RangeResponse | null;
    if (body?.status !== "success") continue;

    for (const series of body.data?.result ?? []) {
      const nodeId = series.metric?.infraflow_node;
      if (!nodeId) continue;

      for (const [at, raw] of series.values ?? []) {
        const value = Number(raw);
        if (!Number.isFinite(value)) continue;

        samples.push({
          nodeId,
          metric: query.metric,
          unit: query.unit,
          value: query.scale(value),
          at: new Date(at * 1000).toISOString(),
        });
      }
    }
  }

  return samples;
}
