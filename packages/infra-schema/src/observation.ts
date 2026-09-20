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
   * Acima de zero, a carga oferecida ficou abaixo da pedida: o limite
   * encontrado foi o da máquina que gera, não o da arquitetura. Sem este
   * número, um teste mal dimensionado passaria por resultado.
   */
  droppedIterations: z.number().int().nonnegative().default(0),
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
