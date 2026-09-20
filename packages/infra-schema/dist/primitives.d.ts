import { z } from "zod";
/**
 * Vocabulário compartilhado do grafo de infraestrutura.
 * Estes são os valores que a API, os workers e a web precisam concordar.
 */
/** PRD §43 — categorias do registry. */
export declare const CategorySchema: z.ZodEnum<{
    compute: "compute";
    database: "database";
    cache: "cache";
    storage: "storage";
    network: "network";
    queue: "queue";
    observability: "observability";
    testing: "testing";
    external: "external";
    generic: "generic";
}>;
export type Category = z.infer<typeof CategorySchema>;
/** PRD §44 — origem do recurso. */
export declare const ProviderSchema: z.ZodEnum<{
    aws: "aws";
    opensource: "opensource";
}>;
export type Provider = z.infer<typeof ProviderSchema>;
/** PRD §13 — tipo de tráfego que a conexão carrega. */
export declare const EdgeKindSchema: z.ZodEnum<{
    HTTP: "HTTP";
    TCP: "TCP";
    Database: "Database";
    Queue: "Queue";
    Storage: "Storage";
}>;
export type EdgeKind = z.infer<typeof EdgeKindSchema>;
/** PRD §18 — perfis de carga. */
export declare const LoadProfileTypeSchema: z.ZodEnum<{
    Smoke: "Smoke";
    Constant: "Constant";
    Ramp: "Ramp";
    Capacity: "Capacity";
    Spike: "Spike";
    Stress: "Stress";
    Soak: "Soak";
}>;
export type LoadProfileType = z.infer<typeof LoadProfileTypeSchema>;
export declare const HttpMethodSchema: z.ZodEnum<{
    GET: "GET";
    POST: "POST";
    PUT: "PUT";
    PATCH: "PATCH";
    DELETE: "DELETE";
}>;
export type HttpMethod = z.infer<typeof HttpMethodSchema>;
/**
 * Valor de propriedade de um recurso. Deliberadamente escalar: o que vai para o
 * compiler de OpenTofu (PRD §74) precisa ser serializável sem ambiguidade.
 */
export declare const PropertyValueSchema: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>;
export type PropertyValue = z.infer<typeof PropertyValueSchema>;
export declare const PropertyBagSchema: z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>;
export type PropertyBag = z.infer<typeof PropertyBagSchema>;
export declare const PositionSchema: z.ZodObject<{
    x: z.ZodNumber;
    y: z.ZodNumber;
}, z.core.$strip>;
export type Position = z.infer<typeof PositionSchema>;
/** Identificador estável de um elemento do canvas. */
export declare const IdSchema: z.ZodString;
//# sourceMappingURL=primitives.d.ts.map