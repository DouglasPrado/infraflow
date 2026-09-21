import type { PropertyBag } from "@infraflow/schema";

/**
 * Do recurso do canvas para o SKU da AWS (PRD §40).
 *
 * A Price List API responde por filtro de atributo, não por "quanto custa um
 * RDS". Cada tipo do registry vira um ou mais pedidos, e o custo mensal é a
 * soma deles.
 *
 * **Nem tudo é precificável.** Serviço cobrado por uso — CloudFront por
 * transferência, SQS por mensagem, Lambda por invocação — não tem preço mensal
 * sem uma hipótese de volume, e o canvas não declara volume. Inventar essa
 * hipótese seria devolver palpite com cara de preço de tabela, que é
 * exatamente o que o §85 proíbe. Esses ficam de fora e a interface diz por quê.
 */

/** Horas de um mês comercial, como a própria AWS calcula a conta. */
export const HOURS_PER_MONTH = 730;

export interface SkuQuery {
  serviceCode: string;
  filters: Record<string, string>;
  /** Quantas unidades do preço unitário entram na conta mensal. */
  quantity: number;
  /** O que este pedido representa, para a interface detalhar. */
  label: string;
  /**
   * Trecho do `usagetype` que desempata quando vários SKUs casam com o filtro.
   *
   * Necessário porque os atributos não bastam: `memorytype=perGB` no ECS casa
   * tanto com Fargate quanto com ECS sobre EC2 — e o segundo custa zero, porque
   * lá se paga a instância. Sem desempate, a conta sairia com memória de graça.
   */
  usageTypeContains?: string;
  /**
   * Trechos que **desqualificam** um SKU.
   *
   * As tabelas da AWS trazem sobretaxas ao lado do preço base — suporte
   * estendido de engine, variantes Windows e ARM — e elas costumam vir antes na
   * resposta. Sem excluir, a conta sai com a sobretaxa no lugar do preço.
   */
  usageTypeExcludes?: string[];
}

export interface Priceable {
  queries: SkuQuery[];
}

export interface Unpriceable {
  /** Por que não dá para precificar este recurso. */
  reason: string;
}

export type SkuPlan = Priceable | Unpriceable;

export const isPriceable = (plan: SkuPlan): plan is Priceable => "queries" in plan;

const text = (props: PropertyBag, key: string, fallback = "") =>
  props[key] === undefined ? fallback : String(props[key]);

const count = (props: PropertyBag, key: string, fallback: number) => {
  const value = props[key];
  return typeof value === "number" ? value : fallback;
};

/** "2 vCPU" → 2; "4GB" → 4. */
const numeric = (value: string, fallback: number) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/** O rótulo do painel carrega engine e versão; a AWS quer os dois separados. */
function engineOf(label: string): string {
  if (/mysql/i.test(label)) return "MySQL";
  if (/maria/i.test(label)) return "MariaDB";
  return "PostgreSQL";
}

