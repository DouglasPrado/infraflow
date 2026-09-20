import type { CatalogItem } from "./types.ts";

/**
 * Como a configuração de um recurso muda sua capacidade e seu custo.
 *
 * Sem isto, o painel de propriedades é decorativo: trocar a instância do banco
 * ou dobrar as réplicas não mexeria em nada. O laço do produto depende disso —
 * o PRD §38 mostra a capacidade subindo e o gargalo migrando entre versões, e a
 * recomendação "Upgrade database instance" do §25 só significa algo se o
 * upgrade tiver efeito.
 *
 * **Invariante:** na configuração padrão de cada item, os fatores multiplicam
 * exatamente 1. `capacityRps` e `monthlyCostUsd` do catálogo continuam sendo os
 * valores do default, e o cenário demo do §65 segue produzindo os números do §67.
 *
 * Tudo aqui continua mockado. Medição real só com a Observabilidade do §78.
 */

export type Factor =
  /** Proporcional ao valor: réplicas, nodes, brokers. */
  | { kind: "linear"; key: string; baseline: number }
  /** Tabela por opção: classe de instância, vCPU, tier de memória. */
  | { kind: "scale"; key: string; values: Record<string, number> }
  /** Liga/desliga. */
  | { kind: "toggle"; key: string; on: number; off: number }
  /**
   * Com autoscaling o teto é o máximo de réplicas; sem ele, o desejado.
   * É a diferença entre "aguenta um pico" e "tem isso agora".
   */
  | { kind: "autoscale"; toggleKey: string; onKey: string; offKey: string; baseline: number }
  /**
   * Teto absoluto, não multiplicador. Conexões limitam a vazão independente do
   * tamanho da instância — é por isso que "enable connection pooling" é uma
   * recomendação de verdade (§25).
   */
  | { kind: "cap"; key: string; perUnit: number };

/** Propriedades de um node, como gravadas no documento. */
export type Props = Record<string, string | number | boolean>;

function numberAt(props: Props, key: string, fallback: number): number {
  const value = props[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Multiplicadores e tetos de um conjunto de fatores. */
function apply(base: number, factors: Factor[], props: Props): number {
  let multiplier = 1;
  let ceiling = Number.POSITIVE_INFINITY;

  for (const factor of factors) {
    switch (factor.kind) {
      case "linear":
        multiplier *= numberAt(props, factor.key, factor.baseline) / factor.baseline;
        break;

      case "scale":
        multiplier *= factor.values[String(props[factor.key])] ?? 1;
        break;

      case "toggle":
        multiplier *= props[factor.key] ? factor.on : factor.off;
        break;

      case "autoscale": {
        const key = props[factor.toggleKey] ? factor.onKey : factor.offKey;
        multiplier *= numberAt(props, key, factor.baseline) / factor.baseline;
        break;
      }

      case "cap":
        ceiling = Math.min(ceiling, numberAt(props, factor.key, 0) * factor.perUnit);
        break;
    }
  }

  return Math.max(1, Math.round(Math.min(base * multiplier, ceiling)));
}

/**
 * Reancora uma escala no padrão de um item, para que ele valha exatamente 1.
 * Sem isto, um serviço que compartilha a escala mas tem outro default nasce com
 * a capacidade errada — foi o que aconteceu com o Docker, cujo padrão é 1 vCPU
 * enquanto a escala é ancorada em 2.
 */
function anchoredAt(values: Record<string, number>, option: string): Record<string, number> {
  const divisor = values[option] ?? 1;
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value / divisor]));
}

/** Escalas reaproveitadas entre serviços. */
const VCPU: Record<string, number> = {
  "0.5 vCPU": 0.3,
  "1 vCPU": 0.55,
  "2 vCPU": 1,
  "4 vCPU": 1.85,
  "8 vCPU": 3.4,
};

const REDIS_MEMORY: Record<string, number> = {
  "512MB": 0.4,
  "1GB": 0.7,
  "2GB": 1,
  "4GB": 1.6,
  "8GB": 2.4,
};

const RDS_INSTANCE: Record<string, number> = {
  "db.t3.small": 0.45,
  "db.t3.medium": 1,
  "db.m6g.large": 2.3,
  "db.m6g.xlarge": 4.4,
  "db.r6g.xlarge": 5.6,
};

const EC2_INSTANCE: Record<string, number> = {
  "t3.small": 0.5,
  "t3.medium": 1,
  "t3.large": 1.9,
  "m6i.large": 2.4,
  "c6i.xlarge": 4.5,
};

const CACHE_NODE: Record<string, number> = {
  "cache.t3.micro": 1,
  "cache.t3.small": 1.8,
  "cache.m6g.large": 4,
  "cache.r6g.large": 5.2,
};

