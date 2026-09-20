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

export async function reserveLabPort(): Promise<number> {
  const [min, max] = env.labPortRange;

  const taken = new Set(
    (
      await db.lab.findMany({
        where: { status: { in: ["CREATING", "READY", "DESTROYING"] }, entryPort: { not: null } },
        select: { entryPort: true },
      })
    ).flatMap((lab) => (lab.entryPort === null ? [] : [lab.entryPort])),
  );

  for (let port = min; port <= max; port += 1) {
    if (taken.has(port)) continue;
    if (await isFree(port)) return port;
  }

  throw new Error(`Nenhuma porta livre entre ${min} e ${max} para publicar o laboratório.`);
}
