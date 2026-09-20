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

/**
 * O que o laboratório precisa saber depois do apply (PRD §76, §78).
 *
 * O nome do container é a ponte entre a métrica observada e o node do canvas:
 * sem ele, a coleta do §78 devolveria número sem dono.
 */
export interface DockerRuntime {
  network: string;
  containers: {
    nodeId: string;
    name: string;
    image: string;
    role: "app" | "proxy" | "database" | "cache" | "storage" | "queue";
    /** Porta em que o serviço escuta dentro da rede do laboratório. */
    port: number;
  }[];
  /** Recurso que recebe a carga e tem porta publicada. */
  entry?: { nodeId: string; port: number };
}

export interface CompiledStack {
  target: CompileTarget;
  files: TofuFile[];
  /** Ids dos nodes do canvas que viraram infraestrutura. */
  compiledNodeIds: string[];
  warnings: CompileWarning[];
  /** Presente apenas no alvo docker. */
  docker?: DockerRuntime;
}

/** Arquivo pronto para gravar no diretório de trabalho do worker. */
export interface EmittedFile {
  name: string;
  content: string;
}
