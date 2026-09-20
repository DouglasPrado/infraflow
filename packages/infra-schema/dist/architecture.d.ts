import { z } from "zod";
import { type ArchitectureDocument } from "./graph.ts";
/**
 * `architecture.json` — a fonte estruturada para automação (PRD §33).
 *
 * Tem **prioridade sobre os documentos gerados**, então carrega só o que é
 * infraestrutura: notas e grupos ficam de fora. É uma projeção do documento do
 * canvas, nunca uma segunda fonte de verdade.
 */
export declare const ARCHITECTURE_JSON_VERSION = 1;
export declare const ArchitectureJsonNodeSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodString;
    name: z.ZodString;
    properties: z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>;
}, z.core.$strip>;
export declare const ArchitectureJsonEdgeSchema: z.ZodObject<{
    id: z.ZodString;
    kind: z.ZodEnum<{
        HTTP: "HTTP";
        TCP: "TCP";
        Database: "Database";
        Queue: "Queue";
        Storage: "Storage";
    }>;
    target: z.ZodString;
    source: z.ZodString;
}, z.core.$strip>;
export declare const ArchitectureJsonLoadTestSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
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
    targets: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export declare const ArchitectureJsonSchema: z.ZodObject<{
    version: z.ZodLiteral<1>;
    nodes: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        type: z.ZodString;
        name: z.ZodString;
        properties: z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>;
    }, z.core.$strip>>;
    edges: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        kind: z.ZodEnum<{
            HTTP: "HTTP";
            TCP: "TCP";
            Database: "Database";
            Queue: "Queue";
            Storage: "Storage";
        }>;
        target: z.ZodString;
        source: z.ZodString;
    }, z.core.$strip>>;
    loadTests: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
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
        targets: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>;
    environments: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type ArchitectureJson = z.infer<typeof ArchitectureJsonSchema>;
/**
 * Recursos alcançáveis a partir de uma origem, seguindo os edges no sentido
 * origem → destino. É o mesmo percurso que decide quem recebe carga (PRD §21).
 */
export declare function reachableFrom(document: ArchitectureDocument, originId: string): string[];
/** PRD §33 — projeta o documento do canvas no contrato de automação. */
export declare function toArchitectureJson(document: ArchitectureDocument): ArchitectureJson;
/** Problema estrutural encontrado no documento. */
export interface IntegrityIssue {
    code: "unknown-edge-endpoint" | "duplicate-id" | "unknown-parent" | "parent-not-group" | "self-edge";
    message: string;
    subjectId: string;
}
/**
 * Integridade referencial do documento — não julga a arquitetura.
 * As regras de arquitetura (conexão inválida, dependência faltando, problema de
 * segurança) são o Architecture Validator do Milestone 3 (PRD §72).
 */
export declare function validateIntegrity(document: ArchitectureDocument): IntegrityIssue[];
/** Desserializa e valida um documento vindo do disco, da API ou do banco. */
export declare function parseDocument(input: unknown): ArchitectureDocument;
export declare function safeParseDocument(input: unknown): z.ZodSafeParseResult<{
    version: 1;
    name: string;
    provider: string;
    environment: string;
    nodes: ({
        kind: "resource";
        id: string;
        type: string;
        name: string;
        position: {
            x: number;
            y: number;
        };
        properties: Record<string, string | number | boolean>;
        parentId?: string | undefined;
    } | {
        kind: "loadGenerator";
        id: string;
        name: string;
        position: {
            x: number;
            y: number;
        };
        target: {
            protocol: string;
            baseUrl: string;
            headers: string;
            authentication: string;
            timeoutMs: number;
        };
        endpoints: {
            id: string;
            method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
            path: string;
            weight: number;
        }[];
        profile: {
            type: "Smoke" | "Constant" | "Ramp" | "Capacity" | "Spike" | "Stress" | "Soak";
            startRps: number;
            incrementRps: number;
            intervalSeconds: number;
            maxRps: number;
        };
        slo: {
            p95Ms: number;
            p99Ms: number;
            errorRatePct: number;
        };
    } | {
        kind: "note";
        id: string;
        variant: "sticky" | "text";
        text: string;
        position: {
            x: number;
            y: number;
        };
        width?: number | undefined;
        height?: number | undefined;
    } | {
        kind: "group";
        id: string;
        label: string;
        position: {
            x: number;
            y: number;
        };
        width: number;
        height: number;
    })[];
    edges: {
        id: string;
        source: string;
        target: string;
        kind: "HTTP" | "TCP" | "Database" | "Queue" | "Storage";
        sourceHandle?: string | undefined;
        targetHandle?: string | undefined;
    }[];
}>;
/** Serializa de forma estável — o mesmo documento produz sempre o mesmo texto. */
export declare function serializeArchitectureJson(document: ArchitectureDocument): string;
//# sourceMappingURL=architecture.d.ts.map