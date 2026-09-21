import { defaultVariables, emit } from "@infraflow/compiler";
import { ArchitectureDocumentSchema, RunParamsSchema, type PlanSummary } from "@infraflow/schema";
import { cloudEnvFor } from "../credentials.ts";
import { db } from "../db.ts";
import { TofuFailure, plan, transcript } from "../tofu.ts";
import { createWorkspace } from "../workspace.ts";

/**
 * Execução de `plan` (PRD §75).
 *
 * O worker lê a versão gravada, compila, escreve no seu próprio diretório e
 * roda o OpenTofu. O resultado — inclusive a falha — volta para o banco, porque
 * o workspace precisa mostrar **o que aconteceu**, e "não passou" é resultado.
 */
export async function runPlan(runId: string): Promise<void> {
  const run = await db.run.findUnique({
    where: { id: runId },
    include: { version: true },
  });
  if (!run) throw new Error(`Execução desconhecida: ${runId}`);

  await db.run.update({
    where: { id: run.id },
    data: { status: "RUNNING", startedAt: new Date(), error: null },
  });

  const workspace = await createWorkspace(run.slug);

  try {
    const params = RunParamsSchema.parse(run.params);
    const document = ArchitectureDocumentSchema.parse(run.version.graph);
    const { stack, files } = emit(document);

    await workspace.write(files);

    /**
     * O plano exige credencial do projeto (§52). Sem ela a execução falha com
     * instrução, em vez de cair na credencial da máquina.
     */
    const cloudEnv = await cloudEnvFor(run.architectureId);

    const outcome = await plan(
      workspace.path,
      params.target,
      defaultVariables(document),
      cloudEnv,
    );
    const summary: PlanSummary = {
      ...outcome.summary,
      compileWarnings: stack.warnings.map((warning) => ({
        code: warning.code,
        message: warning.message,
        ...(warning.nodeId ? { nodeId: warning.nodeId } : {}),
        ...(warning.hint ? { hint: warning.hint } : {}),
      })),
    };

    await db.run.update({
      where: { id: run.id },
      data: {
        status: "SUCCEEDED",
        finishedAt: new Date(),
        result: summary,
        logs: transcript(outcome.steps),
      },
    });
  } catch (cause) {
    // Falha de `plan` é informação para o usuário, não incidente do worker:
    // credencial ausente, região errada, recurso indisponível.
    const message =
      cause instanceof TofuFailure
        ? cause.message
        : cause instanceof Error
          ? cause.message
          : "Falha desconhecida ao planejar.";

    await db.run.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        error: message,
        logs: cause instanceof TofuFailure ? cause.result.output : "",
      },
    });
  }
}
