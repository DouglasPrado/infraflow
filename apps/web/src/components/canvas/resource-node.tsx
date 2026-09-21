"use client";

import { type Node, type NodeProps } from "@xyflow/react";
import { ArrowLeftRight, Circle } from "lucide-react";
import { memo } from "react";
import { getCatalogItem } from "@infraflow/registry";
import { ServiceIcon } from "@/components/service-icon";
import type { CatalogItem, ResourceNodeData } from "@/lib/types";
import { cn } from "@/lib/utils";
import { NodeShell, STATE_DOT, STATE_LABEL } from "./node-shell";
import { SaturationMeter } from "./saturation-meter";

const PROVIDER_LABEL: Record<string, string> = {
  aws: "AWS",
  opensource: "Open Source",
};

/** Especificações mostradas no corpo compacto, sem abrir propriedades (PRD §12). */
function specs(item: CatalogItem | undefined, props: ResourceNodeData["props"]): string[] {
  if (!item) return [];

  return item.summaryKeys.flatMap((key) => {
    const value = props[key];
    if (value === undefined || value === "") return [];

    if (["desiredReplicas", "replicas", "instances", "nodes", "brokers"].includes(key)) {
      return [`${value}×`];
    }

    const field = item.properties.find((property) => property.key === key);
    const unit = field?.kind === "number" ? (field.unit ?? "") : "";
    return [unit ? `${value}${unit}` : String(value)];
  });
}

function ResourceNodeComponent({ data, selected }: NodeProps<Node<ResourceNodeData, "resource">>) {
  const item = getCatalogItem(data.type);
  const alternative = item?.alternative ? getCatalogItem(item.alternative) : undefined;
  const detail = specs(item, data.props);
  const tested = data.utilization !== undefined;

  return (
    <NodeShell state={data.state} selected={selected}>
      <div className="flex items-start gap-2.5 px-3 pt-2.5">
        {item ? (
          <ServiceIcon icon={item.icon} label={item.title} className="mt-px size-5" />
        ) : (
          <Circle className="mt-px size-5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-medium uppercase leading-none tracking-eyebrow text-muted-foreground">
            {PROVIDER_LABEL[item?.provider ?? ""] ?? "—"}
          </div>
          <div className="mt-1.5 truncate text-sm font-medium leading-tight" title={item?.title ?? data.type}>
            {item?.title ?? data.type}
          </div>
          <div className="truncate font-mono text-[11px] leading-tight text-muted-foreground">{data.name}</div>
        </div>
      </div>

      {detail.length > 0 && (
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 px-3 pt-2 font-mono text-[11px] tabular-nums text-muted-foreground">
          {detail.map((line, index) => (
            <span key={line} className="flex items-center gap-2">
              {index > 0 && <span aria-hidden className="text-muted-foreground/40">·</span>}
              {line}
            </span>
          ))}
        </div>
      )}

      {alternative && (
        <div className="flex items-center gap-1.5 px-3 pt-2 text-[10px] text-muted-foreground">
          <ArrowLeftRight className="size-3 shrink-0" strokeWidth={1.75} />
          <span className="truncate">{alternative.name}</span>
        </div>
      )}

      <div className="px-3 pb-3 pt-2.5">
        <div className="flex items-baseline justify-between gap-2">
          {/* Com o medidor presente, o ponto repetiria a cor da barra. */}
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {!tested && <span className={cn("size-1.5 shrink-0 rounded-full", STATE_DOT[data.state])} />}
            {STATE_LABEL[data.state]}
          </span>
          {tested && (
            <span
              className={cn(
                "font-mono text-[11px] font-medium tabular-nums",
                (data.utilization ?? 0) >= 1
                  ? "text-state-bottleneck"
                  : (data.utilization ?? 0) >= 0.9
                    ? "text-state-warning"
                    : "text-muted-foreground",
              )}
            >
              {Math.round((data.utilization ?? 0) * 100)}%
            </span>
          )}
        </div>
      </div>

      {/* O medidor sangra na borda: é a primeira coisa que se lê no canvas. */}
      {tested && (
        <SaturationMeter
          utilization={data.utilization ?? 0}
          className="absolute inset-x-0 bottom-0"
          height="h-[5px]"
          square
        />
      )}
    </NodeShell>
  );
}

export const ResourceNode = memo(ResourceNodeComponent);
