import { z } from "zod";
/**
 * O documento do canvas (PRD §4.1, §71).
 *
 * Guarda **tudo** que o usuário desenhou, inclusive o que não é infraestrutura:
 * notas e grupos. É isto que a persistência do Milestone 2 grava.
 * O `architecture.json` do §33 é uma projeção disto — ver `architecture.ts`.
 */
/** Um recurso real de infraestrutura. */
export declare const ResourceNodeSchema: z.ZodObject<{
    kind: z.ZodLiteral<"resource">;
    id: z.ZodString;
    type: z.ZodString;
    name: z.ZodString;
    position: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, z.core.$strip>;
    properties: z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>;
    parentId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type ResourceNode = z.infer<typeof ResourceNodeSchema>;
/** PRD §17 — endpoint do workload. */
export declare const WorkloadEndpointSchema: z.ZodObject<{
    id: z.ZodString;
    method: z.ZodEnum<{
        GET: "GET";
        POST: "POST";
        PUT: "PUT";
        PATCH: "PATCH";
        DELETE: "DELETE";
    }>;
    path: z.ZodString;
    weight: z.ZodNumber;
}, z.core.$strip>;
export type WorkloadEndpoint = z.infer<typeof WorkloadEndpointSchema>;
/** PRD §16 — alvo do teste. */
export declare const LoadTargetSchema: z.ZodObject<{
    protocol: z.ZodString;
    baseUrl: z.ZodString;
    headers: z.ZodString;
    authentication: z.ZodString;
    timeoutMs: z.ZodNumber;
}, z.core.$strip>;
/** PRD §18 — perfil de carga. */
export declare const LoadProfileSchema: z.ZodObject<{
    type: z.ZodEnum<{
        Smoke: "Smoke";
        Constant: "Constant";
        Ramp: "Ramp";
        Capacity: "Capacity";
        Spike: "Spike";
        Stress: "Stress";
        Soak: "Soak";
    }>;
    startRps: z.ZodNumber;
    incrementRps: z.ZodNumber;
    intervalSeconds: z.ZodNumber;
    maxRps: z.ZodNumber;
}, z.core.$strip>;
/** PRD §19 — critérios de aprovação do teste. */
export declare const SloSchema: z.ZodObject<{
    p95Ms: z.ZodNumber;
    p99Ms: z.ZodNumber;
    errorRatePct: z.ZodNumber;
}, z.core.$strip>;
/** PRD §15 — node especial que origina a carga. */
export declare const LoadGeneratorNodeSchema: z.ZodObject<{
    kind: z.ZodLiteral<"loadGenerator">;
    id: z.ZodString;
    name: z.ZodString;
    position: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, z.core.$strip>;
    target: z.ZodObject<{
        protocol: z.ZodString;
        baseUrl: z.ZodString;
        headers: z.ZodString;
        authentication: z.ZodString;
        timeoutMs: z.ZodNumber;
    }, z.core.$strip>;
    endpoints: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        method: z.ZodEnum<{
            GET: "GET";
            POST: "POST";
            PUT: "PUT";
            PATCH: "PATCH";
            DELETE: "DELETE";
        }>;
        path: z.ZodString;
        weight: z.ZodNumber;
    }, z.core.$strip>>;
    profile: z.ZodObject<{
        type: z.ZodEnum<{
            Smoke: "Smoke";
            Constant: "Constant";
            Ramp: "Ramp";
            Capacity: "Capacity";
            Spike: "Spike";
            Stress: "Stress";
            Soak: "Soak";
        }>;
        startRps: z.ZodNumber;
        incrementRps: z.ZodNumber;
        intervalSeconds: z.ZodNumber;
        maxRps: z.ZodNumber;
    }, z.core.$strip>;
    slo: z.ZodObject<{
        p95Ms: z.ZodNumber;
        p99Ms: z.ZodNumber;
        errorRatePct: z.ZodNumber;
    }, z.core.$strip>;
}, z.core.$strip>;
export type LoadGeneratorNode = z.infer<typeof LoadGeneratorNodeSchema>;
/** PRD §27 — anotação, não executável. */
export declare const NoteNodeSchema: z.ZodObject<{
    kind: z.ZodLiteral<"note">;
    id: z.ZodString;
    variant: z.ZodEnum<{
        sticky: "sticky";
        text: "text";
    }>;
    text: z.ZodString;
    position: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, z.core.$strip>;
    width: z.ZodOptional<z.ZodNumber>;
    height: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type NoteNode = z.infer<typeof NoteNodeSchema>;
/** PRD §28 — container visual. */
export declare const GroupNodeSchema: z.ZodObject<{
    kind: z.ZodLiteral<"group">;
    id: z.ZodString;
    label: z.ZodString;
    position: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, z.core.$strip>;
    width: z.ZodNumber;
    height: z.ZodNumber;
}, z.core.$strip>;
export type GroupNode = z.infer<typeof GroupNodeSchema>;
export declare const CanvasNodeSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"resource">;
    id: z.ZodString;
    type: z.ZodString;
    name: z.ZodString;
    position: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, z.core.$strip>;
    properties: z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>;
    parentId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"loadGenerator">;
    id: z.ZodString;
    name: z.ZodString;
    position: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, z.core.$strip>;
    target: z.ZodObject<{
        protocol: z.ZodString;
        baseUrl: z.ZodString;
        headers: z.ZodString;
        authentication: z.ZodString;
        timeoutMs: z.ZodNumber;
    }, z.core.$strip>;
    endpoints: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        method: z.ZodEnum<{
            GET: "GET";
            POST: "POST";
            PUT: "PUT";
            PATCH: "PATCH";
            DELETE: "DELETE";
        }>;
        path: z.ZodString;
        weight: z.ZodNumber;
    }, z.core.$strip>>;
    profile: z.ZodObject<{
        type: z.ZodEnum<{
            Smoke: "Smoke";
            Constant: "Constant";
            Ramp: "Ramp";
            Capacity: "Capacity";
            Spike: "Spike";
            Stress: "Stress";
            Soak: "Soak";
        }>;
        startRps: z.ZodNumber;
        incrementRps: z.ZodNumber;
        intervalSeconds: z.ZodNumber;
        maxRps: z.ZodNumber;
    }, z.core.$strip>;
    slo: z.ZodObject<{
        p95Ms: z.ZodNumber;
        p99Ms: z.ZodNumber;
        errorRatePct: z.ZodNumber;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"note">;
    id: z.ZodString;
    variant: z.ZodEnum<{
        sticky: "sticky";
        text: "text";
    }>;
    text: z.ZodString;
    position: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, z.core.$strip>;
    width: z.ZodOptional<z.ZodNumber>;
    height: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"group">;
    id: z.ZodString;
    label: z.ZodString;
    position: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, z.core.$strip>;
    width: z.ZodNumber;
    height: z.ZodNumber;
}, z.core.$strip>], "kind">;
export type CanvasNode = z.infer<typeof CanvasNodeSchema>;
export declare const CanvasEdgeSchema: z.ZodObject<{
    id: z.ZodString;
    source: z.ZodString;
    target: z.ZodString;
    sourceHandle: z.ZodOptional<z.ZodString>;
    targetHandle: z.ZodOptional<z.ZodString>;
    kind: z.ZodEnum<{
        HTTP: "HTTP";
        TCP: "TCP";
        Database: "Database";
        Queue: "Queue";
        Storage: "Storage";
    }>;
}, z.core.$strip>;
export type CanvasEdge = z.infer<typeof CanvasEdgeSchema>;
/** Versão do formato do documento. Subir sempre que a forma mudar. */
export declare const DOCUMENT_VERSION = 1;
export declare const ArchitectureDocumentSchema: z.ZodObject<{
    version: z.ZodLiteral<1>;
    name: z.ZodString;
    provider: z.ZodString;
    environment: z.ZodString;
    nodes: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"resource">;
        id: z.ZodString;
        type: z.ZodString;
        name: z.ZodString;
        position: z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
        }, z.core.$strip>;
        properties: z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>;
        parentId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"loadGenerator">;
        id: z.ZodString;
        name: z.ZodString;
        position: z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
        }, z.core.$strip>;
        target: z.ZodObject<{
            protocol: z.ZodString;
            baseUrl: z.ZodString;
            headers: z.ZodString;
            authentication: z.ZodString;
            timeoutMs: z.ZodNumber;
        }, z.core.$strip>;
        endpoints: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            method: z.ZodEnum<{
                GET: "GET";
                POST: "POST";
                PUT: "PUT";
                PATCH: "PATCH";
                DELETE: "DELETE";
            }>;
            path: z.ZodString;
            weight: z.ZodNumber;
        }, z.core.$strip>>;
        profile: z.ZodObject<{
            type: z.ZodEnum<{
                Smoke: "Smoke";
                Constant: "Constant";
                Ramp: "Ramp";
                Capacity: "Capacity";
                Spike: "Spike";
                Stress: "Stress";
                Soak: "Soak";
            }>;
            startRps: z.ZodNumber;
            incrementRps: z.ZodNumber;
            intervalSeconds: z.ZodNumber;
            maxRps: z.ZodNumber;
        }, z.core.$strip>;
        slo: z.ZodObject<{
            p95Ms: z.ZodNumber;
            p99Ms: z.ZodNumber;
            errorRatePct: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"note">;
        id: z.ZodString;
        variant: z.ZodEnum<{
            sticky: "sticky";
            text: "text";
        }>;
        text: z.ZodString;
        position: z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
        }, z.core.$strip>;
        width: z.ZodOptional<z.ZodNumber>;
        height: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"group">;
        id: z.ZodString;
        label: z.ZodString;
        position: z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
        }, z.core.$strip>;
        width: z.ZodNumber;
        height: z.ZodNumber;
    }, z.core.$strip>], "kind">>;
    edges: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        source: z.ZodString;
        target: z.ZodString;
        sourceHandle: z.ZodOptional<z.ZodString>;
        targetHandle: z.ZodOptional<z.ZodString>;
        kind: z.ZodEnum<{
            HTTP: "HTTP";
            TCP: "TCP";
            Database: "Database";
            Queue: "Queue";
            Storage: "Storage";
        }>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type ArchitectureDocument = z.infer<typeof ArchitectureDocumentSchema>;
export declare function isResourceNode(node: CanvasNode): node is ResourceNode;
export declare function isLoadGeneratorNode(node: CanvasNode): node is LoadGeneratorNode;
//# sourceMappingURL=graph.d.ts.map