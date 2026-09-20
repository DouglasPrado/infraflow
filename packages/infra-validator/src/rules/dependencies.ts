import type { Category } from "@infraflow/schema";
import type { Topology } from "../topology.ts";
import type { ValidationIssue, ValidationSeverity } from "../types.ts";

/**
 * Dependências ausentes (PRD §72 — *missing dependencies*).
 *
 * Alguns recursos não existem sozinhos: um balanceador sem destino não entrega
 * nada, um CDN sem origem não tem o que distribuir, uma fila sem consumidor
 * acumula. A regra olha para o que **falta na saída** do recurso.
 */

interface DependencyRule {
  /**
   * Onde procurar a dependência. A conexão aponta no sentido do tráfego
   * (PRD §13): um balanceador **envia** para a aplicação, um painel **recebe**
   * da fonte de métricas.
   */
  direction: "out" | "in";
  /** Precisa de ao menos uma conexão nessa direção com uma destas categorias. */
  categories: Category[];
  severity: ValidationSeverity;
  /** Nome do papel que está faltando, usado na mensagem. */
  role: string;
  hint: string;
}

const DEPENDENCIES: Record<string, DependencyRule> = {
  "aws.alb": { direction: "out", categories: ["compute"], severity: "error", role: "destino", hint: "Conecte o balanceador ao serviço que atende as requisições." },
  "aws.nlb": { direction: "out", categories: ["compute"], severity: "error", role: "destino", hint: "Conecte o balanceador ao serviço que atende as requisições." },
  "opensource.nginx": { direction: "out", categories: ["compute"], severity: "error", role: "destino", hint: "Conecte o proxy ao serviço que atende as requisições." },
  "opensource.traefik": { direction: "out", categories: ["compute"], severity: "error", role: "destino", hint: "Conecte o proxy ao serviço que atende as requisições." },
  "aws.cloudfront": {
    direction: "out",
    categories: ["network", "compute", "storage"],
    severity: "error",
    role: "origem",
    hint: "Conecte o CDN ao balanceador, ao serviço ou ao bucket que ele distribui.",
  },
  "aws.sqs": { direction: "out", categories: ["compute"], severity: "warning", role: "consumidor", hint: "Conecte a fila ao serviço que processa as mensagens." },
  "opensource.rabbitmq": { direction: "out", categories: ["compute"], severity: "warning", role: "consumidor", hint: "Conecte a fila ao serviço que processa as mensagens." },
  "opensource.nats": { direction: "out", categories: ["compute"], severity: "warning", role: "consumidor", hint: "Conecte o broker ao serviço que consome os assuntos." },
  "opensource.kafka": { direction: "out", categories: ["compute"], severity: "warning", role: "consumidor", hint: "Conecte o broker ao serviço que consome os tópicos." },
  "opensource.opentelemetry": {
    direction: "out",
    categories: ["observability"],
    severity: "warning",
    role: "destino de métricas",
    hint: "Conecte o coletor ao backend que armazena as métricas.",
  },
  "opensource.grafana": {
    direction: "in",
    categories: ["observability"],
    severity: "warning",
    role: "fonte de dados",
    hint: "Conecte o Grafana à fonte que ele consulta.",
  },
};

export function dependencyIssues(topology: Topology): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const origin of topology.origins) {
    if ((topology.outgoing.get(origin.id) ?? []).length === 0) {
      issues.push({
        code: "load-generator-without-target",
        category: "dependency",
        severity: "error",
        subjectId: origin.id,
        message: `O Load Generator "${origin.name}" não está conectado a nenhum recurso.`,
        hint: "Conecte-o ao ponto de entrada da arquitetura.",
      });
    }
  }

  for (const resource of topology.resources.values()) {
    const rule = DEPENDENCIES[resource.type];
    if (!rule) continue;

    const links =
      rule.direction === "out"
        ? (topology.outgoing.get(resource.id) ?? [])
        : (topology.incoming.get(resource.id) ?? []);

    const satisfied = links.some((edge) => {
      const other = rule.direction === "out" ? edge.target : edge.source;
      const category = topology.resources.get(other)?.category;
      return category !== undefined && rule.categories.includes(category);
    });
    if (satisfied) continue;

    issues.push({
      code: "missing-dependency",
      category: "dependency",
      severity: rule.severity,
      subjectId: resource.id,
      message: `${resource.title} "${resource.name}" está sem ${rule.role}.`,
      hint: rule.hint,
    });
  }

  return issues;
}
