"use client";

import { type Node, type NodeProps } from "@xyflow/react";
import { Zap } from "lucide-react";
import { memo } from "react";
import { formatRps } from "@/lib/format";
import type { LoadGeneratorNodeData } from "@/lib/types";
import { NodeShell } from "./node-shell";

/**
 * PRD §15 — a origem do teste.
 * É o único node colorido em repouso: num canvas monocromático, a fonte de
 * energia precisa ser inconfundível (PRD §68).
 */
function LoadGeneratorNodeComponent({
  data,
  selected,
}: NodeProps<Node<LoadGeneratorNodeData, "loadGenerator">>) {
  const { profile, endpoints, slo } = data;
  const live = data.rps !== undefined;

  return (
    <NodeShell state={data.state} selected={selected} className="border-brand/35 bg-brand-subtle">
      <div className="flex items-center gap-2.5 px-3 pt-2.5">
        <Zap className="size-4 shrink-0 text-brand" strokeWidth={1.75} fill="currentColor" />
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase leading-none tracking-eyebrow text-brand">
            {profile.type} test
          </div>
          <div className="mt-1.5 truncate text-sm font-medium leading-tight">{data.name}</div>
        </div>
      </div>

      <div className="px-3 pt-2.5">
        <div className="flex items-baseline gap-1.5 font-mono tabular-nums">
          <span className="text-[13px] font-medium">{formatRps(profile.startRps)}</span>
          <span aria-hidden className="text-muted-foreground">
            →
          </span>
          <span className="text-[13px] font-medium">{formatRps(profile.maxRps)}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-2 font-mono text-[11px] tabular-nums text-muted-foreground">
          <span>{endpoints.length} endpoints</span>
          <span aria-hidden className="text-border">
            ·
          </span>
          <span>p95 &lt; {slo.p95Ms}ms</span>
        </div>
      </div>

      <div className="px-3 pb-2.5 pt-2.5">
        {live ? (
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">Emitindo</span>
            <span className="font-mono text-[11px] font-medium tabular-nums text-brand">
              {formatRps(data.rps ?? 0)}
            </span>
          </div>
        ) : (
          <span className="text-[11px] text-muted-foreground">Origem do teste</span>
        )}
      </div>
    </NodeShell>
  );
}

export const LoadGeneratorNode = memo(LoadGeneratorNodeComponent);
