import { getCatalogItem } from "./catalog";
import { analyze, type SimulationResult } from "./simulation";
import type { InfraEdge, InfraNode } from "./types";

/**
 * Geração mockada dos artefatos de exportação (PRD §30–§34, §63).
 *
 * O conteúdo é derivado do canvas atual, mas **não é o compiler determinístico**
 * descrito em PRD §4.3 — esse só existe a partir do Milestone 5.
 */

export interface ExportFile {
  name: string;
  language: "markdown" | "json" | "hcl";
  description: string;
}

export const EXPORT_FILES: ExportFile[] = [
  { name: "ARCHITECTURE.md", language: "markdown", description: "Recursos e dependências" },
  { name: "CAPACITY.md", language: "markdown", description: "Capacidade estimada e observada" },
  { name: "LOAD-TEST.md", language: "markdown", description: "Workload, perfil e resultado" },
  { name: "GOAL.md", language: "markdown", description: "Instruções para agentes" },
  { name: "architecture.json", language: "json", description: "Fonte estruturada para automação" },
  { name: "main.tf", language: "hcl", description: "OpenTofu (preview)" },
];

interface ReportContext {
  nodes: InfraNode[];
  edges: InfraEdge[];
  result: SimulationResult | null;
  projectName: string;
  environment: string;
}

const resourceNodes = (nodes: InfraNode[]) =>
  nodes.filter((node): node is Extract<InfraNode, { type: "resource" }> => node.type === "resource");

const loadGenerator = (nodes: InfraNode[]) =>
  nodes.find((node): node is Extract<InfraNode, { type: "loadGenerator" }> => node.type === "loadGenerator");

function architectureMd({ nodes, edges, projectName }: ReportContext): string {
  const resources = resourceNodes(nodes);

  const chain = edges
    .map((edge) => {
      const source = nodes.find((node) => node.id === edge.source);
      const target = nodes.find((node) => node.id === edge.target);
      const label = (node: InfraNode | undefined) =>
        node?.type === "resource"
          ? (getCatalogItem(node.data.type)?.title ?? node.data.type)
          : node?.type === "loadGenerator"
            ? node.data.name
            : "—";
      return `- ${label(source)} → ${label(target)} (${edge.data?.kind ?? "HTTP"})`;
    })
    .join("\n");

  const list = resources
    .map((node) => {
      const item = getCatalogItem(node.data.type);
      const props = Object.entries(node.data.props)
        .map(([key, value]) => `  - ${key}: ${value}`)
        .join("\n");
      return `### ${item?.title ?? node.data.type}\n\n- name: \`${node.data.name}\`\n- provider: ${item?.provider ?? "—"}\n- category: ${item?.category ?? "—"}\n${props}`;
    })
    .join("\n\n");

  return `# Architecture — ${projectName}

## Resources

${list || "_Nenhum recurso no canvas._"}

## Dependencies

${chain || "_Nenhuma conexão definida._"}
`;
}

function capacityMd(context: ReportContext): string {
  const { nodes, edges, result } = context;
  const analysis = analyze(nodes, edges);

  const observed = result
    ? `## Observed

- Maximum healthy throughput: ${result.maxHealthyRps} req/s
- Breaking point: ${result.breakingPointRps ?? "—"} req/s
- p95: ${result.p95Ms}ms
- Errors: ${result.errorRatePct}%
`
    : `## Observed

_Nenhum teste executado._
`;

  const perResource = resourceNodes(nodes)
    .map((node) => {
      const item = getCatalogItem(node.data.type);
      return `| ${item?.title ?? node.data.type} | ${node.data.name} | ${item?.capacityRps ?? 0} | US$ ${item?.monthlyCostUsd ?? 0} |`;
    })
    .join("\n");

  return `# Capacity

## Estimated

- Estimated capacity: ${analysis.capacityRps} req/s
- Estimated cost: US$ ${analysis.monthlyCostUsd}/month
- Resources: ${analysis.resourceCount}
- Warnings: ${analysis.warnings.length}

${observed}
## Per resource

| Resource | Name | Capacity (req/s) | Cost/month |
| --- | --- | --- | --- |
${perResource || "| — | — | — | — |"}
`;
}

