import { z } from "zod";
import { IdSchema } from "./primitives.ts";

/**
 * Contrato entre a API e o worker (PRD §50, §51).
 *
 * A API enfileira; o worker executa. O payload carrega **só o id da execução**:
 * tudo o mais o worker lê do banco. Job que carrega o documento inteiro
 * envelhece na fila e passa a executar uma arquitetura que já mudou.
 */

export const RUN_QUEUE = "infraflow-runs";

export const RunJobSchema = z.object({ runId: z.uuid() });
export type RunJob = z.infer<typeof RunJobSchema>;

/** Alvo da compilação que a execução usa (PRD §74, §76). */
export const RunTargetSchema = z.enum(["aws", "docker"]);
export type RunTarget = z.infer<typeof RunTargetSchema>;

export const RunParamsSchema = z.object({ target: RunTargetSchema });
export type RunParams = z.infer<typeof RunParamsSchema>;

/** Ação que o OpenTofu planeja para um recurso. */
export const PlanActionSchema = z.enum(["create", "update", "delete", "replace", "read", "no-op"]);
export type PlanAction = z.infer<typeof PlanActionSchema>;

export const PlanChangeSchema = z.object({
  /** Endereço no state: `aws_db_instance.orders_db`. */
  address: z.string(),
  type: z.string(),
  name: z.string(),
  action: PlanActionSchema,
});

/** O que o `tofu plan` disse (PRD §75). */
export const PlanSummarySchema = z.object({
  target: RunTargetSchema,
  add: z.number().int().nonnegative(),
  change: z.number().int().nonnegative(),
  destroy: z.number().int().nonnegative(),
  changes: z.array(PlanChangeSchema),
  /** Avisos da compilação que geraram este plano (§74). */
  compileWarnings: z.array(
    z.object({ code: z.string(), message: z.string(), nodeId: z.string().optional(), hint: z.string().optional() }),
  ),
});
export type PlanSummary = z.infer<typeof PlanSummarySchema>;

/** Container do laboratório, ligado ao node que o originou (PRD §76, §78). */
export const LabContainerSchema = z.object({
  nodeId: IdSchema,
  name: z.string().min(1),
  image: z.string().min(1),
  role: z.enum(["app", "proxy", "database", "cache", "storage", "queue"]),
  port: z.number().int().positive(),
});
export type LabContainer = z.infer<typeof LabContainerSchema>;

/** Quanto custou até a arquitetura responder (PRD §76 — "Ready"). */
export const LabReadinessSchema = z.object({
  ready: z.boolean(),
  attempts: z.number().int().nonnegative(),
  lastStatus: z.number().int().optional(),
  lastError: z.string().optional(),
  waitedMs: z.number().nonnegative(),
});
export type LabReadiness = z.infer<typeof LabReadinessSchema>;

export const LabApplyResultSchema = z.object({
  entryUrl: z.string().min(1),
  containers: z.array(LabContainerSchema),
  readiness: LabReadinessSchema,
});
export type LabApplyResult = z.infer<typeof LabApplyResultSchema>;

/**
 * Identificador legível de uma execução ou ambiente (PRD §53).
 *
 * Usa `crypto.getRandomValues`, que existe no Node e no navegador: este pacote
 * é o vocabulário comum, e importar `node:crypto` aqui quebraria a web.
 */
export function slugFor(kind: string): string {
  const bytes = new Uint8Array(5);
  globalThis.crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return `${kind}-${suffix}`;
}
