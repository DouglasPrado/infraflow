import type { TofuFile } from "@infraflow/opentofu-generator";

/**
 * Compilação do grafo para infraestrutura (PRD §34, §74).
 *
 * A nuvem é o único alvo: o §75 mantém o `plan` sem apply automático, e a
 * capacidade sai do motor de análise, não de execução.
 */
export type CompileTarget = "aws";

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
