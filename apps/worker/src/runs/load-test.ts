import { ArchitectureDocumentSchema, isLoadGeneratorNode } from "@infraflow/schema";
import { db } from "../db.ts";
import { K6Failure, runK6 } from "../k6.ts";
import { createWorkspace } from "../workspace.ts";

/**
 * Teste de carga real (PRD §77).
 *
 * O Load Generator do canvas deixa de ser configuração de simulação e passa a
 * ser o script que o k6 executa **contra o laboratório** (§76). Sem laboratório
 * pronto não há o que medir: a execução recusa em vez de fingir.
 */
export async function runLoadTest(runId: string): Promise<void> {
  const run = await db.run.findUnique({
    where: { id: runId },
    include: { version: true, lab: true },
  });
  if (!run) throw new Error(`Execução desconhecida: ${runId}`);

  await db.run.update({
    where: { id: run.id },
    data: { status: "RUNNING", startedAt: new Date(), error: null },
  });

  try {
    if (!run.lab || run.lab.status !== "READY" || !run.lab.entryUrl) {
      throw new Error("O laboratório precisa estar pronto antes do teste de carga (PRD §76).");
    }

    const document = ArchitectureDocumentSchema.parse(run.version.graph);
    const generator = document.nodes.find(isLoadGeneratorNode);
    if (!generator) {
      throw new Error("Não há Load Generator no canvas para configurar o teste (PRD §15).");
    }

    const workspace = await createWorkspace(run.slug);
    const outcome = await runK6(
      workspace.path,
      { baseUrl: run.lab.entryUrl, generator },
      (files) => workspace.write(files),
    );

    await db.run.update({
      where: { id: run.id },
      data: {
        status: "SUCCEEDED",
        finishedAt: new Date(),
        result: outcome.observation,
        logs: outcome.logs,
      },
    });
  } catch (cause) {
    const message =
      cause instanceof K6Failure
        ? cause.message
        : cause instanceof Error
          ? cause.message
          : "Falha desconhecida no teste de carga.";

    await db.run.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        error: message,
        logs: cause instanceof K6Failure ? cause.result.output : "",
      },
    });
  }
}
