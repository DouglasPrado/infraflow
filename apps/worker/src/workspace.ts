import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { env } from "./env.ts";

/**
 * Diretório de trabalho de uma execução (PRD §52, §53).
 *
 * Cada execução tem o seu, criado do zero. Duas execuções nunca compartilham
 * filesystem nem state — é literalmente o que o §52 proíbe, e state de OpenTofu
 * compartilhado entre projetos destrói infraestrutura alheia.
 */
export interface Workspace {
  path: string;
  write(files: { name: string; content: string }[]): Promise<void>;
  remove(): Promise<void>;
}

export async function createWorkspace(slug: string): Promise<Workspace> {
  const path = join(env.runsRoot, slug);

  // O slug vem do banco, mas o caminho é conferido mesmo assim: um `..` aqui
  // escreveria fora da raiz de execuções.
  if (!resolve(path).startsWith(resolve(env.runsRoot))) {
    throw new Error(`Diretório de execução inválido para "${slug}".`);
  }

  await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });

  return {
    path,
    async write(files) {
      for (const file of files) {
        if (file.name.includes("/") || file.name.includes("..")) {
          throw new Error(`Nome de arquivo inválido: ${file.name}`);
        }
        await writeFile(join(path, file.name), file.content, "utf8");
      }
    },
    async remove() {
      await rm(path, { recursive: true, force: true });
    },
  };
}
