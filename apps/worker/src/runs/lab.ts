import { randomBytes } from "node:crypto";
import { emit } from "@infraflow/compiler";
import { ArchitectureDocumentSchema, LabApplyResultSchema } from "@infraflow/schema";
import { db } from "../db.ts";
import { env } from "../env.ts";
import { reserveLabPort } from "../ports.ts";
import { waitUntilReady } from "../ready.ts";
import { TofuFailure, apply, destroy, outputs, transcript } from "../tofu.ts";
import { createWorkspace } from "../workspace.ts";

/**
 * Laboratório de infraestrutura (PRD §76).
 *
 * `Create Lab → OpenTofu apply → Deploy → Ready`, literalmente. O alvo é
 * **sempre** o docker efêmero: o §75 mantém a nuvem sem apply automático, e um
 * laboratório que pudesse aplicar na AWS transformaria um clique em conta.
 *
 * O diretório do laboratório persiste entre o apply e o destroy — é onde mora
 * o state. Sem ele, não haveria como derrubar o que subiu (§54).
 */

function failureMessage(cause: unknown): string {
  if (cause instanceof TofuFailure) return cause.message;
  if (cause instanceof Error) return cause.message;
  return "Falha desconhecida no laboratório.";
}

export async function runLabApply(runId: string): Promise<void> {
  const run = await db.run.findUnique({
    where: { id: runId },
    include: { version: true, lab: true },
  });
  if (!run?.lab) throw new Error(`Execução de laboratório sem laboratório: ${runId}`);

  const lab = run.lab;
  await db.run.update({
    where: { id: run.id },
    data: { status: "RUNNING", startedAt: new Date(), error: null },
  });

  try {
    const document = ArchitectureDocumentSchema.parse(run.version.graph);
    const { stack, files } = emit(document, { target: "docker", slug: lab.slug });

    if (!stack.docker?.entry) {
      throw new Error(
        "A arquitetura não tem porta de entrada: conecte o Load Generator ao ponto de entrada.",
      );
    }

    const port = await reserveLabPort();
    const entryUrl = `http://127.0.0.1:${port}`;

    // O diretório do laboratório não é apagado: guarda o state (§54).
    const workspace = await createWorkspace(lab.slug, { root: env.labsRoot, fresh: false });
    await workspace.write(files);

    await db.lab.update({
      where: { id: lab.id },
      data: { entryPort: port, entryUrl, workdir: workspace.path, containers: stack.docker.containers },
    });

    const steps = await apply(workspace.path, {
      entry_port: String(port),
      // Senha efêmera, válida só dentro da rede do laboratório. Não é gravada:
      // nada fora da rede alcança os serviços que a usam (§52).
      lab_password: randomBytes(12).toString("hex"),
    });

    const published = await outputs(workspace.path);
    const url = published.entry_url ?? entryUrl;

    // "Ready" é a arquitetura responder, não o container subir.
    const readiness = await waitUntilReady(url);

    await db.run.update({
      where: { id: run.id },
      data: {
        status: readiness.ready ? "SUCCEEDED" : "FAILED",
        finishedAt: new Date(),
        logs: transcript(steps),
        result: LabApplyResultSchema.parse({
          entryUrl: url,
          containers: stack.docker.containers,
          readiness,
        }),
        error: readiness.ready
          ? null
          : `O laboratório subiu mas não respondeu em ${Math.round(readiness.waitedMs / 1000)}s (última resposta: ${readiness.lastStatus ?? readiness.lastError ?? "sem resposta"}).`,
      },
    });

    await db.lab.update({
      where: { id: lab.id },
      data: readiness.ready
        ? {
            status: "READY",
            entryUrl: url,
            readyAt: new Date(),
            expiresAt: new Date(Date.now() + env.labTtlMs),
            error: null,
          }
        : {
            status: "FAILED",
            entryUrl: url,
            error: "O laboratório não respondeu no tempo esperado.",
          },
    });
  } catch (cause) {
    const message = failureMessage(cause);

    await db.run.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        error: message,
        logs: cause instanceof TofuFailure ? cause.result.output : "",
      },
    });
    await db.lab.update({ where: { id: lab.id }, data: { status: "FAILED", error: message } });
  }
}

/** PRD §54 — `tofu destroy` e o diretório vai junto. */
export async function runLabDestroy(runId: string): Promise<void> {
  const run = await db.run.findUnique({ where: { id: runId }, include: { lab: true } });
  if (!run?.lab) throw new Error(`Execução de laboratório sem laboratório: ${runId}`);

  const lab = run.lab;
  await db.run.update({
    where: { id: run.id },
    data: { status: "RUNNING", startedAt: new Date(), error: null },
  });
  await db.lab.update({ where: { id: lab.id }, data: { status: "DESTROYING" } });

  try {
    const workspace = await createWorkspace(lab.slug, { root: env.labsRoot, fresh: false });
    const steps = await destroy(workspace.path);
    await workspace.remove();

    await db.run.update({
      where: { id: run.id },
      data: { status: "SUCCEEDED", finishedAt: new Date(), logs: transcript(steps) },
    });
    await db.lab.update({
      where: { id: lab.id },
      data: { status: "DESTROYED", destroyedAt: new Date(), entryUrl: null, entryPort: null },
    });
  } catch (cause) {
    const message = failureMessage(cause);

    await db.run.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        error: message,
        logs: cause instanceof TofuFailure ? cause.result.output : "",
      },
    });
    // Continua marcado como laboratório vivo: infraestrutura que não desceu
    // precisa continuar visível, senão vira órfã (§54).
    await db.lab.update({ where: { id: lab.id }, data: { status: "READY", error: message } });
  }
}
