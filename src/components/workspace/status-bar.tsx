"use client";

import { Check, TriangleAlert } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { getCatalogItem } from "@/lib/catalog";
import { formatCost, formatRps } from "@/lib/format";
import { analyze } from "@/lib/simulation";
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

  const analysis = useMemo(() => analyze(nodes, edges), [nodes, edges]);

  const bottleneckNode = nodes.find(
    (node) => node.type === "resource" && node.data.state === "bottleneck",
  );
  const bottleneckItem =
    bottleneckNode?.type === "resource" ? getCatalogItem(bottleneckNode.data.type) : undefined;

  const valid = analysis.warnings.length === 0;
  const observed = status === "done" && result;

  return (
    <footer className="flex h-8 shrink-0 items-center gap-4 border-t bg-panel px-3">
      <div className="flex items-baseline gap-1.5">
        <span className="text-[10px] uppercase tracking-eyebrow text-muted-foreground">
          Architecture
        </span>
        {valid ? (
          <span className="flex items-center gap-1 text-[11px] font-medium text-state-healthy">
            <Check className="size-3" strokeWidth={2.25} />
            Valid
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setInspectorTab("analysis")}
            className="flex items-center gap-1 rounded text-[11px] font-medium text-state-warning transition-opacity duration-150 hover:opacity-75"
          >
            <TriangleAlert className="size-3" strokeWidth={2.25} />
            {analysis.warnings.length} {analysis.warnings.length === 1 ? "warning" : "warnings"}
          </button>
        )}
      </div>

      <span aria-hidden className="h-3 w-px bg-border" />

      <Readout label={observed ? "Observed" : "Capacity"}>
        {observed ? formatRps(result.maxHealthyRps) : formatRps(analysis.capacityRps)}
      </Readout>

      <span className="hidden sm:contents">
        <Readout label="Cost">{formatCost(analysis.monthlyCostUsd)}</Readout>
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