export function planFor(type: string, props: PropertyBag, region: string): SkuPlan {
  switch (type) {
    case "aws.ec2":
      return {
        queries: [
          {
            serviceCode: "AmazonEC2",
            label: `${count(props, "instances", 1)}× ${text(props, "instanceType", "t3.medium")}`,
            quantity: HOURS_PER_MONTH * count(props, "instances", 1),
            filters: {
              instanceType: text(props, "instanceType", "t3.medium"),
              regionCode: region,
              operatingSystem: "Linux",
              tenancy: "Shared",
              preInstalledSw: "NA",
              capacitystatus: "Used",
              licenseModel: "No License required",
            },
            usageTypeContains: "BoxUsage:",
            usageTypeExcludes: ["ExtendedSupport"],
          },
        ],
      };

    case "aws.ecs": {
      // Fargate cobra vCPU e memória separadamente, por hora.
      const replicas = props.autoScaling === true
        ? count(props, "minReplicas", count(props, "desiredReplicas", 1))
        : count(props, "desiredReplicas", 1);
      const vcpu = numeric(text(props, "cpu", "2 vCPU"), 2);
      const memory = numeric(text(props, "memory", "4GB"), 4);

      return {
        queries: [
          {
            serviceCode: "AmazonECS",
            label: `Fargate vCPU · ${replicas}× ${vcpu}`,
            quantity: HOURS_PER_MONTH * replicas * vcpu,
            filters: { regionCode: region, cputype: "perCPU" },
            usageTypeContains: "Fargate-vCPU-Hours",
          },
          {
            serviceCode: "AmazonECS",
            label: `Fargate memória · ${replicas}× ${memory}GB`,
            quantity: HOURS_PER_MONTH * replicas * memory,
            filters: { regionCode: region, memorytype: "perGB" },
            usageTypeContains: "Fargate-GB-Hours",
          },
        ],
      };
    }

    case "aws.rds": {
      const multiAz = props.multiAz === true;
      const deployment = multiAz ? "Multi-AZ" : "Single-AZ";

      return {
        queries: [
          {
            serviceCode: "AmazonRDS",
            label: `${text(props, "instanceClass", "db.t3.medium")} ${deployment}`,
            quantity: HOURS_PER_MONTH,
            filters: {
              instanceType: text(props, "instanceClass", "db.t3.medium"),
              databaseEngine: engineOf(text(props, "engine", "PostgreSQL 16")),
              deploymentOption: deployment,
              regionCode: region,
            },
            /**
             * Single-AZ usa `InstanceUsage:db.…`, Multi-AZ usa
             * `Multi-AZUsage:db.…`. O trecho comum cobre os dois sem precisar
             * de um marcador por modo.
             */
            usageTypeContains: "Usage:db.",
            usageTypeExcludes: ["ExtendedSupport"],
          },
          {
            serviceCode: "AmazonRDS",
            label: `${count(props, "storageGb", 20)}GB de armazenamento`,
            /**
             * Sem multiplicar por Multi-AZ: o SKU `RDS:Multi-AZ-GP2-Storage`
             * já cobra o dobro do Single-AZ (US$ 0,23 contra US$ 0,115).
             * Dobrar aqui cobraria a réplica duas vezes.
             */
            quantity: count(props, "storageGb", 20),
            filters: {
              regionCode: region,
              productFamily: "Database Storage",
              volumeType: "General Purpose",
              deploymentOption: deployment,
              databaseEngine: engineOf(text(props, "engine", "PostgreSQL 16")),
            },
            usageTypeContains: "Storage",
            usageTypeExcludes: ["ExtendedSupport", "IOPS", "Snapshot"],
          },
        ],
      };
    }

    case "aws.elasticache":
      return {
        queries: [
          {
            serviceCode: "AmazonElastiCache",
            label: `${count(props, "nodes", 1)}× ${text(props, "nodeType", "cache.t3.micro")}`,
            quantity: HOURS_PER_MONTH * count(props, "nodes", 1),
            filters: {
              instanceType: text(props, "nodeType", "cache.t3.micro"),
              regionCode: region,
              cacheEngine: "Redis",
            },
            usageTypeContains: "NodeUsage:",
            usageTypeExcludes: ["ExtendedSupport"],
          },
        ],
      };

    case "aws.alb":
      return {
        queries: [
          {
            serviceCode: "AWSELB",
            label: "Horas do balanceador",
            quantity: HOURS_PER_MONTH,
            filters: { regionCode: region, productFamily: "Load Balancer-Application" },
            usageTypeContains: "LoadBalancerUsage",
          },
        ],
      };

    case "aws.nlb":
      return {
        queries: [
          {
            serviceCode: "AWSELB",
            label: "Horas do balanceador",
            quantity: HOURS_PER_MONTH,
            filters: { regionCode: region, productFamily: "Load Balancer-Network" },
            usageTypeContains: "LoadBalancerUsage",
          },
        ],
      };

    case "aws.s3":
      return {
        reason:
          "O canvas não declara volume armazenado, e S3 é cobrado por GB-mês. Sem volume não há preço — só palpite.",
      };

    case "aws.cloudfront":
      return {
        reason:
          "CloudFront é cobrado por transferência e requisição. O canvas não declara tráfego mensal.",
      };

    case "aws.lambda":
      return {
        reason:
          "Lambda é cobrada por invocação e duração. O canvas declara concorrência, não volume de chamadas.",
      };

    case "aws.sqs":
      return { reason: "SQS é cobrada por mensagem. O canvas não declara volume." };

    case "aws.cloudwatch":
      return {
        reason: "CloudWatch é cobrada por métrica, log ingerido e alarme — nenhum deles declarado.",
      };

    default:
      return {
        reason: "Recurso fora da AWS: o custo é da infraestrutura que o hospeda, não de tabela.",
      };
  }
}
