import { type ArchitectureDocument } from "./graph.ts";
import type { Position } from "./primitives.ts";
/**
 * Ponte entre o canvas e o documento persistido (PRD §70 — serialization).
 *
 * Trabalha sobre uma forma **estrutural**, não sobre os tipos do React Flow: o
 * pacote de schema não pode depender de biblioteca de UI, e os nodes do React
 * Flow satisfazem esta forma naturalmente.
 */
export interface FlowNodeLike {
    id: string;
    type?: string;
    position: Position;
    data: Record<string, unknown>;
    parentId?: string;
    style?: {
        width?: number | string;
        height?: number | string;
    };
}
export interface FlowEdgeLike {
    id: string;
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
    data?: {
        kind?: unknown;
    } | undefined;
}
export interface DocumentMeta {
    name: string;
    provider: string;
    environment: string;
}
/**
 * Canvas → documento. Nodes de tipo desconhecido são descartados.
 *
 * O estado do canvas é entrada não confiável — vem da UI, com campos de
 * simulação misturados. Montamos a forma solta e deixamos o Zod ser o portão:
 * se o canvas produzir algo inválido, isto lança em vez de persistir lixo.
 */
export declare function fromFlow(meta: DocumentMeta, nodes: FlowNodeLike[], edges: FlowEdgeLike[]): ArchitectureDocument;
/**
 * Documento → canvas. Os grupos vêm primeiro: o React Flow exige que o pai
 * apareça antes dos filhos no array de nodes.
 */
export declare function toFlow(document: ArchitectureDocument): {
    nodes: FlowNodeLike[];
    edges: FlowEdgeLike[];
};
//# sourceMappingURL=flow.d.ts.map