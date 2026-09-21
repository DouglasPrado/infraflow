import { printFile } from "@infraflow/opentofu-generator";
import type { ArchitectureDocument } from "@infraflow/schema";
import { awsTfvarsExample, compileAws } from "./aws/index.ts";
import { projectSlug } from "./names.ts";
import type { CompiledStack, EmittedFile } from "./types.ts";

export * from "./types.ts";
export * from "./names.ts";

/** Os arquivos do §34, na ordem em que fazem sentido ler. */
export const OPENTOFU_FILES: { name: string; description: string }[] = [
  { name: "providers.tf", description: "Provider e versão exigida" },
  { name: "main.tf", description: "Rede, recursos e regras vindas das conexões" },
  { name: "variables.tf", description: "Entradas da compilação" },
  { name: "outputs.tf", description: "Endereços publicados pela infraestrutura" },
  { name: "terraform.tfvars.example", description: "Valores de exemplo para o apply" },
];

export function isOpenTofuFile(name: string): boolean {
  return OPENTOFU_FILES.some((file) => file.name === name);
}

/**
 * Compila o grafo para infraestrutura (PRD §4.3, §74).
 *
 * Determinístico: o mesmo documento produz sempre os mesmos arquivos, byte a
 * byte. Não é preciosismo — o endereço do recurso é a chave do state, e saída
 * instável significa destruir e recriar infraestrutura a cada compilação.
 */
export function compile(document: ArchitectureDocument): CompiledStack {
  return compileAws(document);
}

/**
 * Valores que o próprio documento já responde.
 *
 * Sem isto o `plan` pararia pedindo `project` e `environment` no terminal —
 * dado que está no canvas desde o começo. O worker passa estes valores ao
 * OpenTofu; quem rodar os arquivos à mão usa o `terraform.tfvars.example`.
 */
export function defaultVariables(document: ArchitectureDocument): Record<string, string> {
  return { project: projectSlug(document.name), environment: document.environment };
}

/** Arquivos prontos para gravar no diretório de trabalho do worker. */
export function emit(document: ArchitectureDocument): {
  stack: CompiledStack;
  files: EmittedFile[];
} {
  const stack = compile(document);

  return {
    stack,
    files: [
      ...stack.files.map((file) => ({ name: file.name, content: printFile(file) })),
      awsTfvarsExample(document),
    ],
  };
}
