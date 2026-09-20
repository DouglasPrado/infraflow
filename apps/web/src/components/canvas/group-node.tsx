"use client";

import { NodeResizer, type Node, type NodeProps } from "@xyflow/react";
import { memo } from "react";
import type { GroupNodeData } from "@/lib/types";
import { cn } from "@/lib/utils";

/** PRD §28 — container visual que agrupa recursos relacionados. */
function GroupNodeComponent({ data, selected }: NodeProps<Node<GroupNodeData, "group">>) {
  return (
    <div
      className={cn(
        "size-full rounded-xl border border-dashed border-border bg-muted/30 transition-colors duration-120",
        selected && "border-brand/60 bg-brand/5",
      )}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={220}
        minHeight={140}
        lineClassName="!border-brand"
        handleClassName="!size-2 !border-brand !bg-panel"
      />
      <div className="px-3 pt-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {data.label}
      </div>
    </div>
  );
}

export const GroupNode = memo(GroupNodeComponent);
