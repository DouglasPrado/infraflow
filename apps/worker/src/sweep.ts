import { slugFor } from "@infraflow/schema";
import { db } from "./db.ts";
import { runLabDestroy } from "./runs/lab.ts";

/**
 * Laboratórios vencidos (PRD §54).
 *
 * O §54 deixa a detecção de ambientes órfãos para depois, mas um laboratório
 * sem prazo é um vazamento garantido: containers continuam rodando muito
 * depois de o teste acabar. A varredura derruba o que passou da validade — é o
 * mínimo para que "temporário" signifique alguma coisa.
 */
const INTERVAL_MS = 60_000;

export async function sweepExpiredLabs(): Promise<number> {
  const expired = await db.lab.findMany({
    where: { status: "READY", expiresAt: { lt: new Date() } },
    select: { id: true, architectureId: true, versionId: true },
  });

  for (const lab of expired) {
    const run = await db.run.create({
      data: {
        architectureId: lab.architectureId,
        versionId: lab.versionId,
        labId: lab.id,
        kind: "LAB_DESTROY",
        slug: slugFor("lab-destroy"),
        params: { target: "docker" },
      },
    });

    await runLabDestroy(run.id);
  }

  return expired.length;
}

export function startLabSweep(): NodeJS.Timeout {
  const timer = setInterval(() => {
    void sweepExpiredLabs().catch((cause: unknown) => {
      console.error("[worker] varredura de laboratórios falhou:", cause);
    });
  }, INTERVAL_MS);

  // Não segura o processo: é manutenção, não trabalho pendente.
  timer.unref();
  return timer;
}
