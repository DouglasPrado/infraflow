"use client";

import { Check, CircleX, TriangleAlert } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { getCatalogItem } from "@infraflow/registry";
import { formatCost, formatRps } from "@/lib/format";
import { usePricing } from "@/hooks/use-pricing";
import { analyze } from "@/lib/simulation";
import { summarize, validateCanvas } from "@/lib/validation";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/store/workspace-store";

function Readout({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-eyebrow text-muted-foreground">{label}</span>
      <span className="font-mono text-[11px] font-medium tabular-nums">{children}</span>
    </div>
  );
}

/** PRD §26 — rodapé permanente: a leitura do instrumento. */
export function StatusBar() {
  const result = useWorkspaceStore((state) => state.result);
  const status = useWorkspaceStore((state) => state.simulationStatus);
  const currentRps = useWorkspaceStore((state) => state.currentRps);
  const nodes = useWorkspaceStore((state) => state.nodes);
  const edges = useWorkspaceStore((state) => state.edges);
  const selectNode = useWorkspaceStore((state) => state.selectNode);
  const setInspectorTab = useWorkspaceStore((state) => state.setInspectorTab);

  const projectName = useWorkspaceStore((state) => state.projectName);
  const provider = useWorkspaceStore((state) => state.provider);
  const environment = useWorkspaceStore((state) => state.environment);

  const analysis = useMemo(() => analyze(nodes, edges), [nodes, edges]);
  const pricing = usePricing();

  const validation = useMemo(
    () => summarize(validateCanvas({ name: projectName, provider, environment }, nodes, edges)),
    [projectName, provider, environment, nodes, edges],
  );

  const bottleneckNode = nodes.find(
    (node) => node.type === "resource" && node.data.state === "bottleneck",
  );
  const bottleneckItem =
    bottleneckNode?.type === "resource" ? getCatalogItem(bottleneckNode.data.type) : undefined;

  const findings = validation.errors + validation.warnings;
  const observed = status === "done" && result;

  return (
    <footer className="flex h-8 shrink-0 items-center gap-4 border-t bg-panel px-3">
      <div className="flex items-baseline gap-1.5">
        <span className="text-[10px] uppercase tracking-eyebrow text-muted-foreground">
          Architecture
        </span>
        {findings === 0 ? (
          <span className="flex items-center gap-1 text-[11px] font-medium text-state-healthy">
            <Check className="size-3" strokeWidth={2.25} />
            Valid
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setInspectorTab("analysis")}
            className={cn(
              "flex items-center gap-1 rounded text-[11px] font-medium",
              "transition-opacity duration-150 hover:opacity-75",
              validation.blocking ? "text-state-error" : "text-state-warning",
            )}
          >
            {validation.blocking ? (
              <CircleX className="size-3" strokeWidth={2.25} />
            ) : (
              <TriangleAlert className="size-3" strokeWidth={2.25} />
            )}
            {validation.blocking
              ? `${validation.errors} ${validation.errors === 1 ? "error" : "errors"}`
              : `${findings} ${findings === 1 ? "warning" : "warnings"}`}
          </button>
        )}
      </div>

      <span aria-hidden className="h-3 w-px bg-border" />

      <Readout label={observed ? "Observed" : "Capacity"}>
        {observed ? formatRps(result.maxHealthyRps) : formatRps(analysis.capacityRps)}
      </Readout>

      <span className="hidden sm:contents">
        {/* PRD §40 — preço de tabela quando há credencial; palpite quando não há.
            Os dois nunca aparecem com o mesmo rótulo (§85). */}
        <Readout label={pricing ? "Priced" : "Cost"}>
          {formatCost(Math.round(pricing?.monthlyUsd ?? analysis.monthlyCostUsd))}
        </Readout>
      </span>

      <span className="hidden md:contents">
        <Readout label="Resources">{analysis.resourceCount}</Readout>
      </span>

      {status === "running" && currentRps !== null && (
        <>
          <span aria-hidden className="h-3 w-px bg-border" />
          <div className="flex items-baseline gap-1.5">
            <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-eyebrow text-muted-foreground">
              <span className="size-1.5 animate-pulse rounded-full bg-brand" />
              Running
            </span>
            <span className="font-mono text-[11px] font-medium tabular-nums text-brand">
              {formatRps(currentRps)}
            </span>
          </div>
        </>
      )}

      {bottleneckNode && bottleneckItem && (
        <button
          type="button"
          onClick={() => selectNode(bottleneckNode.id)}
          className={cn(
            "ml-auto flex items-center gap-1.5 rounded-full border border-state-bottleneck/35",
            "bg-state-bottleneck/8 px-2 py-0.5 text-[11px] font-medium text-state-bottleneck",
            "transition-colors duration-150 hover:bg-state-bottleneck/15",
          )}
        >
          <TriangleAlert className="size-3" strokeWidth={2.25} />
          Bottleneck
          <span className="font-mono">{bottleneckItem.name}</span>
        </button>
      )}
    </footer>
  );
}
