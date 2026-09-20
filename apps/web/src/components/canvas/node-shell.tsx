import { Handle, Position } from "@xyflow/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { NodeState } from "@/lib/types";

/**
 * PRD §12 — estados do node.
 * Em repouso a arquitetura é monocromática; a cor só aparece sob carga, e é isso
 * que faz o gargalo saltar do canvas (design.md §2).
 */
const STATE_RING: Record<NodeState, string> = {
  default: "border-border",
  healthy: "border-state-healthy/45",
  running: "border-state-healthy/45",
  warning: "border-state-warning/70",
  error: "border-state-error/70",
  bottleneck: "border-state-bottleneck",
  disabled: "border-dashed border-state-idle",
};

export const STATE_DOT: Record<NodeState, string> = {
  default: "bg-state-idle",
  healthy: "bg-state-healthy",
  running: "bg-state-healthy",
  warning: "bg-state-warning",
  error: "bg-state-error",
  bottleneck: "bg-state-bottleneck",
  disabled: "bg-state-idle",
};

export const STATE_LABEL: Record<NodeState, string> = {
  default: "Not tested",
  healthy: "Healthy",
  running: "Healthy",
  warning: "Warning",
  error: "Over capacity",
  bottleneck: "Bottleneck",
  disabled: "Disabled",
};

const HANDLE_CLASS =
  "!size-2 !rounded-full !border !border-muted-foreground/60 !bg-panel !opacity-0 !transition-opacity !duration-150 group-hover:!opacity-100";

/** Casca comum: quatro handles e o anel de estado. Em `ConnectionMode.Loose`
 *  cada handle funciona como origem e destino. */
export function NodeShell({
  state,
  selected,
  className,
  children,
}: {
  state: NodeState;
  selected?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "group relative w-[212px] overflow-hidden rounded-lg border bg-card text-card-foreground",
        "shadow-[0_1px_2px_-1px_oklch(0.2_0.02_248/0.10)] transition-[border-color,box-shadow] duration-150",
        STATE_RING[state],
        selected && "border-brand shadow-[0_0_0_3px_color-mix(in_oklch,var(--brand)_18%,transparent)]",
        state === "bottleneck" && "infraflow-pulse",
        state === "disabled" && "opacity-55",
        className,
      )}
    >
      <Handle id="top" type="target" position={Position.Top} className={HANDLE_CLASS} />
      <Handle id="left" type="target" position={Position.Left} className={HANDLE_CLASS} />
      {children}
      <Handle id="right" type="source" position={Position.Right} className={HANDLE_CLASS} />
      <Handle id="bottom" type="source" position={Position.Bottom} className={HANDLE_CLASS} />
    </div>
  );
}
