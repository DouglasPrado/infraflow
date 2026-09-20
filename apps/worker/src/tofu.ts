import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PlanAction, PlanSummary, RunTarget } from "@infraflow/schema";
import { mkdir } from "node:fs/promises";
import { env } from "./env.ts";
import { execute, failureOf, type ProcessResult } from "./process.ts";

/**
 * OpenTofu executado de verdade (PRD §74, §75).
 *
 * Roda **aqui**, no worker, nunca na API (§51): `init` baixa provider, `plan`
 * fala com a nuvem e ambos demoram. Servidor de requisição não faz isso.
 *
 * O plano é lido em JSON, não do texto: a saída humana muda entre versões e
 * fazer regex nela é como o produto passaria a errar em silêncio.
 */

const PLAN_FILE = "tfplan";

export interface TofuStep {
  label: string;
  result: ProcessResult;
}

export class TofuFailure extends Error {
  // Campos declarados no corpo, não como parâmetro: o `node --test` roda estes
  // arquivos com type stripping, que não suporta parameter properties.
  readonly step: string;
  readonly result: ProcessResult;

  constructor(step: string, result: ProcessResult) {
    super(failureOf(result));
    this.name = "TofuFailure";
    this.step = step;
    this.result = result;
  }
}

async function step(
  label: string,
  args: string[],
  cwd: string,
  steps: TofuStep[],
): Promise<ProcessResult> {
  const result = await execute("tofu", args, {
    cwd,
    env: { TF_PLUGIN_CACHE_DIR: env.tofuPluginCache, TF_IN_AUTOMATION: "1" },
  });
  steps.push({ label, result });
  if (!result.ok) throw new TofuFailure(label, result);
  return result;
}

/** Forma do `tofu show -json` que interessa ao resumo. */
interface PlanJson {
  resource_changes?: {
    address?: string;
    type?: string;
    name?: string;
    change?: { actions?: string[] };
  }[];
}

/** `["delete","create"]` é substituição; a ordem inverte com create_before_destroy. */
function actionOf(actions: string[]): PlanAction {
  if (actions.length > 1) return "replace";
  const [only] = actions;
  switch (only) {
    case "create":
    case "update":
    case "delete":
    case "read":
      return only;
    default:
      return "no-op";
  }
}

export interface PlanOutcome {
  summary: Omit<PlanSummary, "compileWarnings">;
  steps: TofuStep[];
}

/**
 * `tofu init` + `tofu plan` + leitura do plano.
 *
 * `-input=false` para nunca bloquear pedindo dado no terminal, e `-lock=false`
 * porque o state é local e exclusivo desta execução (§52).
 */
export async function plan(
  cwd: string,
  target: RunTarget,
  variables: Record<string, string> = {},
): Promise<PlanOutcome> {
  const steps: TofuStep[] = [];
  await mkdir(env.tofuPluginCache, { recursive: true });

  await step("init", ["init", "-no-color", "-input=false"], cwd, steps);
  await step(
    "plan",
    [
      "plan",
      "-no-color",
      "-input=false",
      "-lock=false",
      ...Object.entries(variables).map(([name, value]) => `-var=${name}=${value}`),
      `-out=${PLAN_FILE}`,
    ],
    cwd,
    steps,
  );
  const shown = await step("show", ["show", "-json", PLAN_FILE], cwd, steps);

  const parsed = JSON.parse(shown.stdout) as PlanJson;
  const changes = (parsed.resource_changes ?? []).flatMap((change) => {
    const actions = change.change?.actions ?? [];
    const action = actionOf(actions);
    if (action === "no-op") return [];
    return [
      {
        address: change.address ?? "",
        type: change.type ?? "",
        name: change.name ?? "",
        action,
      },
    ];
  });

  return {
    steps,
    summary: {
      target,
      add: changes.filter((change) => change.action === "create" || change.action === "replace").length,
      change: changes.filter((change) => change.action === "update").length,
      destroy: changes.filter((change) => change.action === "delete" || change.action === "replace").length,
      changes,
    },
  };
}

/** Log legível de uma sequência de passos, para o workspace mostrar. */
export function transcript(steps: TofuStep[]): string {
  return steps
    .map((entry) => `$ ${entry.result.command}\n${entry.result.output.trimEnd()}`)
    .join("\n\n");
}

/** O plano gravado, para quem quiser inspecionar depois. */
export function planPath(cwd: string): string {
  return join(cwd, PLAN_FILE);
}

export async function readPlanJson(cwd: string): Promise<string> {
  return readFile(planPath(cwd), "utf8");
}

/**
 * `tofu apply` no diretório do laboratório (PRD §76).
 *
 * `-auto-approve` é deliberado e seguro **porque o alvo é o laboratório**: o
 * §75 mantém a nuvem sem apply automático, e quem chama aqui já recusou
 * qualquer alvo que não seja o docker efêmero.
 */
export async function apply(
  cwd: string,
  variables: Record<string, string> = {},
): Promise<TofuStep[]> {
  const steps: TofuStep[] = [];
  await mkdir(env.tofuPluginCache, { recursive: true });

  await step("init", ["init", "-no-color", "-input=false"], cwd, steps);
  await step(
    "apply",
    [
      "apply",
      "-no-color",
      "-input=false",
      "-auto-approve",
      ...Object.entries(variables).map(([name, value]) => `-var=${name}=${value}`),
    ],
    cwd,
    steps,
  );

  return steps;
}

/** PRD §54 — o que sobe tem que descer. */
export async function destroy(cwd: string): Promise<TofuStep[]> {
  const steps: TofuStep[] = [];
  await mkdir(env.tofuPluginCache, { recursive: true });

  await step("init", ["init", "-no-color", "-input=false"], cwd, steps);
  await step("destroy", ["destroy", "-no-color", "-input=false", "-auto-approve"], cwd, steps);

  return steps;
}

/** Saídas declaradas pelo módulo, já resolvidas. */
export async function outputs(cwd: string): Promise<Record<string, string>> {
  const result = await execute("tofu", ["output", "-json"], {
    cwd,
    env: { TF_PLUGIN_CACHE_DIR: env.tofuPluginCache, TF_IN_AUTOMATION: "1" },
  });
  if (!result.ok) return {};

  const parsed = JSON.parse(result.stdout) as Record<string, { value?: unknown }>;
  return Object.fromEntries(
    Object.entries(parsed).flatMap(([name, entry]) =>
      typeof entry.value === "string" ? [[name, entry.value]] : [],
    ),
  );
}
