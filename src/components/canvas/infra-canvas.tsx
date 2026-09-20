"use client";

import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MarkerType,
  ReactFlow,
  useReactFlow,
  type NodeTypes,
  type EdgeTypes,
} from "@xyflow/react";
import { useCallback, useRef, type DragEvent } from "react";
import { useWorkspaceStore } from "@/store/workspace-store";
import { FlowEdge } from "./flow-edge";
import { GroupNode } from "./group-node";
import { LoadGeneratorNode } from "./load-generator-node";
import { NoteNode } from "./note-node";
import { ResourceNode } from "./resource-node";

export const DND_MIME = "application/infraflow";

const nodeTypes: NodeTypes = {
  resource: ResourceNode,
  loadGenerator: LoadGeneratorNode,
  note: NoteNode,
  group: GroupNode,
};

const edgeTypes: EdgeTypes = {
  flow: FlowEdge,
};

const defaultEdgeOptions = {
  type: "flow",
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "var(--border)" },
};

export function InfraCanvas() {
  const wrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  const nodes = useWorkspaceStore((state) => state.nodes);
  const edges = useWorkspaceStore((state) => state.edges);
  const onNodesChange = useWorkspaceStore((state) => state.onNodesChange);
  const onEdgesChange = useWorkspaceStore((state) => state.onEdgesChange);
  const onConnect = useWorkspaceStore((state) => state.onConnect);
  const addResource = useWorkspaceStore((state) => state.addResource);
  const addCanvasElement = useWorkspaceStore((state) => state.addCanvasElement);
  const commit = useWorkspaceStore((state) => state.commit);

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const payload = event.dataTransfer.getData(DND_MIME);
      if (!payload) return;

      // O node nasce centrado no ponteiro (PRD §11).
      const position = screenToFlowPosition({ x: event.clientX - 105, y: event.clientY - 40 });

      if (payload.startsWith("canvas:")) {
        addCanvasElement(payload.slice("canvas:".length) as "note" | "text" | "group", position);
        return;
      }
      addResource(payload, position);
    },
    [addCanvasElement, addResource, screenToFlowPosition],
  );

  const isEmpty = nodes.length === 0;

  return (
    <div ref={wrapper} className="relative size-full bg-canvas" onDrop={onDrop} onDragOver={onDragOver}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStart={commit}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={28}
        selectionOnDrag
        panOnDrag={[1, 2]}
        panOnScroll
        selectNodesOnDrag={false}
        multiSelectionKeyCode={["Meta", "Shift"]}
        deleteKeyCode={null}
        minZoom={0.2}
        maxZoom={2}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        attributionPosition="bottom-left"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--canvas-dot)" />
        <Controls
          position="bottom-right"
          showInteractive={false}
          className="!bottom-4 !right-4 !shadow-none [&>button]:!border-border [&>button]:!bg-panel [&>button]:!text-muted-foreground hover:[&>button]:!bg-accent"
        />
      </ReactFlow>

      {isEmpty && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <p className="text-sm text-muted-foreground">
            Arraste um recurso da biblioteca para começar.
          </p>
        </div>
      )}
    </div>
  );
}
