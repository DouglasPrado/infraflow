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

/** Multiplicadores e tetos de um conjunto de fatores, sem arredondar. */
export function resolve(base: number, factors: Factor[], props: Props): number {
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

  return Math.min(base * multiplier, ceiling);
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

const EKS_NODE: Record<string, number> = {
  "t3.large": 0.8,
  "m6i.large": 1,
  "m6i.xlarge": 1.9,
  "c6i.2xlarge": 3.6,
};

/** O Fargate oferece 0.25 vCPU, que a escala compartilhada não tem. */
const FARGATE_CPU: Record<string, number> = {
  "0.25 vCPU": 0.28,
  "0.5 vCPU": 0.55,
  "1 vCPU": 1,
  "2 vCPU": 1.9,
  "4 vCPU": 3.5,
};

const AURORA_INSTANCE: Record<string, number> = {
  "db.t4g.medium": 0.4,
  "db.r6g.large": 1,
  "db.r6g.xlarge": 1.9,
  "db.r6g.2xlarge": 3.6,
};

const SEARCH_INSTANCE: Record<string, number> = {
  "t3.small.search": 0.25,
  "r6g.large.search": 1,
  "r6g.xlarge.search": 1.9,
  "r6g.2xlarge.search": 3.7,
};

/** Disco da máquina própria: o tipo muda o que ela sustenta. */
const DISK_TYPE: Record<string, number> = {
  NVMe: 1,
  SSD: 0.85,
  HDD: 0.45,
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

  "aws.eks": [
    { kind: "scale", key: "nodeInstanceType", values: EKS_NODE },
    { kind: "autoscale", toggleKey: "autoScaling", onKey: "maxNodes", offKey: "nodes", baseline: 10 },
  ],
  "aws.fargate": [
    { kind: "scale", key: "cpu", values: FARGATE_CPU },
    { kind: "linear", key: "tasks", baseline: 2 },
  ],
  /**
   * A máquina própria não tem catálogo de instância: a capacidade sai das
   * specs. vCPU multiplica, o tipo de disco pesa, e a memória é **teto** — foi
   * a forma de dizer que subir vCPU sem subir RAM não compra vazão nenhuma.
   */
  "onprem.machine": [
    { kind: "linear", key: "vcpu", baseline: 4 },
    { kind: "scale", key: "diskType", values: DISK_TYPE },
    { kind: "cap", key: "memoryGb", perUnit: 250 },
  ],

  "aws.efs": [
    { kind: "scale", key: "performanceMode", values: { generalPurpose: 1, maxIO: 2.2 } },
    { kind: "scale", key: "throughputMode", values: { elastic: 1, bursting: 0.6, provisioned: 1.4 } },
  ],

  "aws.dynamodb": [
    // Provisionado tem teto; sob demanda a tabela acompanha a carga.
    { kind: "scale", key: "billingMode", values: { "On-demand": 1, Provisioned: 1 } },
    { kind: "cap", key: "readCapacity", perUnit: 480 },
  ],
  "aws.aurora": [{ kind: "scale", key: "instanceClass", values: AURORA_INSTANCE }],
  "aws.opensearch": [
    { kind: "scale", key: "instanceType", values: SEARCH_INSTANCE },
    { kind: "linear", key: "nodes", baseline: 3 },
  ],

  "aws.apigateway": [
    { kind: "scale", key: "apiType", values: { HTTP: 1, REST: 0.7 } },
    // O throttle configurado é o teto declarado, não uma sugestão.
    { kind: "cap", key: "throttleRps", perUnit: 1 },
  ],
  "aws.natgateway": [{ kind: "linear", key: "azs", baseline: 1 }],

  // FIFO troca vazão por ordem: a AWS limita o tópico ordenado a 300 msg/s.
  "aws.sns": [{ kind: "toggle", key: "fifo", on: 0.35, off: 1 }],
  "aws.kinesis": [{ kind: "linear", key: "shards", baseline: 2 }],

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

  "aws.eks": [
    { kind: "scale", key: "nodeInstanceType", values: EKS_NODE },
    // Paga-se pelos nodes de pé, não pelo teto que o autoscaler pode alcançar.
    { kind: "linear", key: "nodes", baseline: 3 },
  ],
  "aws.fargate": [
    { kind: "scale", key: "cpu", values: FARGATE_CPU },
    { kind: "linear", key: "tasks", baseline: 2 },
    // Spot é capacidade interrompível, cobrada a uma fração do preço.
    { kind: "toggle", key: "spot", on: 0.3, off: 1 },
  ],
  /** A máquina é sua: o custo é o que você informa, não uma tabela. */
  "onprem.machine": [{ kind: "linear", key: "monthlyCostUsd", baseline: 180 }],

  "aws.efs": [
    // Sem o ciclo de vida para IA, tudo permanece na classe cara.
    { kind: "toggle", key: "lifecycleToIa", on: 1, off: 1.35 },
    { kind: "scale", key: "throughputMode", values: { elastic: 1, bursting: 0.7, provisioned: 1.8 } },
  ],
  "aws.secretsmanager": [{ kind: "linear", key: "secrets", baseline: 10 }],

  "aws.dynamodb": [
    { kind: "linear", key: "readCapacity", baseline: 25 },
    // Tabela global replica escrita em cada região: a conta acompanha.
    { kind: "toggle", key: "globalTables", on: 2.1, off: 1 },
    { kind: "toggle", key: "pointInTimeRecovery", on: 1, off: 0.8 },
  ],
  "aws.aurora": [
    { kind: "scale", key: "instanceClass", values: AURORA_INSTANCE },
    { kind: "linear", key: "storageGb", baseline: 100 },
    { kind: "toggle", key: "multiAz", on: 1, off: 0.6 },
  ],
  "aws.opensearch": [
    { kind: "scale", key: "instanceType", values: SEARCH_INSTANCE },
    { kind: "linear", key: "nodes", baseline: 3 },
    { kind: "linear", key: "storageGb", baseline: 100 },
  ],

  // REST cobra por milhão de chamadas várias vezes o que o HTTP cobra.
  "aws.apigateway": [
    { kind: "scale", key: "apiType", values: { HTTP: 1, REST: 3.5 } },
    { kind: "toggle", key: "caching", on: 2.2, off: 1 },
  ],
  "aws.route53": [
    { kind: "linear", key: "records", baseline: 10 },
    { kind: "toggle", key: "healthCheck", on: 1.6, off: 1 },
  ],
  // Cada zona ganha o seu: é gateway por AZ, cobrado por hora e por AZ.
  "aws.natgateway": [{ kind: "linear", key: "azs", baseline: 1 }],
  "aws.waf": [{ kind: "linear", key: "managedRuleGroups", baseline: 2 }],

  "aws.sns": [{ kind: "linear", key: "subscriptions", baseline: 3 }],
  "aws.eventbridge": [
    { kind: "linear", key: "rules", baseline: 5 },
    { kind: "toggle", key: "archive", on: 1.4, off: 1 },
  ],
  "aws.kinesis": [
    { kind: "linear", key: "shards", baseline: 2 },
    { kind: "toggle", key: "enhancedFanout", on: 1.5, off: 1 },
  ],

  "opensource.prometheus": [{ kind: "linear", key: "storageGb", baseline: 100 }],
  "opensource.opentelemetry": [{ kind: "linear", key: "replicas", baseline: 2 }],
};

/** Capacidade em req/s do recurso **como está configurado**. */
export function capacityFor(item: CatalogItem, props: Props): number {
  return Math.max(1, Math.round(resolve(item.capacityRps, CAPACITY_MODEL[item.type] ?? [], props)));
}

/** Custo mensal em USD do recurso **como está configurado**. */
export function monthlyCostFor(item: CatalogItem, props: Props): number {
  return Math.max(1, Math.round(resolve(item.monthlyCostUsd, COST_MODEL[item.type] ?? [], props)));
}
