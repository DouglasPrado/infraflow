import type { Topology } from "../topology.ts";
import type { ResolvedResource, ValidationIssue } from "../types.ts";

/**
 * Problemas de disponibilidade (PRD §72 — *availability problems*).
 *
 * A pergunta é sempre a mesma: **o que acontece quando uma instância cai?**
 * Recurso com uma réplica só, banco sem stand-by e cluster de um node são
 * pontos únicos de falha — o desenho não sobrevive à perda de uma zona.
 *
 * Isto é disponibilidade, não capacidade: um recurso pode aguentar toda a
 * carga e ainda assim derrubar o sistema ao reiniciar.
 */

interface ReplicaRule {
  /** Propriedade que conta instâncias. */
  key: string;
  /** Liga/desliga escalonamento — com ele ligado, o teto é outro. */
  toggleKey?: string;
  /** Propriedade que vale quando o escalonamento está ligado. */
  scaledKey?: string;
  role: string;
  hint: string;
}

const REPLICAS: Record<string, ReplicaRule> = {
  "aws.ec2": { key: "instances", toggleKey: "autoScaling", role: "instância", hint: "Suba para duas instâncias ou ligue o Auto Scaling." },
  "aws.ecs": {
    key: "desiredReplicas",
    toggleKey: "autoScaling",
    scaledKey: "minReplicas",
    role: "tarefa",
    hint: "Mantenha no mínimo duas tarefas em zonas distintas.",
  },
  "opensource.docker": { key: "replicas", role: "réplica", hint: "Suba para duas réplicas." },
  "opensource.kubernetes": { key: "replicas", toggleKey: "hpa", role: "réplica", hint: "Suba para duas réplicas ou ajuste o mínimo do HPA." },
  "aws.elasticache": { key: "nodes", role: "node", hint: "Use ao menos dois nodes e ligue o Multi-AZ." },
  "opensource.rabbitmq": { key: "nodes", role: "node", hint: "Um cluster de broker precisa de três nodes para ter quórum." },
  "opensource.nats": { key: "cluster", role: "node", hint: "Um cluster NATS precisa de três nodes para ter quórum." },
  "opensource.kafka": { key: "brokers", role: "broker", hint: "Um cluster Kafka precisa de três brokers para ter quórum." },
  "opensource.minio": { key: "nodes", role: "node", hint: "Erasure coding exige quatro nodes para tolerar falha." },
};

function count(resource: ResolvedResource, key: string): number | undefined {
  const value = resource.properties[key];
  return typeof value === "number" ? value : undefined;
}

export function availabilityIssues(topology: Topology): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const resource of topology.resources.values()) {
    const replicas = REPLICAS[resource.type];
    if (replicas) {
      const autoscaling = replicas.toggleKey === undefined
        ? false
        : resource.properties[replicas.toggleKey] === true;

      // Com escalonamento ligado, quem responde pela queda é o piso declarado.
      // Onde não há piso, o escalonamento já repõe a instância: nada a dizer.
      const key = autoscaling ? replicas.scaledKey : replicas.key;
      const instances = key === undefined ? undefined : count(resource, key);

      if (instances !== undefined && instances < 2) {
        issues.push({
          code: "single-instance",
          category: "availability",
          severity: "warning",
          subjectId: resource.id,
          message: `${resource.title} "${resource.name}" roda com uma ${replicas.role} só.`,
          hint: replicas.hint,
        });
      }
    }

    // Teto de escalonamento abaixo do que já está em uso: o autoscaling não sobe.
    const desired = count(resource, "desiredReplicas");
    const min = count(resource, "minReplicas");
    const max = count(resource, "maxReplicas");
    if (max !== undefined && ((desired !== undefined && desired > max) || (min !== undefined && min > max))) {
      issues.push({
        code: "invalid-replica-range",
        category: "availability",
        severity: "error",
        subjectId: resource.id,
        message: `${resource.title} "${resource.name}" tem mínimo/desejado acima do máximo de réplicas.`,
        hint: "O máximo precisa ser maior ou igual ao desejado e ao mínimo.",
      });
    }

    if (resource.properties.multiAz === false) {
      issues.push({
        code: "single-availability-zone",
        category: "availability",
        severity: "warning",
        subjectId: resource.id,
        message: `${resource.title} "${resource.name}" está numa zona só.`,
        hint: "Ligue o Multi-AZ — a perda de uma zona derruba o recurso inteiro.",
      });
    }

    if (resource.type === "opensource.postgresql" && resource.properties.replication === false) {
      issues.push({
        code: "database-without-replica",
        category: "availability",
        severity: "warning",
        subjectId: resource.id,
        message: `${resource.title} "${resource.name}" não tem réplica.`,
        hint: "Ligue a replicação — sem stand-by, a recuperação é restaurar backup.",
      });
    }

    if (resource.type === "aws.s3" && resource.properties.versioning === false) {
      issues.push({
        code: "storage-without-versioning",
        category: "availability",
        severity: "warning",
        subjectId: resource.id,
        message: `${resource.title} "${resource.name}" está sem versionamento.`,
        hint: "Sem versionamento, sobrescrita e exclusão não têm volta.",
      });
    }

    if (resource.type === "aws.sqs" && resource.properties.dlq === false) {
      issues.push({
        code: "queue-without-dlq",
        category: "availability",
        severity: "warning",
        subjectId: resource.id,
        message: `${resource.title} "${resource.name}" está sem dead-letter queue.`,
        hint: "Mensagem que falha sempre fica em laço e bloqueia a fila.",
      });
    }

    if (resource.type === "opensource.kafka") {
      const factor = count(resource, "replicationFactor");
      if (factor !== undefined && factor < 2) {
        issues.push({
          code: "topic-without-replication",
          category: "availability",
          severity: "warning",
          subjectId: resource.id,
          message: `${resource.title} "${resource.name}" replica partições ${factor === 1 ? "uma vez" : "zero vez"}.`,
          hint: "Use replicationFactor 3 — abaixo disso, perder um broker perde mensagem.",
        });
      }
    }

    if (resource.properties.evictionPolicy === "noeviction") {
      issues.push({
        code: "cache-without-eviction",
        category: "availability",
        severity: "warning",
        subjectId: resource.id,
        message: `${resource.title} "${resource.name}" não despeja chaves ao encher.`,
        hint: "Com noeviction, o cache cheio passa a recusar escrita em vez de liberar espaço.",
      });
    }
  }

  return issues;
}
