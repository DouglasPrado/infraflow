import { env } from "./env.ts";

/**
 * "Ready" do fluxo do §76.
 *
 * Pronto não é "o container subiu": é **a arquitetura responder**. A requisição
 * vai pela porta de entrada e atravessa a topologia — a aplicação implantada
 * exercita cada dependência declarada e devolve 5xx se alguma falhar. Banco
 * leva dezenas de segundos para aceitar conexão, então isto insiste.
 */
export interface ReadyResult {
  ready: boolean;
  attempts: number;
  lastStatus?: number;
  lastError?: string;
  waitedMs: number;
}

const INTERVAL_MS = 2000;

export async function waitUntilReady(
  url: string,
  timeoutMs = env.labReadyTimeoutMs,
): Promise<ReadyResult> {
  const deadline = Date.now() + timeoutMs;
  const startedAt = Date.now();
  let attempts = 0;
  let lastStatus: number | undefined;
  let lastError: string | undefined;

  while (Date.now() < deadline) {
    attempts += 1;
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(5000),
        headers: { "user-agent": "infraflow-lab-readiness" },
      });
      lastStatus = response.status;
      await response.arrayBuffer();
      if (response.ok) {
        return { ready: true, attempts, lastStatus, waitedMs: Date.now() - startedAt };
      }
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : String(cause);
    }

    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }

  return {
    ready: false,
    attempts,
    ...(lastStatus === undefined ? {} : { lastStatus }),
    ...(lastError === undefined ? {} : { lastError }),
    waitedMs: Date.now() - startedAt,
  };
}
