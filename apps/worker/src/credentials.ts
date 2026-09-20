import { open } from "@infraflow/db";
import { db } from "./db.ts";

/**
 * Credencial de nuvem de uma execução (PRD §52).
 *
 * Vem do projeto dono da arquitetura, cifrada no banco. O worker decifra na
 * hora de executar e passa ao processo filho como variável explícita — nunca
 * deixa o OpenTofu procurar credencial por conta própria.
 */
export interface CloudEnv {
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  AWS_REGION: string;
  AWS_DEFAULT_REGION: string;
}

export class MissingCloudCredential extends Error {
  constructor() {
    super(
      "Este projeto não tem credencial de nuvem configurada. Abra Configurações no workspace e informe uma chave da AWS.",
    );
    this.name = "MissingCloudCredential";
  }
}

export async function cloudEnvFor(architectureId: string): Promise<CloudEnv> {
  const architecture = await db.architecture.findUnique({
    where: { id: architectureId },
    select: { projectId: true },
  });
  if (!architecture) throw new MissingCloudCredential();

  const stored = await db.cloudCredential.findUnique({
    where: { projectId: architecture.projectId },
  });
  if (!stored) throw new MissingCloudCredential();

  const secret = JSON.parse(
    open({ cipher: stored.cipher, iv: stored.iv, tag: stored.tag }),
  ) as { accessKeyId: string; secretAccessKey: string };

  return {
    AWS_ACCESS_KEY_ID: secret.accessKeyId,
    AWS_SECRET_ACCESS_KEY: secret.secretAccessKey,
    AWS_REGION: stored.region,
    AWS_DEFAULT_REGION: stored.region,
  };
}
