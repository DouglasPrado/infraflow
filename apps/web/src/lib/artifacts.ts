import { compile, OPENTOFU_FILES, type CompileWarning } from "@infraflow/compiler";
import { REPORT_FILES } from "@infraflow/report-generator";
import { toDocument, type DocumentMeta } from "./document";
import type { InfraEdge, InfraNode } from "./types";

/**
 * O que o Export Panel lista (PRD §30).
 *
 * Dois grupos com origens distintas: os documentos do §73 e os arquivos de
 * OpenTofu do §34. O `kind` é o segmento da rota — o conteúdo de qualquer um
 * deles vem da API, gerado da versão gravada.
 */
export type ArtifactKind = "reports" | "opentofu";

export interface ArtifactGroup {
  kind: ArtifactKind;
  title: string;
  files: { name: string; description: string }[];
}

export const ARTIFACT_GROUPS: ArtifactGroup[] = [
  { kind: "reports", title: "Documentos", files: REPORT_FILES },
  { kind: "opentofu", title: "OpenTofu", files: OPENTOFU_FILES },
];

export function kindOf(file: string): ArtifactKind {
  return OPENTOFU_FILES.some((candidate) => candidate.name === file) ? "opentofu" : "reports";
}

export function describe(file: string): string | undefined {
  return ARTIFACT_GROUPS.flatMap((group) => group.files).find(
    (candidate) => candidate.name === file,
  )?.description;
}

/**
 * Avisos da compilação, calculados ao vivo a partir do canvas — mesma escolha
 * feita para a validação (§72): quem está desenhando precisa saber agora que o
 * CloudFront não é traduzido, não ao abrir o arquivo.
 */
export function compileWarnings(
  meta: DocumentMeta,
  nodes: InfraNode[],
  edges: InfraEdge[],
): CompileWarning[] {
  try {
    return compile(toDocument(meta, nodes, edges)).warnings;
  } catch {
    return [];
  }
}

export type { CompileWarning };
