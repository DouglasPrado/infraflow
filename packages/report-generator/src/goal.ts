import { estimate } from "@infraflow/analyzer";
import { getCatalogItem } from "@infraflow/registry";
import { isLoadGeneratorNode, isResourceNode } from "@infraflow/schema";
import { summarize, validateArchitecture } from "@infraflow/validator";
import { code, integer, table } from "./markdown.ts";
import type { ReportContext } from "./types.ts";

/**
 * GOAL.md (PRD §32, §73) — instruções para um agente implementar a arquitetura.
 *
 * Não é um texto fixo: o agente precisa saber **desta** arquitetura — quantos
 * recursos, por onde entra a carga, o que a validação já apontou e qual é o
 * critério de aceite do teste. Sem isso o documento seria decorativo.
 */
export function goalMd({ document, version }: ReportContext): string {
  const numbers = estimate(document);
  const generator = document.nodes.find(isLoadGeneratorNode);
  const issues = validateArchitecture(document);
  const summary = summarize(issues);

  const inventory = table(
    ["Resource", "Name", "Type"],
    document.nodes.filter(isResourceNode).map((node) => [
      getCatalogItem(node.type)?.title ?? node.type,
      code(node.name),
      code(node.type),
    ]),
    "Nenhum recurso a provisionar",
  );

  const blockers = summary.blocking
    ? table(
        ["Subject", "Finding"],
        issues
          .filter((issue) => issue.severity === "error")
          .map((issue) => [code(issue.subjectId), issue.message]),
      )
    : "_A validação não encontrou nenhum bloqueio._";

  const acceptance = generator
    ? [
        `- Sustain ${integer(generator.profile.maxRps)} req/s against ${code(generator.target.baseUrl)}.`,
        `- Keep p95 below ${integer(generator.slo.p95Ms)}ms and p99 below ${integer(generator.slo.p99Ms)}ms.`,
        `- Keep the error rate below ${generator.slo.errorRatePct}%.`,
      ].join("\n")
    : "- No load test configured; add a Load Generator before claiming capacity.";

  return `# Goal

Implement the infrastructure described by \`architecture.json\`
for **${document.name}** in environment \`${document.environment}\` on ${document.provider}${
    version === undefined ? "" : `, version v${version}`
  }.

## Requirements

Validate OpenTofu.

Run plan.

Provision infrastructure.

Deploy application.

Execute load test.

Document deviations.

## Scope

- Resources to provision: ${numbers.resourceCount}
- Estimated monthly cost: US$ ${integer(numbers.monthlyCostUsd)}
- Estimated capacity with planning headroom: ${integer(numbers.capacityRps)} req/s

${inventory}

## Acceptance

${acceptance}

## Known blockers

${blockers}

## Constraints

- \`architecture.json\` has priority over every generated document (PRD §33).
- Do not change resource topology without updating the canvas first.
- Estimated numbers are not measurements: treat them as the starting point the
  load test corrects, never as a result (PRD §85).
`;
}
