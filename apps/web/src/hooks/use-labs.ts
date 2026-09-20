"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Lab } from "@/lib/api";

/**
 * Laboratório da arquitetura (PRD §76).
 *
 * `CREATING` e `DESTROYING` são estados de transição conduzidos pelo worker,
 * então a web pergunta de novo enquanto durarem — e para assim que o ambiente
 * fica pronto ou morre.
 */

const POLL_MS = 2000;

const transitioning = (lab: Lab) => lab.status === "CREATING" || lab.status === "DESTROYING";

export function useLabs(architectureId: string | null) {
  const [labs, setLabs] = useState<Lab[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!architectureId) return;

    let live = true;
    api
      .labs(architectureId)
      .then((list) => {
        if (live) setLabs(list);
      })
      .catch((cause: unknown) => {
        if (live) {
          setError(cause instanceof ApiError ? cause.message : "Não foi possível ler os laboratórios.");
        }
      });

    return () => {
      live = false;
    };
  }, [architectureId, tick]);

  const current = labs.find((lab) => lab.status !== "DESTROYED") ?? null;
  const moving = current !== null && transitioning(current);

  useEffect(() => {
    if (!moving) return;
    const timer = setInterval(() => setTick((value) => value + 1), POLL_MS);
    return () => clearInterval(timer);
  }, [moving]);

  const create = useCallback(async () => {
    if (!architectureId) return;
    setPending(true);
    setError(null);
    try {
      const lab = await api.createLab(architectureId);
      setLabs((list) => [lab, ...list]);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Não foi possível criar o laboratório.");
    } finally {
      setPending(false);
    }
  }, [architectureId]);

  const destroy = useCallback(async () => {
    if (!current) return;
    setPending(true);
    setError(null);
    try {
      await api.destroyLab(current.id);
      setTick((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Não foi possível destruir o laboratório.");
    } finally {
      setPending(false);
    }
  }, [current]);

  return { lab: current, labs, error, pending, create, destroy, moving };
}
