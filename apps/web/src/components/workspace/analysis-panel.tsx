"use client";

import { Check, CircleX, TriangleAlert } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { SaturationMeter } from "@/components/canvas/saturation-meter";
import { Separator } from "@/components/ui/separator";
import { getCatalogItem } from "@infraflow/registry";
import { formatCost, formatRps } from "@/lib/format";
import { analyze, recommendationsFor } from "@/lib/simulation";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/store/workspace-store";
import { Eyebrow, FieldGroup, Provenance } from "./property-field";

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("font-mono text-sm font-medium tabular-nums", tone)}>{value}</div>
    </div>
  );
}

const VERDICT_ICON: Record<string, ReactNode> = {
  ok: <Check className="size-3 text-state-healthy" strokeWidth={2.5} />,
  warning: <TriangleAlert className="size-3 text-state-warning" strokeWidth={2.25} />,
  fail: <CircleX className="size-3 text-state-error" strokeWidth={2.25} />,
};

/** PRD §23–§25 — Analysis, Bottleneck Analysis e Recomendações. */
export function AnalysisPanel() {
  const runLog = useWorkspaceStore((state) => state.runLog);
  const result = useWorkspaceStore((state) => state.result);
  const status = useWorkspaceStore((state) => state.simulationStatus);
  const nodes = useWorkspaceStore((state) => state.nodes);
  const edges = useWorkspaceStore((state) => state.edges);
  const selectNode = useWorkspaceStore((state) => state.selectNode);

  const analysis = useMemo(() => analyze(nodes, edges), [nodes, edges]);

  const bottleneckNode = result?.bottleneckNodeId
    ? nodes.find((node) => node.id === result.bottleneckNodeId)
    : undefined;
  const bottleneckItem =
    bottleneckNode?.type === "resource" ? getCatalogItem(bottleneckNode.data.type) : undefined;

  const observed = status === "done" && result;

  /** Pico de saturação em cada degrau já executado. */
  const ladder = (result?.steps ?? []).slice(0, runLog.length).map((step) => ({
    rps: step.rps,
    verdict: step.verdict,
    peak: step.readings.reduce((max, reading) => Math.max(max, reading.utilization), 0),
  }));

  return (
    <div className="space-y-5 p-3">
      {/* O veredito lidera assim que existe. Antes disso, a estimativa é tudo que há. */}
      {observed && (
        <>
          <section className="space-y-3">
            <Provenance kind="Observed" />
            <div>
              <div className="text-[11px] text-muted-foreground">Maximum healthy capacity</div>
              <div className="mt-0.5 font-mono text-[32px] font-medium leading-none tracking-tight tabular-nums">
                {formatRps(result.maxHealthyRps)}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 border-t pt-3">
              <Stat
                label="Breaking point"
                value={result.breakingPointRps ? formatRps(result.breakingPointRps) : "—"}
                tone="text-state-error"
              />
              <Stat label="p95" value={`${result.p95Ms}ms`} />
              <Stat label="Errors" value={`${result.errorRatePct}%`} />
            </div>
          </section>

          <Separator />
        </>
      )}

      {/* PRD §20 — a escada de carga, na mesma gramática dos nodes. */}
      <FieldGroup title="Execução do teste">
        {ladder.length === 0 ? (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Execute o teste de carga para ver onde a arquitetura cede.
          </p>
        ) : (
          <div className="space-y-1.5">
            {ladder.map((step) => (
              <div key={step.rps} className="flex items-center gap-2.5">
                <span className="w-16 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                  {step.rps.toLocaleString("pt-BR")}
                </span>
                <SaturationMeter utilization={step.peak} className="flex-1" height="h-[5px]" />
                <span className="flex w-3 shrink-0 justify-center">{VERDICT_ICON[step.verdict]}</span>
              </div>
            ))}
            <p className="pt-1 text-[10px] leading-relaxed text-muted-foreground">
              req/s por degrau · barra = pico de saturação · tique = capacidade
            </p>
          </div>
        )}
      </FieldGroup>

      {observed && bottleneckItem && bottleneckNode && (
        <>
          <Separator />

          <section className="space-y-2.5">
            <Eyebrow>Gargalo detectado</Eyebrow>
            <button
              type="button"
              onClick={() => selectNode(bottleneckNode.id)}
              className={cn(
                "w-full rounded-lg border border-state-bottleneck/35 bg-state-bottleneck/[0.06] p-3 text-left",
                "transition-colors duration-150 hover:bg-state-bottleneck/[0.11]",
              )}
            >
              <div className="text-sm font-medium">{bottleneckItem.title}</div>
              <div className="font-mono text-[11px] text-muted-foreground">
                {bottleneckNode.type === "resource" ? bottleneckNode.data.name : ""}
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                {result.bottleneckMetrics.map((metric) => (
                  <div key={metric.key} className="space-y-0.5">
                    <div className="text-[10px] uppercase tracking-eyebrow text-muted-foreground">
                      {metric.label}
                    </div>
                    <div className="font-mono text-sm font-medium tabular-nums text-state-bottleneck">
                      {metric.value}
                      <span className="text-[11px] font-normal">{metric.unit}</span>
                    </div>
                  </div>
                ))}
              </div>
            </button>

            <p className="text-[11px] leading-relaxed text-muted-foreground">
              A latência sobe junto com a saturação de CPU em {bottleneckItem.title}.
            </p>
          </section>

          <Separator />

          <section className="space-y-2.5">
            <Provenance kind="Suggested" />
            <ul className="space-y-1.5">
              {recommendationsFor(
                bottleneckNode.type === "resource" ? bottleneckNode.data.type : undefined,
              ).map((recommendation) => (
                <li key={recommendation} className="flex gap-2 text-[11px] text-muted-foreground">
                  <span aria-hidden className="text-border">
                    —
                  </span>
                  {recommendation}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <Separator />

      <section className="space-y-3">
        <Provenance kind="Estimated" />
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Estimated capacity" value={formatRps(analysis.capacityRps)} />
          <Stat label="Estimated cost" value={`${formatCost(analysis.monthlyCostUsd)}/mês`} />
          <Stat label="Resources" value={String(analysis.resourceCount)} />
          <Stat
            label="Warnings"
            value={String(analysis.warnings.length)}
            tone={analysis.warnings.length > 0 ? "text-state-warning" : undefined}
          />
        </div>

        {analysis.warnings.length > 0 && (
          <ul className="space-y-1">
            {analysis.warnings.map((warning) => (
              <li key={warning} className="flex gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                <TriangleAlert
                  className="mt-0.5 size-3 shrink-0 text-state-warning"
                  strokeWidth={2.25}
                />
                {warning}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
