import type { Topology } from "../topology.ts";
import type { ValidationIssue } from "../types.ts";

/**
 * Recursos inalcançáveis (PRD §72 — *unreachable resources*).
 *
 * Alcançável = existe caminho de alguma origem de tráfego até o recurso,
 * seguindo o sentido das conexões. Um recurso fora desse alcance está na conta
 * (§40) e no desenho, mas nenhuma requisição chega nele.
 *
 * Observabilidade é a exceção deliberada: coletor, Prometheus e Grafana ficam
 * **fora** do caminho da requisição por construção (§36).
 */
export function reachabilityIssues(topology: Topology): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const component of topology.cycles) {
    for (const id of component) {
      const title = topology.resources.get(id)?.title ?? "Load Generator";
      issues.push({
        code: "circular-dependency",
        category: "reachability",
        severity: "error",
        subjectId: id,
        message: `${title} participa de uma dependência circular (${component.join(" → ")}).`,
        hint: "Quebre o ciclo: o tráfego precisa de uma ordem para percorrer o grafo.",
      });
    }
  }

  if (topology.resources.size > 0 && topology.origins.length === 0) {
    issues.push({
      code: "no-load-generator",
      category: "reachability",
      severity: "warning",
      subjectId: topology.document.name,
      message: "Nenhum Load Generator no canvas — não há de onde o tráfego partir.",
      hint: "Adicione um Load Generator para estimar capacidade e alcance.",
    });
  }

  const inCycle = new Set(topology.cycles.flat());

  for (const resource of topology.resources.values()) {
    if (resource.category === "observability") continue;
    if (inCycle.has(resource.id)) continue;

    const connections =
      (topology.outgoing.get(resource.id) ?? []).length +
      (topology.incoming.get(resource.id) ?? []).length;

    if (connections === 0) {
      issues.push({
        code: "orphan-resource",
        category: "reachability",
        severity: "warning",
        subjectId: resource.id,
        message: `${resource.title} "${resource.name}" não está conectado a nada.`,
        hint: "Conecte-o à arquitetura ou remova-o — ele entra no custo sem receber tráfego.",
      });
      continue;
    }

    // Sem origem não há o que alcançar: o aviso já foi dado acima.
    if (topology.origins.length === 0) continue;

    if (!topology.reachable.has(resource.id)) {
      issues.push({
        code: "unreachable-resource",
        category: "reachability",
        severity: "warning",
        subjectId: resource.id,
        message: `${resource.title} "${resource.name}" não é alcançável a partir de nenhum Load Generator.`,
        hint: "Verifique o sentido das conexões — elas apontam no sentido do tráfego.",
      });
    }
  }

  return issues;
}
