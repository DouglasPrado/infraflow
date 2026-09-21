import type { ArchitectureDocument } from "@infraflow/schema";

/**
 * Artefatos gerados a partir do canvas (PRD §30–§34, §73).
 *
 * Tudo é derivado do documento. Nenhum texto fixo descreve a arquitetura: se o
 * usuário trocar o banco, o ARCHITECTURE.md muda junto. É o que o §4.3 chama de
 * geração determinística — mesma entrada, mesma saída, byte a byte.
 */

export type ReportLanguage = "markdown" | "json";

export interface ReportFile {
  name: string;
  language: ReportLanguage;
  /** Uma linha: o que o arquivo responde. */
  description: string;
  content: string;
}

export interface ReportContext {
  document: ArchitectureDocument;
  /** Versão da arquitetura de onde o documento saiu (PRD §38). */
  version?: number;
  /** Congela a data nos testes; em produção, o instante da geração. */
  generatedAt?: Date;
}
