import { runCapacityTestFor } from "@infraflow/analyzer";
import { getCatalogItem } from "@infraflow/registry";
import { isLoadGeneratorNode, isResourceNode, reachableFrom } from "@infraflow/schema";
import { code, decimal, integer, section, table } from "./markdown.ts";
import type { ReportContext } from "./types.ts";

/** LOAD-TEST.md (PRD §63, §73) — a configuração do teste e o que ela produziu. */
export function loadTestMd({ document, observed }: ReportContext): string {
  const generator = document.nodes.find(isLoadGeneratorNode);
  if (!generator) {
    return `# Load Test — ${document.name}\n\n_Nenhum Load Generator no canvas (PRD §15)._\n`;
  }

  const { target, endpoints, profile, slo } = generator;

  const targetBlock = [
    `- Protocol: ${target.protocol}`,
    `- Base URL: ${code(target.baseUrl)}`,
    `- Timeout: ${integer(target.timeoutMs)}ms`,
    ...(target.headers ? [`- Headers: ${code(target.headers)}`] : []),
    ...(target.authentication ? [`- Authentication: ${code(target.authentication)}`] : []),
  ].join("\n");

  const workload = table(
    ["Method", "Path", "Weight"],
    endpoints.map((endpoint) => [endpoint.method, code(endpoint.path), `${endpoint.weight}%`]),
    "Nenhum endpoint configurado",
  );

  const profileBlock = [
    `- Type: ${profile.type}`,
    `- Start: ${integer(profile.startRps)} req/s`,
    `- Increment: +${integer(profile.incrementRps)} req/s`,
    `- Interval: ${integer(profile.intervalSeconds)}s`,
    `- Maximum: ${integer(profile.maxRps)} req/s`,
  ].join("\n");

  const sloBlock = [
    `- p95 < ${integer(slo.p95Ms)}ms`,
    `- p99 < ${integer(slo.p99Ms)}ms`,
    `- errors < ${decimal(slo.errorRatePct)}%`,
  ].join("\n");

  const path = table(
    ["Order", "Resource"],
    reachableFrom(document, generator.id).map((id, order) => {
      const node = document.nodes.find((candidate) => candidate.id === id);
      const title =
        node && isResourceNode(node)
          ? `${getCatalogItem(node.type)?.title ?? node.type} \`${node.name}\``
          : id;
      return [String(order + 1), title];
    }),
    "A carga não alcança nenhum recurso",
  );

  const run = runCapacityTestFor(document);
  const estimated = table(
    ["Offered req/s", "Verdict", "p95", "Errors"],
    run.steps.map((step) => [
      integer(step.offeredRps),
      step.verdict,
      `${integer(step.p95Ms)}ms`,
      `${decimal(step.errorRatePct)}%`,
    ]),
    "Sem degraus a executar",
  );

  const observedBlock = observed
    ? table(
        ["Target req/s", "Achieved req/s", "p95", "Errors"],
        observed.run.stages.map((stage) => [
          integer(stage.targetRps),
          integer(stage.rps),
          `${integer(stage.p95Ms)}ms`,
          `${decimal(stage.errorRatePct)}%`,
        ]),
        "Execução sem degraus registrados",
      )
    : "_Nenhuma execução real registrada._";

  return `# Load Test — ${document.name}

${section("Target", targetBlock)}
${section("Workload", workload)}
${section("Profile", profileBlock)}
${section("SLO", sloBlock)}
${section("Path under load", path)}
${section("Estimated run", estimated)}
${section("Observed run", observedBlock)}`;
}
