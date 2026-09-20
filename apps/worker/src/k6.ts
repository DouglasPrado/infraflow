import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildLadder, buildScript, parseSummary, type LoadTestSpec } from "@infraflow/load-engine";
import type { LoadTestObservation } from "@infraflow/schema";
import { execute, failureOf, type ProcessResult } from "./process.ts";

/**
 * k6 executado de verdade (PRD §77).
 *
 * Roda no worker, nunca na API: um teste de capacidade satura CPU e rede da
 * máquina que o dispara, e o §51 proíbe isso no servidor que atende requisição.
 *
 * O código de saída do k6 **não** é o veredito. `99` significa "limiar
 * violado" — ou seja, o teste rodou e a arquitetura não cumpriu o SLO. Isso é
 * resultado, não falha de execução.
 */

const SCRIPT = "loadtest.js";
const SUMMARY = "summary.json";
const THRESHOLD_EXIT_CODE = 99;

export class K6Failure extends Error {
  readonly result: ProcessResult;

  constructor(result: ProcessResult) {
    super(failureOf(result));
    this.name = "K6Failure";
    this.result = result;
  }
}

export interface LoadTestOutcome {
  observation: LoadTestObservation;
  logs: string;
  script: string;
}

export async function runK6(
  cwd: string,
  spec: LoadTestSpec,
  write: (files: { name: string; content: string }[]) => Promise<void>,
): Promise<LoadTestOutcome> {
  const script = buildScript(spec);
  const ladder = buildLadder(spec);

  await write([{ name: SCRIPT, content: script }]);

  const total = ladder.reduce((sum, step) => sum + step.durationSeconds, 0);
  const startedAt = new Date();

  const result = await execute("k6", ["run", "--no-color", "--quiet", SCRIPT], {
    cwd,
    // A execução dura a escada inteira; a margem cobre subida e encerramento.
    timeoutMs: total * 1000 + 120_000,
  });
  const finishedAt = new Date();

  if (!result.ok && result.code !== THRESHOLD_EXIT_CODE) {
    throw new K6Failure(result);
  }

  const raw = await readFile(join(cwd, SUMMARY), "utf8").catch(() => null);
  if (raw === null) throw new K6Failure(result);

  return {
    observation: parseSummary(JSON.parse(raw), { ladder, startedAt, finishedAt }),
    logs: `$ ${result.command}\n${result.output.trimEnd()}`,
    script,
  };
}
