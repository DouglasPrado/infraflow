import { z } from "zod";

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
