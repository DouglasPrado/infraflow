import type { ArchitectureDocument } from "@infraflow/schema";
import { availabilityIssues } from "./rules/availability.ts";
import { connectionIssues } from "./rules/connections.ts";
import { dependencyIssues } from "./rules/dependencies.ts";
import { reachabilityIssues } from "./rules/reachability.ts";
import { securityIssues } from "./rules/security.ts";
import { buildTopology } from "./topology.ts";
import type { ValidationIssue, ValidationSummary } from "./types.ts";

/** Ordem de exibição: erro antes de aviso, depois a família do §72. */
const CATEGORY_ORDER = ["connection", "dependency", "reachability", "security", "availability"];

/**
 * Validação semântica completa da arquitetura (PRD §72).
 *
 * Determinística: o mesmo documento produz sempre a mesma lista, na mesma
 * ordem. Isso importa porque o resultado vai para relatório (§73) e para o
 * contexto do assistente (§81), e diff de relatório não pode mudar à toa.
 */
export function validateArchitecture(document: ArchitectureDocument): ValidationIssue[] {
  const topology = buildTopology(document);

  const issues = [
    ...connectionIssues(topology),
    ...dependencyIssues(topology),
    ...reachabilityIssues(topology),
    ...securityIssues(topology),
    ...availabilityIssues(topology),
  ];

  return issues.sort((left, right) => {
    if (left.severity !== right.severity) return left.severity === "error" ? -1 : 1;
    const byCategory =
      CATEGORY_ORDER.indexOf(left.category) - CATEGORY_ORDER.indexOf(right.category);
    if (byCategory !== 0) return byCategory;
    if (left.subjectId !== right.subjectId) return left.subjectId < right.subjectId ? -1 : 1;
    return left.code < right.code ? -1 : left.code > right.code ? 1 : 0;
  });
}

export function summarize(issues: ValidationIssue[]): ValidationSummary {
  const errors = issues.filter((issue) => issue.severity === "error").length;
  return { errors, warnings: issues.length - errors, blocking: errors > 0 };
}
