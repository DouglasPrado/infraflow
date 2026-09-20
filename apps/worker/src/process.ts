import { spawn } from "node:child_process";
import { env } from "./env.ts";

/**
 * Execução de processo externo (PRD §51, §52).
 *
 * Três cuidados que não são opcionais quando se roda OpenTofu e k6:
 *
 * 1. **Ambiente mínimo.** O filho não herda `process.env`. Recebe uma lista
 *    explícita — sem isso, qualquer variável do worker (inclusive a URL do
 *    banco) chegaria ao provider.
 * 2. **Teto de tempo.** Processo externo trava; o worker não pode travar junto.
 * 3. **Saída limitada.** `plan` de arquitetura grande produz megabytes. Guarda-se
 *    a cauda, que é onde o erro aparece.
 */

/** Só isto atravessa para o processo filho, além do que o chamador declarar. */
const INHERITED = ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "TERM"];

/**
 * Prefixos repassados quando existem no ambiente do worker.
 *
 * Credencial de nuvem ainda é a do próprio worker, compartilhada por todos os
 * projetos — o §52 pede credencial por projeto, que não existe neste estágio e
 * está registrada como limitação no README.
 */
const INHERITED_PREFIXES = ["AWS_", "TF_", "DOCKER_"];

function childEnv(extra: Record<string, string> = {}): Record<string, string> {
  const result: Record<string, string> = {};

  for (const name of INHERITED) {
    const value = process.env[name];
    if (value !== undefined) result[name] = value;
  }

  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (INHERITED_PREFIXES.some((prefix) => name.startsWith(prefix))) result[name] = value;
  }

  return { ...result, ...extra };
}

/** Acima disto, guarda-se só a cauda: é onde o erro aparece. */
const MAX_OUTPUT_BYTES = 256 * 1024;

function tail(chunks: string[], limit = MAX_OUTPUT_BYTES): string {
  const joined = chunks.join("");
  if (joined.length <= limit) return joined;
  return `… ${joined.length - limit} caracteres omitidos …\n${joined.slice(-limit)}`;
}

export interface ProcessOptions {
  cwd: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface ProcessResult {
  command: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  /** stdout e stderr na ordem em que saíram — é o que vai para os logs. */
  output: string;
  timedOut: boolean;
  durationMs: number;
  get ok(): boolean;
}

export async function execute(
  command: string,
  args: string[],
  options: ProcessOptions,
): Promise<ProcessResult> {
  const timeoutMs = options.timeoutMs ?? env.processTimeoutMs;
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: childEnv(options.env),
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdout: string[] = [];
    const combined: string[] = [];
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout.push(chunk);
      combined.push(chunk);
    });
    child.stderr.on("data", (chunk: string) => combined.push(chunk));

    child.on("error", (cause) => {
      clearTimeout(timer);
      reject(cause);
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const printable = `${command} ${args.join(" ")}`;
      resolve({
        command: printable,
        code,
        signal,
        stdout: tail(stdout),
        output: tail(combined),
        timedOut,
        durationMs: Date.now() - startedAt,
        get ok() {
          return code === 0 && !timedOut;
        },
      });
    });
  });
}

/** Mensagem de erro curta o bastante para caber no `error` da execução. */
export function failureOf(result: ProcessResult): string {
  if (result.timedOut) {
    return `\`${result.command}\` excedeu o tempo limite.`;
  }
  const lines = result.output.trimEnd().split("\n");
  const relevant = lines.slice(-12).join("\n");
  return `\`${result.command}\` terminou com código ${result.code ?? "desconhecido"}.\n${relevant}`;
}
