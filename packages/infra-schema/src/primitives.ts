import { z } from "zod";

/**
 * Vocabulário compartilhado do grafo de infraestrutura.
 * Estes são os valores que a API, os workers e a web precisam concordar.
 */

/** PRD §43 — categorias do registry. */
export const CategorySchema = z.enum([
  "compute",
  "database",
  "cache",
  "storage",
  "network",
  "queue",
  "observability",
  "testing",
  "external",
  "generic",
]);
export type Category = z.infer<typeof CategorySchema>;

/** PRD §44 — origem do recurso. */
export const ProviderSchema = z.enum(["aws", "opensource"]);
export type Provider = z.infer<typeof ProviderSchema>;

/** PRD §13 — tipo de tráfego que a conexão carrega. */
export const EdgeKindSchema = z.enum(["HTTP", "TCP", "Database", "Queue", "Storage"]);
export type EdgeKind = z.infer<typeof EdgeKindSchema>;

/** PRD §18 — perfis de carga. */
export const LoadProfileTypeSchema = z.enum([
  "Smoke",
  "Constant",
  "Ramp",
  "Capacity",
  "Spike",
  "Stress",
  "Soak",
]);
export type LoadProfileType = z.infer<typeof LoadProfileTypeSchema>;

export const HttpMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);
export type HttpMethod = z.infer<typeof HttpMethodSchema>;

/**
 * Valor de propriedade de um recurso. Deliberadamente escalar: o que vai para o
 * compiler de OpenTofu (PRD §74) precisa ser serializável sem ambiguidade.
 */
export const PropertyValueSchema = z.union([z.string(), z.number(), z.boolean()]);
export type PropertyValue = z.infer<typeof PropertyValueSchema>;

export const PropertyBagSchema = z.record(z.string(), PropertyValueSchema);
export type PropertyBag = z.infer<typeof PropertyBagSchema>;

export const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});
export type Position = z.infer<typeof PositionSchema>;

/** Identificador estável de um elemento do canvas. */
export const IdSchema = z.string().min(1).max(128);
