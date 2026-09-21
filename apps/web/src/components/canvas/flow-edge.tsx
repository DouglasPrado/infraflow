"use client";

import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import { memo } from "react";
import { formatCompactRps } from "@/lib/format";
import type { InfraEdgeData } from "@/lib/types";

/**
 * PRD §13 — o edge carrega o tipo de tráfego.
 * PRD §22 — sob carga vira um duto: engrossa e mostra a vazão simulada.
 */
function FlowEdgeComponent({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  selected,
  data,
}: EdgeProps<Edge<InfraEdgeData>>) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 14,
  });

  const rps = data?.rps;
  // Trecho fora do caminho da carga volta a mostrar o tipo de tráfego.
  const live = rps !== undefined && rps > 0;

  return (
    <>
      <BaseEdge
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: selected ? "var(--brand)" : live ? "var(--brand)" : "var(--border)",
          strokeWidth: live ? 1.75 : 1.25,
          opacity: live ? 0.85 : 1,
        }}
      />
      <EdgeLabelRenderer>
        <div
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          className="nodrag nopan pointer-events-none absolute rounded border bg-panel px-1.5 py-px text-[10px] leading-[1.4] text-muted-foreground"
        >
          {live ? (
            <span className="font-mono font-medium tabular-nums text-brand">
              {formatCompactRps(rps)} req/s
            </span>
          ) : (
            <span className="uppercase tracking-eyebrow">{data?.kind}</span>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const FlowEdge = memo(FlowEdgeComponent);
