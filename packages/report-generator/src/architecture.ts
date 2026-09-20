import { getCatalogItem } from "@infraflow/registry";
import { estimate } from "@infraflow/analyzer";
import { isLoadGeneratorNode, isResourceNode } from "@infraflow/schema";
import { validateArchitecture } from "@infraflow/validator";
import { code, integer, section, table, usd } from "./markdown.ts";
import type { ReportContext } from "./types.ts";

/** ARCHITECTURE.md (PRD §31, §73) — o que existe e como está ligado. */
export function architectureMd({ document, version }: ReportContext): string {
  const resources = document.nodes.filter(isResourceNode);
  const generators = document.nodes.filter(isLoadGeneratorNode);
  const numbers = estimate(document);
  const byId = new Map(document.nodes.map((node) => [node.id, node]));

  const label = (id: string): string => {
    const node = byId.get(id);
    if (!node) return id;
    if (isResourceNode(node)) return `${getCatalogItem(node.type)?.title ?? node.type} \`${node.name}\``;
    if (isLoadGeneratorNode(node)) return `Load Generator \`${node.name}\``;
    return id;
  };

  const overview = [
    `- Provider: ${document.provider}`,
    `- Environment: ${code(document.environment)}`,
    ...(version === undefined ? [] : [`- Version: v${version}`]),
    `- Resources: ${numbers.resourceCount}`,
    `- Estimated cost: ${usd(numbers.monthlyCostUsd)}/month`,
  ].join("\n");

  const inventory = table(
    ["Resource", "Name", "Category", "Provider", "Capacity (est.)", "Cost/month"],
    resources.map((node) => {
      const item = getCatalogItem(node.type);
      return [
        item?.title ?? node.type,
        code(node.name),
        item?.category ?? "—",
        item?.provider ?? "—",
        item ? `${integer(item.capacityRps)} req/s` : "—",
        item ? usd(item.monthlyCostUsd) : "—",
      ];
    }),
    "Nenhum recurso no canvas",
  );

  const details = resources
    .map((node) => {
      const item = getCatalogItem(node.type);
      const properties = table(
        ["Property", "Value"],
        Object.entries(node.properties)
          .sort(([left], [right]) => (left < right ? -1 : 1))
          .map(([key, value]) => [code(key), code(value)]),
        "Sem propriedades",
      );
      return `### ${item?.title ?? node.type} \`${node.name}\`\n\n- type: ${code(node.type)}\n- id: ${code(node.id)}\n\n${properties}`;
    })
    .join("\n\n");

  const dependencies = table(
    ["From", "To", "Traffic"],
    document.edges
      .filter((edge) => byId.has(edge.source) && byId.has(edge.target))
      .map((edge) => [label(edge.source), label(edge.target), edge.kind]),
    "Nenhuma conexão definida",
  );

  const entryPoints = table(
    ["Load Generator", "Entry point", "Base URL"],
    generators.flatMap((generator) =>
      document.edges
        .filter((edge) => edge.source === generator.id)
        .map((edge) => [code(generator.name), label(edge.target), code(generator.target.baseUrl)]),
    ),
    "Nenhum Load Generator conectado",
  );

  const issues = validateArchitecture(document);
  const validation = table(
    ["Severity", "Family", "Subject", "Finding"],
    issues.map((issue) => [issue.severity, issue.category, code(issue.subjectId), issue.message]),
    "Nenhum problema encontrado",
  );

  return `# Architecture — ${document.name}

${overview}

${section("Resources", inventory)}
${details ? `${details}\n\n` : ""}${section("Dependencies", dependencies)}
${section("Entry points", entryPoints)}
${section("Validation", validation)}`;
}