function loadTestMd(context: ReportContext): string {
  const generator = loadGenerator(context.nodes);
  if (!generator) return "# Load Test\n\n_Nenhum Load Generator no canvas._\n";

  const { target, endpoints, profile, slo } = generator.data;
  const workload = endpoints
    .map((endpoint) => `| ${endpoint.method} | \`${endpoint.path}\` | ${endpoint.weight}% |`)
    .join("\n");

  const steps = context.result
    ? context.result.steps
        .map((step) => `| ${step.rps} | ${step.verdict} | ${step.p95Ms}ms | ${step.errorRatePct}% |`)
        .join("\n")
    : "";

  return `# Load Test

## Target

- Protocol: ${target.protocol}
- Base URL: ${target.baseUrl}
- Timeout: ${target.timeoutMs}ms

## Workload

| Method | Path | Weight |
| --- | --- | --- |
${workload || "| — | — | — |"}

## Profile

- Type: ${profile.type}
- Start: ${profile.startRps} req/s
- Increment: +${profile.incrementRps} req/s
- Interval: ${profile.intervalSeconds}s
- Maximum: ${profile.maxRps} req/s

## SLO

- p95 < ${slo.p95Ms}ms
- p99 < ${slo.p99Ms}ms
- errors < ${slo.errorRatePct}%

## Run

${steps ? `| RPS | Verdict | p95 | Errors |\n| --- | --- | --- | --- |\n${steps}` : "_Nenhum teste executado._"}
`;
}

function goalMd(context: ReportContext): string {
  return `# Goal

Implement the infrastructure described by \`architecture.json\`
for project **${context.projectName}** in environment \`${context.environment}\`.

## Requirements

Validate OpenTofu.

Run plan.

Provision infrastructure.

Deploy application.

Execute load test.

Document deviations.

## Constraints

- \`architecture.json\` has priority over every generated document.
- Do not change resource topology without updating the canvas first.
`;
}

function architectureJson(context: ReportContext): string {
  const payload = {
    version: 1,
    nodes: resourceNodes(context.nodes).map((node) => ({
      id: node.id,
      type: node.data.type,
      name: node.data.name,
      properties: node.data.props,
    })),
    edges: context.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      kind: edge.data?.kind ?? "HTTP",
    })),
    loadTests: loadGenerator(context.nodes)
      ? [
          {
            id: "capacity-test",
            target: loadGenerator(context.nodes)!.data.target,
            endpoints: loadGenerator(context.nodes)!.data.endpoints,
            profile: loadGenerator(context.nodes)!.data.profile,
            slo: loadGenerator(context.nodes)!.data.slo,
          },
        ]
      : [],
    environments: [{ name: context.environment }],
  };

  return JSON.stringify(payload, null, 2);
}

function mainTf(context: ReportContext): string {
  const blocks = resourceNodes(context.nodes)
    .map((node) => {
      const item = getCatalogItem(node.data.type);
      const args = Object.entries(node.data.props)
        .map(([key, value]) =>
          typeof value === "string" ? `  ${key} = "${value}"` : `  ${key} = ${value}`,
        )
        .join("\n");
      return `resource "${(item?.type ?? node.data.type).replace(".", "_")}" "${node.data.name.replace(/-/g, "_")}" {\n${args}\n}`;
    })
    .join("\n\n");

  return `# Preview gerado pelo protótipo — não executar.
# O compiler determinístico entra no Milestone 5 (PRD §74).

terraform {
  required_version = ">= 1.6"
}

${blocks || "# Nenhum recurso no canvas."}
`;
}

export function renderReport(file: string, context: ReportContext): string {
  switch (file) {
    case "ARCHITECTURE.md":
      return architectureMd(context);
    case "CAPACITY.md":
      return capacityMd(context);
    case "LOAD-TEST.md":
      return loadTestMd(context);
    case "GOAL.md":
      return goalMd(context);
    case "architecture.json":
      return architectureJson(context);
    case "main.tf":
      return mainTf(context);
    default:
      return "";
  }
}
