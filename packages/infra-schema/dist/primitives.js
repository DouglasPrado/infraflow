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
/** PRD §44 — origem do recurso. */
export const ProviderSchema = z.enum(["aws", "opensource"]);
/** PRD §13 — tipo de tráfego que a conexão carrega. */
export const EdgeKindSchema = z.enum(["HTTP", "TCP", "Database", "Queue", "Storage"]);
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
export const HttpMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);
/**
 * Valor de propriedade de um recurso. Deliberadamente escalar: o que vai para o
 * compiler de OpenTofu (PRD §74) precisa ser serializável sem ambiguidade.
 */
export const PropertyValueSchema = z.union([z.string(), z.number(), z.boolean()]);
export const PropertyBagSchema = z.record(z.string(), PropertyValueSchema);
export const PositionSchema = z.object({
    x: z.number(),
    y: z.number(),
});
/** Identificador estável de um elemento do canvas. */
export const IdSchema = z.string().min(1).max(128);
//# sourceMappingURL=primitives.js.map