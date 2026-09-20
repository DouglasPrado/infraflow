import type { TofuFile } from "@infraflow/opentofu-generator";

/**
 * Compilação do grafo para infraestrutura (PRD §34, §74).
 *
 * O alvo faz parte do contrato: o mesmo canvas descreve tanto a infraestrutura
 * de nuvem quanto o laboratório efêmero do §76, e os dois saem do mesmo grafo.
 */
export type CompileTarget = "aws" | "docker";

/** O que o compiler não conseguiu traduzir — nunca silenciosamente. */
export interface CompileWarning {
  code: "unsupported-resource" | "requires-input" | "assumption";
  message: string;
  nodeId?: string;
  hint?: string;
}

export interface CompiledStack {
  target: CompileTarget;
  files: TofuFile[];
  /** Ids dos nodes do canvas que viraram infraestrutura. */
  compiledNodeIds: string[];
  warnings: CompileWarning[];
}

/** Arquivo pronto para gravar no diretório de trabalho do worker. */
export interface EmittedFile {
  name: string;
  content: string;
}
