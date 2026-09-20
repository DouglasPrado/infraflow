import { z } from "zod";
import { EdgeKindSchema, HttpMethodSchema, IdSchema, LoadProfileTypeSchema, PositionSchema, PropertyBagSchema, } from "./primitives.js";
/**
 * O documento do canvas (PRD §4.1, §71).
 *
 * Guarda **tudo** que o usuário desenhou, inclusive o que não é infraestrutura:
 * notas e grupos. É isto que a persistência do Milestone 2 grava.
 * O `architecture.json` do §33 é uma projeção disto — ver `architecture.ts`.
 */
/** Um recurso real de infraestrutura. */
export const ResourceNodeSchema = z.object({
    kind: z.literal("resource"),
    id: IdSchema,
    /** Tipo do registry, no formato `provider.recurso` (PRD §44). */
    type: z.string().min(1),
    name: z.string().min(1).max(200),
    position: PositionSchema,
    properties: PropertyBagSchema,
    /** Grupo que contém este node (PRD §28). */
    parentId: IdSchema.optional(),
});
/** PRD §17 — endpoint do workload. */
export const WorkloadEndpointSchema = z.object({
    id: IdSchema,
    method: HttpMethodSchema,
    path: z.string().min(1),
    /** Fatia do tráfego, em porcento. */
    weight: z.number().min(0).max(100),
});
/** PRD §16 — alvo do teste. */
export const LoadTargetSchema = z.object({
    protocol: z.string().min(1),
    baseUrl: z.string().min(1),
    headers: z.string(),
    authentication: z.string(),
    timeoutMs: z.number().int().positive(),
});
/** PRD §18 — perfil de carga. */
export const LoadProfileSchema = z.object({
    type: LoadProfileTypeSchema,
    startRps: z.number().positive(),
    incrementRps: z.number().positive(),
    intervalSeconds: z.number().positive(),
    maxRps: z.number().positive(),
});
/** PRD §19 — critérios de aprovação do teste. */
export const SloSchema = z.object({
    p95Ms: z.number().positive(),
    p99Ms: z.number().positive(),
    errorRatePct: z.number().min(0).max(100),
});
/** PRD §15 — node especial que origina a carga. */
export const LoadGeneratorNodeSchema = z.object({
    kind: z.literal("loadGenerator"),
    id: IdSchema,
    name: z.string().min(1).max(200),
    position: PositionSchema,
    target: LoadTargetSchema,
    endpoints: z.array(WorkloadEndpointSchema),
    profile: LoadProfileSchema,
    slo: SloSchema,
});
/** PRD §27 — anotação, não executável. */
export const NoteNodeSchema = z.object({
    kind: z.literal("note"),
    id: IdSchema,
    variant: z.enum(["sticky", "text"]),
    text: z.string(),
    position: PositionSchema,
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
});
/** PRD §28 — container visual. */
export const GroupNodeSchema = z.object({
    kind: z.literal("group"),
    id: IdSchema,
    label: z.string().max(200),
    position: PositionSchema,
    width: z.number().positive(),
    height: z.number().positive(),
});
export const CanvasNodeSchema = z.discriminatedUnion("kind", [
    ResourceNodeSchema,
    LoadGeneratorNodeSchema,
    NoteNodeSchema,
    GroupNodeSchema,
]);
export const CanvasEdgeSchema = z.object({
    id: IdSchema,
    source: IdSchema,
    target: IdSchema,
    sourceHandle: z.string().optional(),
    targetHandle: z.string().optional(),
    kind: EdgeKindSchema,
});
/** Versão do formato do documento. Subir sempre que a forma mudar. */
export const DOCUMENT_VERSION = 1;
export const ArchitectureDocumentSchema = z.object({
    version: z.literal(DOCUMENT_VERSION),
    name: z.string().min(1).max(200),
    provider: z.string().min(1),
    environment: z.string().min(1),
    nodes: z.array(CanvasNodeSchema),
    edges: z.array(CanvasEdgeSchema),
});
export function isResourceNode(node) {
    return node.kind === "resource";
}
export function isLoadGeneratorNode(node) {
    return node.kind === "loadGenerator";
}
//# sourceMappingURL=graph.js.map