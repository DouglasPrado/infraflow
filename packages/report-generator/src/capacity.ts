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
 * Todo número aqui sai do motor de análise sobre os recursos configurados no
 * canvas. O §85 lista tomar estimativa por medição como risco do produto, então
 * o relatório repete de onde os números vêm.
 */
export function capacityMd({ document }: ReportContext): string {
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

  return `# Capacity — ${document.name}

## Estimated

${estimated}

> Estimativa. Capacidades, tempos de serviço e custos vêm do registry, não de
> medição. O motor propaga o tráfego pelo grafo e aplica teoria de filas sobre
> esses valores declarados.

### Load ladder (estimated)

${ladder}

- Limiting resource: ${bottleneckLabel}

${section("Per resource (estimated)", perResource)}`;
}
