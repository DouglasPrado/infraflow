"use client";

import { useEffect, useState } from "react";
import { api, type ArchitecturePricing } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace-store";

/**
 * Custo pela tabela da AWS (PRD §40).
 *
 * Só existe quando há credencial configurada (§52). Sem ela o produto continua
 * mostrando a estimativa do registry — e dizendo que é estimativa, em vez de
 * apresentar palpite com cara de preço.
 *
 * Acompanha o autosave: mudou a configuração de um recurso, o preço é
 * reconsultado, porque classe de instância e réplicas mudam a conta.
 */
export function usePricing(): ArchitecturePricing | null {
  const architectureId = useWorkspaceStore((state) => state.architectureId);
  const saveStatus = useWorkspaceStore((state) => state.saveStatus);

  const [pricing, setPricing] = useState<ArchitecturePricing | null>(null);

  useEffect(() => {
    if (!architectureId) return;

    let live = true;
    api
      .pricing(architectureId)
      .then((result) => {
        if (live) setPricing(result);
      })
      .catch(() => {
        // Sem credencial ou sem tabela: a estimativa segue valendo.
        if (live) setPricing(null);
      });

    return () => {
      live = false;
    };
  }, [architectureId, saveStatus]);

  return pricing;
}
