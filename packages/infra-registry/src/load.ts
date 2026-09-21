import { resolve, type Factor, type Props } from "./capacity.ts";
import type { CatalogItem } from "./types.ts";

/**
 * Como cada recurso se comporta sob carga.
 *
 * Duas grandezas, por recurso:
 *
 * - **tempo de serviço** — quanto o recurso demora para atender *uma* requisição
 *   quando não há fila. É o `S` da teoria de filas; o motor de análise deriva a
 *   latência sob carga a partir dele, em vez de uma curva ajustada à mão.
 * - **taxa de acerto de cache** — a fração do tráfego que o recurso **absorve**.
 *   Sem isso, um CDN com 72% de acerto ainda entregaria 100% da carga à origem,
 *   que é como o motor se comportava antes.
 *
 * Os valores são estimativas de ordem de grandeza para configurações típicas,
 * não medições. Medição real só com o k6 do Milestone 8 (§77) e a
 * Observabilidade do Milestone 9 (§78) — e aí estes números viram o ponto de
 * partida que a medição corrige.
 */

export interface LoadCharacteristics {
  /** Tempo de serviço em ms, sem fila, na configuração padrão. */
  serviceTimeMs: number;
  /** Fatores que mudam o tempo de serviço conforme a configuração. */
  serviceTimeFactors?: Factor[];
  /**
   * Fração do tráfego que o recurso responde sozinho, sem acionar quem está
   * atrás dele. Zero quando o recurso não guarda cache.
   */
  cacheHitRatio?: number;
  cacheHitFactors?: Factor[];
}

/**
 * Tempos de serviço típicos. Referências:
 * rede e balanceadores na casa de 1–3ms; lógica de aplicação dominando em
 * dezenas de ms; consulta a banco indexado em torno de 10ms; cache em memória
 * abaixo de 1ms; armazenamento de objetos em dezenas de ms.
 */
