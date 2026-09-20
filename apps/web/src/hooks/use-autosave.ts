"use client";

import { useEffect, useRef } from "react";
import { api, ApiError } from "@/lib/api";
import { toDocument } from "@/lib/document";
import { useWorkspaceStore } from "@/store/workspace-store";

/** Espera depois da última mudança antes de gravar. */
const DEBOUNCE_MS = 900;

/**
 * Autosave (PRD §71).
 *
 * Grava por cima da versão corrente — não se cria uma versão por tecla
 * digitada. Três cuidados:
 *
 * 1. Só grava quando o documento **mudou de fato**. A simulação mexe no estado
 *    dos nodes, mas estado não é documento: `toDocument` o descarta, então uma
 *    execução inteira do teste de carga não gera nenhum PUT.
 * 2. Nunca deixa duas gravações correndo juntas; se algo mudar durante uma,
 *    reagenda ao terminar.
 * 3. Um canvas que a API recusaria não fica tentando em laço.
 */
export function useAutosave() {
  const architectureId = useWorkspaceStore((state) => state.architectureId);
  const nodes = useWorkspaceStore((state) => state.nodes);
  const edges = useWorkspaceStore((state) => state.edges);
  const projectName = useWorkspaceStore((state) => state.projectName);
  const provider = useWorkspaceStore((state) => state.provider);
  const environment = useWorkspaceStore((state) => state.environment);
  const setSaveStatus = useWorkspaceStore((state) => state.setSaveStatus);

  /** Última carga aceita pela API. Evita PUT que não muda nada. */
  const lastSaved = useRef<string | null>(null);
  const inFlight = useRef(false);
  const pendingAgain = useRef(false);

  useEffect(() => {
    if (!architectureId) return;

    let serialized: string;
    try {
      serialized = JSON.stringify(
        toDocument({ name: projectName, provider, environment }, nodes, edges),
      );
    } catch {
      // Canvas em estado que o schema recusa — não adianta tentar gravar.
      setSaveStatus("error", "O canvas está num estado que a API não aceita.");
      return;
    }

    // Primeira passada depois de hidratar: o documento é o que veio do servidor.
    if (lastSaved.current === null) {
      lastSaved.current = serialized;
      return;
    }

    if (serialized === lastSaved.current) return;

    if (inFlight.current) {
      pendingAgain.current = true;
      return;
    }

    setSaveStatus("pending");

    const timer = setTimeout(async () => {
      inFlight.current = true;
      setSaveStatus("saving");

      try {
        await api.save(architectureId, JSON.parse(serialized) as unknown);
        lastSaved.current = serialized;
        setSaveStatus("saved");
      } catch (cause) {
        const message =
          cause instanceof ApiError ? cause.message : "Sem conexão com a API. Nada foi salvo.";
        setSaveStatus("error", message);

        // Documento recusado: marcar como salvo evita repetir o mesmo PUT
        // inválido a cada tecla. A mensagem de erro segue visível.
        if (cause instanceof ApiError && (cause.status === 400 || cause.status === 422)) {
          lastSaved.current = serialized;
        }
      } finally {
        inFlight.current = false;
        if (pendingAgain.current) {
          pendingAgain.current = false;
          // Reagenda o que mudou enquanto gravava.
          useWorkspaceStore.setState((state) => ({ dirty: state.dirty }));
        }
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [architectureId, nodes, edges, projectName, provider, environment, setSaveStatus]);
}
