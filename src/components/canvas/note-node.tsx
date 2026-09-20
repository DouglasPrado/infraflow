"use client";

import { NodeResizer, type Node, type NodeProps } from "@xyflow/react";
import { memo } from "react";
import { useWorkspaceStore } from "@/store/workspace-store";
import type { NoteNodeData } from "@/lib/types";
import { cn } from "@/lib/utils";

/** PRD §27 — elementos visuais que não representam infraestrutura. */
function NoteNodeComponent({ id, data, selected }: NodeProps<Node<NoteNodeData, "note">>) {
  const updateNoteText = useWorkspaceStore((state) => state.updateNoteText);
  const isSticky = data.variant === "sticky";

  return (
    <div
      className={cn(
        "size-full min-h-[90px] rounded-lg p-2.5 transition-colors duration-150",
        isSticky
          ? "border border-border bg-secondary/80 shadow-[0_1px_2px_-1px_oklch(0.2_0.02_248/0.08)]"
          : "border border-transparent bg-transparent",
        selected && "ring-2 ring-brand/30",
      )}
    >
      <NodeResizer isVisible={selected} minWidth={140} minHeight={70} lineClassName="!border-brand" handleClassName="!size-2 !border-brand !bg-panel" />
      <textarea
        value={data.text}
        onChange={(event) => updateNoteText(id, event.target.value)}
        placeholder={isSticky ? "Nota..." : "Texto..."}
        className={cn(
          "nodrag h-full w-full resize-none bg-transparent text-[12px] leading-relaxed outline-none placeholder:text-muted-foreground/60",
          !isSticky && "font-medium",
        )}
      />
    </div>
  );
}

export const NoteNode = memo(NoteNodeComponent);
