import { z } from "zod";
import { IdSchema } from "./primitives.ts";

/**
 * Vocabulário do que foi **medido** (PRD §37, §77, §78).
 *
 * Separado de propósito do que é estimado: `capacityRps` do registry é
 * declaração, isto aqui é leitura de instrumento. O §85 manda não confundir os
 * dois, e a única forma de não confundir é não deixá-los compartilhar tipo.
 *
 * Atravessa processo — worker grava, API devolve, web e relatório leem — então
 * vem com schema, não só com interface.
 */

/** Um degrau do teste de carga, como o k6 executou (PRD §18, §20). */
export const ObservedStageSchema = z.object({
  /** Carga pedida no degrau. */
  targetRps: z.number().nonnegative(),
  /** Carga que o alvo efetivamente sustentou. */
  rps: z.number().nonnegative(),
  p95Ms: z.number().nonnegative(),
  errorRatePct: z.number().min(0).max(100),
  /**
   * Janela do degrau.
   *
   * Sem ela não há como recortar as métricas do §78 no momento em que a
   * arquitetura cedeu — e correlacionar carga com recurso (§79) seria adivinhar.
   */
  startedAt: z.string(),
  endedAt: z.string(),
});
export type ObservedStage = z.infer<typeof ObservedStageSchema>;


/**
 * Métrica de um recurso durante a execução (PRD §37).
 * O `confidence` do §37 não vive aqui: amostra não tem confiança, conclusão tem.
 */
export const ResourceMetricSchema = z.object({
  /** Id do node no canvas — é o que devolve a métrica ao grafo (§36). */
  nodeId: IdSchema,
  /** `cpu`, `memory`, `network.rx`… */
  metric: z.string().min(1),
  unit: z.string(),
  value: z.number(),
  at: z.string(),
});
export type ResourceMetric = z.infer<typeof ResourceMetricSchema>;

/** Resultado agregado de uma execução real (PRD §77). */
export const LoadTestObservationSchema = z.object({
  startedAt: z.string(),
  finishedAt: z.string(),
  durationSeconds: z.number().nonnegative(),
  requests: z.number().int().nonnegative(),
  /** Vazão média sustentada durante a execução. */
  rps: z.number().nonnegative(),
  p50Ms: z.number().nonnegative(),
  p95Ms: z.number().nonnegative(),
  p99Ms: z.number().nonnegative(),
  errorRatePct: z.number().min(0).max(100),
  /** Se os critérios do §19 foram cumpridos — do próprio k6, via thresholds. */
  meetsSlo: z.boolean(),
  /**
   * Iterações que o gerador não conseguiu disparar.
   *
   * Acima de zero, a carga oferecida ficou abaixo da pedida. Quem ficou para
   * trás — o gerador ou a arquitetura — está em `loadCeiling`; o número sozinho
   * não distingue os dois.
   */
  droppedIterations: z.number().int().nonnegative().default(0),
  /**
   * De quem foi o teto que a execução encontrou.
   *
   * Um descarte acontece quando o executor quer disparar e não há VU livre. Isso
   * tem duas causas opostas, e confundi-las inverte a conclusão:
   *
   * - `architecture`: o alvo saturou, a latência inflou e os VUs ficaram presos
   *   esperando. **O resultado é conclusivo** — o platô medido é o teto real.
   * - `generator`: o alvo continuou saudável e o gerador é que não tinha fôlego.
   *   O resultado **subestima** a arquitetura e não serve de teto.
   * - `none`: tudo que foi pedido foi disparado.
   *
   * O veredito sai só de medição: latência e erro no pior degrau contra o
   * degrau mais calmo. Na dúvida responde `generator`, porque errar para esse
   * lado faz repetir o teste, e errar para o outro faz acreditar num teto falso.
   */
  loadCeiling: z.enum(["none", "architecture", "generator"]).default("none"),
  stages: z.array(ObservedStageSchema),
  /**
   * Métricas dos recursos durante a execução (PRD §78).
   *
   * Vêm do Prometheus do laboratório, já ligadas ao node do canvas. Vazio
   * significa que não houve coleta — nunca que o recurso ficou parado.
   */
  metrics: z.array(ResourceMetricSchema).default([]),
});
export type LoadTestObservation = z.infer<typeof LoadTestObservationSchema>;