export const LOAD_MODEL: Record<string, LoadCharacteristics> = {
  // --- rede: o recurso quase não custa tempo, só encaminha ---
  "aws.cloudfront": {
    serviceTimeMs: 8,
    // Só o que **não** está em cache segue para a origem.
    cacheHitRatio: 0.72,
    cacheHitFactors: [
      {
        kind: "scale",
        key: "cachePolicy",
        values: { CachingOptimized: 1, CachingDisabled: 0, Custom: 0.6 },
      },
    ],
  },
  "aws.alb": { serviceTimeMs: 2 },
  "aws.nlb": { serviceTimeMs: 1 },
  "opensource.traefik": { serviceTimeMs: 2 },
  "opensource.nginx": { serviceTimeMs: 1.5 },

  // --- compute: onde mora a lógica, e portanto o tempo ---
  "aws.ecs": {
    serviceTimeMs: 35,
    // Mais vCPU por tarefa encurta o processamento.
    serviceTimeFactors: [
      {
        kind: "scale",
        key: "cpu",
        values: { "0.5 vCPU": 2.6, "1 vCPU": 1.6, "2 vCPU": 1, "4 vCPU": 0.7, "8 vCPU": 0.55 },
      },
    ],
  },
  "aws.ec2": {
    serviceTimeMs: 35,
    serviceTimeFactors: [
      {
        kind: "scale",
        key: "instanceType",
        values: {
          "t3.small": 1.7,
          "t3.medium": 1,
          "t3.large": 0.75,
          "m6i.large": 0.65,
          "c6i.xlarge": 0.45,
        },
      },
    ],
  },
  // Inclui a parcela amortizada de cold start.
  "aws.lambda": { serviceTimeMs: 45 },
  "opensource.docker": { serviceTimeMs: 35 },
  "opensource.kubernetes": { serviceTimeMs: 35 },

  // --- banco: consulta indexada ---
  "aws.rds": {
    serviceTimeMs: 12,
    serviceTimeFactors: [
      {
        kind: "scale",
        key: "instanceClass",
        values: {
          "db.t3.small": 1.8,
          "db.t3.medium": 1,
          "db.m6g.large": 0.65,
          "db.m6g.xlarge": 0.5,
          "db.r6g.xlarge": 0.45,
        },
      },
    ],
  },
  "opensource.postgresql": { serviceTimeMs: 10 },
  "opensource.mysql": { serviceTimeMs: 10 },

  // --- cache em memória ---
  "opensource.redis": {
    serviceTimeMs: 0.6,
    // Persistência coloca disco no caminho da escrita.
    serviceTimeFactors: [{ kind: "toggle", key: "persistence", on: 1.6, off: 1 }],
  },
  "aws.elasticache": { serviceTimeMs: 0.8 },

  // --- armazenamento ---
  "aws.s3": { serviceTimeMs: 25 },
  "opensource.minio": { serviceTimeMs: 15 },

  // --- mensageria: o custo é o enfileiramento, não a entrega ---
  "aws.sqs": { serviceTimeMs: 15 },
  "opensource.rabbitmq": { serviceTimeMs: 5 },
  "opensource.nats": { serviceTimeMs: 0.8 },
  "opensource.kafka": { serviceTimeMs: 6 },

  // --- observabilidade: fora do caminho da requisição ---
  "opensource.prometheus": { serviceTimeMs: 3 },
  "opensource.grafana": { serviceTimeMs: 20 },
  "aws.cloudwatch": { serviceTimeMs: 5 },
  "opensource.opentelemetry": { serviceTimeMs: 1 },

  // --- borda e rede: encaminham, quase não custam tempo ---
  "aws.apigateway": {
    serviceTimeMs: 12,
    serviceTimeFactors: [
      // O REST carrega mais etapas por requisição que o HTTP enxuto.
      { kind: "scale", key: "apiType", values: { HTTP: 1, REST: 1.8 } },
    ],
    // Com cache de resposta ligado, parte do tráfego nem chega à integração.
    cacheHitRatio: 0,
  },
  "aws.route53": { serviceTimeMs: 1 },
  "aws.natgateway": { serviceTimeMs: 1.5 },
  // Inspeção inline: barata, mas cresce com o número de grupos de regra.
  "aws.waf": {
    serviceTimeMs: 3,
    serviceTimeFactors: [{ kind: "linear", key: "managedRuleGroups", baseline: 2 }],
  },

  // --- compute gerenciado ---
  "aws.eks": { serviceTimeMs: 35 },
  "aws.fargate": {
    serviceTimeMs: 40,
    serviceTimeFactors: [
      { kind: "scale", key: "cpu", values: { "0.25 vCPU": 2.4, "0.5 vCPU": 1.6, "1 vCPU": 1, "2 vCPU": 0.7, "4 vCPU": 0.55 } },
    ],
  },
  /**
   * Máquina própria: o tempo sai do que ela tem. Mais vCPU atende mais rápido;
   * disco lento cobra o preço em cada requisição que toca o disco.
   */
  "onprem.machine": {
    serviceTimeMs: 30,
    serviceTimeFactors: [
      { kind: "scale", key: "vcpu", values: { 1: 2.6, 2: 1.7, 4: 1, 8: 0.7, 16: 0.55 } },
      { kind: "scale", key: "diskType", values: { NVMe: 1, SSD: 1.3, HDD: 3.2 } },
    ],
  },

  // --- dados ---
  "aws.dynamodb": { serviceTimeMs: 6 },
  "aws.aurora": {
    serviceTimeMs: 8,
    serviceTimeFactors: [
      { kind: "scale", key: "instanceClass", values: { "db.t4g.medium": 2.2, "db.r6g.large": 1, "db.r6g.xlarge": 0.72, "db.r6g.2xlarge": 0.6 } },
    ],
  },
  "aws.opensearch": { serviceTimeMs: 22 },
  "aws.efs": {
    serviceTimeMs: 12,
    serviceTimeFactors: [
      { kind: "scale", key: "throughputMode", values: { elastic: 1, bursting: 1.6, provisioned: 0.8 } },
    ],
  },
  // Segredo se lê uma vez e se guarda em memória; o custo real é a primeira vez.
  "aws.secretsmanager": { serviceTimeMs: 20 },

  // --- mensageria ---
  "aws.sns": { serviceTimeMs: 10 },
  "aws.eventbridge": { serviceTimeMs: 14 },
  "aws.kinesis": { serviceTimeMs: 8 },
};

/** Tempo de serviço em ms do recurso **como está configurado**. */
export function serviceTimeFor(item: CatalogItem, props: Props): number {
  const model = LOAD_MODEL[item.type];
  if (!model) return 10;
  return Math.max(0.05, resolve(model.serviceTimeMs, model.serviceTimeFactors ?? [], props));
}

/**
 * Fração do tráfego que o recurso responde sozinho. O restante segue para
 * quem está atrás dele.
 */
export function cacheHitRatioFor(item: CatalogItem, props: Props): number {
  const model = LOAD_MODEL[item.type];
  if (!model?.cacheHitRatio) return 0;
  return Math.min(0.99, Math.max(0, resolve(model.cacheHitRatio, model.cacheHitFactors ?? [], props)));
}