/** O que faz o recurso aguentar mais carga. */
export const CAPACITY_MODEL: Record<string, Factor[]> = {
  "aws.ec2": [
    { kind: "scale", key: "instanceType", values: EC2_INSTANCE },
    { kind: "linear", key: "instances", baseline: 2 },
  ],
  "aws.ecs": [
    { kind: "scale", key: "cpu", values: VCPU },
    {
      kind: "autoscale",
      toggleKey: "autoScaling",
      onKey: "maxReplicas",
      offKey: "desiredReplicas",
      baseline: 10,
    },
  ],
  "aws.lambda": [{ kind: "linear", key: "concurrency", baseline: 100 }],
  "opensource.docker": [
    { kind: "scale", key: "cpu", values: anchoredAt(VCPU, "1 vCPU") },
    { kind: "linear", key: "replicas", baseline: 1 },
  ],
  "opensource.kubernetes": [
    { kind: "scale", key: "cpu", values: VCPU },
    { kind: "linear", key: "replicas", baseline: 3 },
  ],

  "opensource.minio": [{ kind: "linear", key: "nodes", baseline: 4 }],

  "aws.rds": [
    { kind: "scale", key: "instanceClass", values: RDS_INSTANCE },
    { kind: "cap", key: "maxConnections", perUnit: 20 },
  ],
  "opensource.postgresql": [
    { kind: "scale", key: "cpu", values: VCPU },
    { kind: "cap", key: "maxConnections", perUnit: 20 },
  ],
  "opensource.mysql": [
    { kind: "scale", key: "cpu", values: VCPU },
    { kind: "cap", key: "maxConnections", perUnit: 20 },
  ],

  "opensource.redis": [
    { kind: "scale", key: "memory", values: REDIS_MEMORY },
    // Persistência custa vazão: cada escrita passa por disco.
    { kind: "toggle", key: "persistence", on: 0.85, off: 1 },
  ],
  "aws.elasticache": [
    { kind: "scale", key: "nodeType", values: CACHE_NODE },
    { kind: "linear", key: "nodes", baseline: 1 },
  ],

  "opensource.traefik": [{ kind: "linear", key: "replicas", baseline: 2 }],
  "opensource.nginx": [{ kind: "linear", key: "replicas", baseline: 2 }],

  "opensource.rabbitmq": [{ kind: "linear", key: "nodes", baseline: 3 }],
  "opensource.nats": [{ kind: "linear", key: "cluster", baseline: 3 }],
  "opensource.kafka": [{ kind: "linear", key: "brokers", baseline: 3 }],

  "opensource.opentelemetry": [{ kind: "linear", key: "replicas", baseline: 2 }],
};

/** O que faz a conta subir. Nem sempre é o que dá capacidade. */
export const COST_MODEL: Record<string, Factor[]> = {
  "aws.ec2": [
    { kind: "scale", key: "instanceType", values: EC2_INSTANCE },
    { kind: "linear", key: "instances", baseline: 2 },
  ],
  // Paga-se pelas tarefas em execução, não pelo teto do autoscaling.
  "aws.ecs": [
    { kind: "scale", key: "cpu", values: VCPU },
    { kind: "linear", key: "desiredReplicas", baseline: 2 },
  ],
  "aws.lambda": [{ kind: "linear", key: "concurrency", baseline: 100 }],
  "opensource.docker": [{ kind: "linear", key: "replicas", baseline: 1 }],
  "opensource.kubernetes": [{ kind: "linear", key: "replicas", baseline: 3 }],

  "aws.s3": [],
  "opensource.minio": [
    { kind: "linear", key: "nodes", baseline: 4 },
    { kind: "linear", key: "diskGb", baseline: 500 },
  ],

  "aws.rds": [
    { kind: "scale", key: "instanceClass", values: RDS_INSTANCE },
    { kind: "linear", key: "storageGb", baseline: 100 },
    // Multi-AZ mantém uma réplica em espera: dobra a conta, não a vazão.
    { kind: "toggle", key: "multiAz", on: 2, off: 1 },
  ],
  "opensource.postgresql": [{ kind: "scale", key: "cpu", values: VCPU }],
  "opensource.mysql": [{ kind: "scale", key: "cpu", values: VCPU }],

  "opensource.redis": [{ kind: "scale", key: "memory", values: REDIS_MEMORY }],
  "aws.elasticache": [
    { kind: "scale", key: "nodeType", values: CACHE_NODE },
    { kind: "linear", key: "nodes", baseline: 1 },
    { kind: "toggle", key: "multiAz", on: 2, off: 1 },
  ],

  "opensource.traefik": [{ kind: "linear", key: "replicas", baseline: 2 }],
  "opensource.nginx": [{ kind: "linear", key: "replicas", baseline: 2 }],

  "opensource.rabbitmq": [{ kind: "linear", key: "nodes", baseline: 3 }],
  "opensource.nats": [{ kind: "linear", key: "cluster", baseline: 3 }],
  "opensource.kafka": [{ kind: "linear", key: "brokers", baseline: 3 }],

  "opensource.prometheus": [{ kind: "linear", key: "storageGb", baseline: 100 }],
  "opensource.opentelemetry": [{ kind: "linear", key: "replicas", baseline: 2 }],
};

/** Capacidade em req/s do recurso **como está configurado**. */
export function capacityFor(item: CatalogItem, props: Props): number {
  return apply(item.capacityRps, CAPACITY_MODEL[item.type] ?? [], props);
}

/** Custo mensal em USD do recurso **como está configurado**. */
export function monthlyCostFor(item: CatalogItem, props: Props): number {
  return apply(item.monthlyCostUsd, COST_MODEL[item.type] ?? [], props);
}
