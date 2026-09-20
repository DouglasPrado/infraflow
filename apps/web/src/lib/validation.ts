import { summarize, validateArchitecture, type ValidationIssue } from "@infraflow/validator";
import { toDocument, type DocumentMeta } from "./document";
import type { InfraEdge, InfraNode } from "./types";

/**
 * Validação semântica do canvas (PRD §72).
 *
 * Roda no cliente, a cada edição: o usuário precisa saber que acabou de ligar o
 * banco direto na borda **enquanto** desenha, não quando abre um relatório. A
 * mesma função roda na API, sobre o documento gravado — é o mesmo pacote, então
 * as duas leituras nunca divergem.
 */
export type { ValidationIssue, ValidationSummary } from "@infraflow/validator";
export { summarize };

export function validateCanvas(
  meta: DocumentMeta,
  nodes: InfraNode[],
  edges: InfraEdge[],
): ValidationIssue[] {
  try {
    return validateArchitecture(toDocument(meta, nodes, edges));
  } catch {
    // Canvas em estado que o schema recusa. O autosave já reporta isso; aqui
    // não há documento para julgar.
    return [];
  }
}
