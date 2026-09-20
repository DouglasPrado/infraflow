import { estimate, runCapacityTestFor, sloOf } from "@infraflow/analyzer";
import {
  cacheHitRatioFor,
  capacityFor,
  getCatalogItem,
  monthlyCostFor,
  serviceTimeFor,
} from "@infraflow/registry";
import { isResourceNode } from "@infraflow/schema";
import { code, decimal, integer, percent, section, table, usd } from "./markdown.ts";
import type { ReportContext } from "./types.ts";

/**
 * CAPACITY.md (PRD §73) — quanto a arquitetura aguenta.
 *
 * As duas seções nunca se misturam: `Estimated` sai do modelo, `Observed` sai
 * da medição. O §85 lista confundir as duas como risco do produto, então o
 * relatório repete de onde cada número veio.
 */
export function capacityMd({ document, observed }: ReportContext): string {
  const numbers = estimate(document);
  const run = runCapacityTestFor(document);
  const slo = sloOf(document);

  const estimated = [
    `- Planning capacity: ${integer(numbers.capacityRps)} req/s — cumpre o SLO e guarda folga`,
    `- Test ceiling: ${integer(run.maxHealthyRps)} req/s — maior carga que ainda cumpre o SLO`,
    `- Breaking point: ${run.breakingPointRps === null ? "não alcançado no perfil configurado" : `${integer(run.breakingPointRps)} req/s`}`,
    `- p95 at ceiling: ${integer(run.p95Ms)}ms (SLO: ${integer(slo.p95Ms)}ms)`,
    `- Errors at ceiling: ${decimal(run.errorRatePct)}% (SLO: ${decimal(slo.errorRatePct)}%)`,
    `- Estimated cost: ${usd(numbers.monthlyCostUsd)}/month`,
  ].join("\n");

  const bottleneck = run.bottleneckNodeId
    ? document.nodes.find((node) => node.id === run.bottleneckNodeId)
    : undefined;
  const bottleneckLabel =
    bottleneck && isResourceNode(bottleneck)
      ? `${getCatalogItem(bottleneck.type)?.title ?? bottleneck.type} \`${bottleneck.name}\``
      : "—";

  const ladder = table(
    ["Offered req/s", "Verdict", "p95", "Errors", "Peak saturation"],
    run.steps.map((step) => [
      integer(step.offeredRps),
      step.verdict,
      `${integer(step.p95Ms)}ms`,
      `${decimal(step.errorRatePct)}%`,
      percent(step.nodes.reduce((peak, load) => Math.max(peak, load.utilization), 0)),
    ]),
    "Sem Load Generator no canvas",
  );

  const perResource = table(
    ["Resource", "Name", "Capacity (req/s)", "Service time", "Cache hit", "Cost/month"],
    document.nodes.filter(isResourceNode).flatMap((node) => {
      const item = getCatalogItem(node.type);
      if (!item) return [];
      return [
        [
          item.title,
          code(node.name),
          integer(capacityFor(item, node.properties)),
          `${decimal(serviceTimeFor(item, node.properties), 2)}ms`,
          percent(cacheHitRatioFor(item, node.properties)),
          usd(monthlyCostFor(item, node.properties)),
        ],
      ];
    }),
    "Nenhum recurso no canvas",
  );

  const observedSection = observed
    ? observedMd({ document, observed })
    : "_Nenhuma execução real registrada. `Observed` só aparece depois de um teste com k6 (PRD §77)._\n";

  return `# Capacity — ${document.name}

## Estimated

${estimated}

> Estimativa. Capacidades, tempos de serviço e custos vêm do registry, não de
> medição. O motor propaga o tráfego pelo grafo e aplica teoria de filas sobre
> esses valores declarados.

### Load ladder (estimated)

${ladder}

- Limiting resource: ${bottleneckLabel}

${section("Per resource (estimated)", perResource)}
## Observed

${observedSection}`;
}

function observedMd({ document, observed }: Required<Pick<ReportContext, "document">> & {
  observed: NonNullable<ReportContext["observed"]>;
}): string {
  const { run, metrics, runId } = observed;

  const header = [
    ...(runId === undefined ? [] : [`- Run: ${code(runId)}`]),
    `- Window: ${run.startedAt} → ${run.finishedAt} (${decimal(run.durationSeconds, 0)}s)`,
    `- Requests: ${integer(run.requests)}`,
    `- Sustained throughput: ${integer(run.rps)} req/s`,
    `- p50 / p95 / p99: ${integer(run.p50Ms)}ms / ${integer(run.p95Ms)}ms / ${integer(run.p99Ms)}ms`,
    `- Errors: ${decimal(run.errorRatePct)}%`,
    `- SLO: ${run.meetsSlo ? "cumprido" : "violado"}`,
  ].join("\n");

  const stages = table(
    ["Target req/s", "Achieved req/s", "p95", "Errors"],
    run.stages.map((stage) => [
      integer(stage.targetRps),
      integer(stage.rps),
      `${integer(stage.p95Ms)}ms`,
      `${decimal(stage.errorRatePct)}%`,
    ]),
    "Execução sem degraus registrados",
  );

  const byId = new Map(document.nodes.map((node) => [node.id, node]));
  const resourceMetrics = table(
    ["Resource", "Metric", "Value", "At"],
    (metrics ?? []).map((sample) => {
      const node = byId.get(sample.nodeId);
      const title =
        node && isResourceNode(node)
          ? `${getCatalogItem(node.type)?.title ?? node.type} \`${node.name}\``
          : sample.nodeId;
      return [title, code(sample.metric), `${decimal(sample.value, 2)}${sample.unit}`, sample.at];
    }),
    "Nenhuma métrica coletada",
  );

  return `${header}

### Stages

${stages}

### Resource metrics

${resourceMetrics}
`;
}
