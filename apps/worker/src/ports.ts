import { createServer } from "node:net";
import { db } from "./db.ts";
import { env } from "./env.ts";

/**
 * Porta publicada de um laboratório (PRD §76).
 *
 * Dois laboratórios não podem disputar a mesma porta, então a escolha olha
 * duas coisas: o que já está reservado no banco e o que o sistema aceita
 * abrir agora. Só a porta de entrada é publicada — o resto do laboratório vive
 * na rede interna (§52).
 */
async function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });
}

/**
 * Portas de um laboratório: a de entrada e a do Prometheus (§78).
 *
 * São reservadas juntas para não haver o intervalo em que outra execução
 * escolhe a mesma.
 */
export async function reserveLabPorts(): Promise<{ entry: number; observability: number }> {
  const [min, max] = env.labPortRange;

  const taken = new Set(
    (
      await db.lab.findMany({
        where: { status: { in: ["CREATING", "READY", "DESTROYING"] } },
        select: { entryPort: true, observabilityPort: true },
      })
    ).flatMap((lab) => [lab.entryPort, lab.observabilityPort].filter((port) => port !== null)),
  );

  const chosen: number[] = [];
  for (let port = min; port <= max && chosen.length < 2; port += 1) {
    if (taken.has(port)) continue;
    if (await isFree(port)) chosen.push(port);
  }

  if (chosen.length < 2) {
    throw new Error(`Não há duas portas livres entre ${min} e ${max} para o laboratório.`);
  }

  return { entry: chosen[0]!, observability: chosen[1]! };
}
