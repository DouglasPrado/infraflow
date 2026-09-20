"use client";

import { Crosshair, Info } from "lucide-react";
import { useEffect, useState } from "react";
import { getCatalogItem } from "@infraflow/registry";
import { Button } from "@/components/ui/button";
import { api, type RunDetail } from "@/lib/api";
import { formatRps } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/store/workspace-store";
import { Eyebrow, FieldGroup, Provenance } from "./property-field";

/**
 * PRD §36, §79 — o resultado da medição volta para o grafo.
 *
 * O que aparece aqui **não é estimativa**: saiu do k6 e do Prometheus do
 * laboratório. Quando a medição não sustenta uma conclusão, o painel diz isso
 * em vez de apontar um culpado.
 */
export function ObservedPanel() {
  const architectureId = useWorkspaceStore((state) => state.architectureId);
  const markObserved = useWorkspaceStore((state) => state.markObserved);
  const nodes = useWorkspaceStore((state) => state.nodes);

  const [run, setRun] = useState<RunDetail | null>(null);

  useEffect(() => {
    if (!architectureId) return;

    let live = true;
    api
      .runs(architectureId)
      .then(async (list) => {
        const latest = list.find(
          (candidate) => candidate.kind === "LOAD_TEST" && candidate.status === "SUCCEEDED",
        );
        if (!latest) return null;
        return api.run(latest.id);
      })
      .then((detail) => {
        if (live) setRun(detail);
      })
      .catch(() => {
        // Sem API não há medição a mostrar; a estimativa segue visível.
      });

    return () => {
      live = false;
    };
  }, [architectureId]);

  const analysis = run?.analysis;
  if (!run || !analysis) return null;

  const nameOf = (nodeId: string) => {
    const node = nodes.find((candidate) => candidate.id === nodeId);
    if (node?.type !== "resource") return nodeId;
    return getCatalogItem(node.data.type)?.title ?? node.data.type;
  };

  return (
    <FieldGroup title="Medição">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Provenance kind="Observed" />
          <span className="font-mono text-[10px] text-muted-foreground">{run.slug}</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-0.5">
            <div className="text-[11px] text-muted-foreground">Sustentado no SLO</div>
            <div className="font-mono text-sm font-medium tabular-nums">
              {formatRps(Math.round(analysis.maxHealthyRps))}
            </div>
          </div>
          <div className="space-y-0.5">
            <div className="text-[11px] text-muted-foreground">Ponto de ruptura</div>
            <div
              className={cn(
                "font-mono text-sm font-medium tabular-nums",
                analysis.breakingStage ? "text-state-error" : undefined,
              )}
            >
              {analysis.breakingStage
                ? formatRps(Math.round(analysis.breakingStage.targetRps))
                : "—"}
            </div>
          </div>
        </div>

        {analysis.inconclusive ? (
          <p className="flex gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-3 shrink-0" strokeWidth={2.25} />
            {analysis.inconclusive}
          </p>
        ) : (
          <div className="space-y-2">
            <Eyebrow>Candidatos a gargalo</Eyebrow>
            {analysis.candidates.map((candidate, index) => (
              <div
                key={`${candidate.nodeId}-${candidate.metric}`}
                className={cn(
                  "space-y-1 rounded-lg border p-2.5",
                  index === 0 && "border-state-bottleneck/35 bg-state-bottleneck/[0.06]",
                )}
              >
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                    {nameOf(candidate.nodeId)}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 font-mono text-[11px] tabular-nums",
                      index === 0 ? "text-state-bottleneck" : "text-muted-foreground",
                    )}
                  >
                    {candidate.value.toFixed(1)}
                    {candidate.unit}
                  </span>
                </div>

                <div className="flex items-baseline gap-2 text-[10px] text-muted-foreground">
                  <span className="uppercase tracking-eyebrow">{candidate.metric}</span>
                  <span className="font-mono tabular-nums">
                    confiança {candidate.confidence.toFixed(2)}
                  </span>
                </div>

                <p className="text-[10px] leading-relaxed text-muted-foreground">
                  {candidate.reason}
                </p>

                {index === 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1.5 text-[11px]"
                    onClick={() => markObserved(candidate.nodeId)}
                  >
                    <Crosshair className="size-3" />
                    Ver no canvas
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </FieldGroup>
  );
}
