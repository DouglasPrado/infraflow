"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type RunDetail, type RunSummary } from "@/lib/api";

/**
 * Execuções da arquitetura (PRD §75).
 *
 * A API responde `202` e vai embora: quem executa é o worker, em outro
 * processo. A web acompanha por consulta — enquanto houver execução na fila ou
 * correndo, pergunta de novo; quando tudo termina, para.
 *
 * O estado só é escrito depois da resposta, nunca no corpo do efeito: gravar
 * antes provoca renderização em cascata a cada ciclo de consulta.
 */

const POLL_MS = 1500;

const active = (run: RunSummary) => run.status === "QUEUED" || run.status === "RUNNING";

export function useRuns(architectureId: string | null) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  /** Muda a cada ciclo de consulta — é o que dispara a releitura. */
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!architectureId) return;

    let live = true;
    api
      .runs(architectureId)
      .then((list) => {
        if (live) setRuns(list);
      })
      .catch((cause: unknown) => {
        if (live) {
          setError(cause instanceof ApiError ? cause.message : "Não foi possível ler as execuções.");
        }
      });

    return () => {
      live = false;
    };
  }, [architectureId, tick]);

  const busy = runs.some(active);

  // Só consulta de novo enquanto há execução inacabada.
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setTick((value) => value + 1), POLL_MS);
    return () => clearInterval(timer);
  }, [busy]);

  const start = useCallback(
    async (kind: "plan", target: "aws" = "aws") => {
      if (!architectureId) return;
      setStarting(true);
      setError(null);
      try {
        const run = await api.createRun(architectureId, kind, target);
        setRuns((current) => [run, ...current]);
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : "Não foi possível iniciar a execução.");
      } finally {
        setStarting(false);
      }
    },
    [architectureId],
  );

  return { runs, error, starting, start, busy };
}

/** Uma execução com o log completo, consultada enquanto não termina. */
export function useRun(runId: string | null) {
  const [loaded, setLoaded] = useState<RunDetail | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!runId) return;

    let live = true;
    api
      .run(runId)
      .then((detail) => {
        if (live) setLoaded(detail);
      })
      .catch(() => {
        // A execução some junto com a arquitetura; nada a fazer aqui.
      });

    return () => {
      live = false;
    };
  }, [runId, tick]);

  // O resultado carrega o id a que pertence: trocar de execução não mostra o
  // conteúdo da anterior sob o título da nova.
  const run = loaded?.id === runId ? loaded : null;
  const unfinished = run !== null && active(run);

  useEffect(() => {
    if (!unfinished) return;
    const timer = setInterval(() => setTick((value) => value + 1), POLL_MS);
    return () => clearInterval(timer);
  }, [unfinished]);

  return run;
}
