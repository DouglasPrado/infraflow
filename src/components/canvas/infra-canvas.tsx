"use client";

import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MarkerType,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
  type NodeTypes,
  type EdgeTypes,
} from "@xyflow/react";
import { useCallback, useEffect, useRef, type DragEvent } from "react";
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

const FIT_VIEW_OPTIONS = { padding: 0.18 };

export function InfraCanvas() {
  const wrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();

  /**
   * O `fitView` da montagem roda antes dos nodes serem medidos: as alturas ainda
   * dependem do carregamento da fonte, então ele calcula um zoom grande demais e
   * a arquitetura vaza para fora do canvas. Refazemos o fit uma única vez, quando
   * os nodes já têm dimensão real.
   */
  const nodesInitialized = useNodesInitialized();
  const fitted = useRef(false);

  useEffect(() => {
    if (!nodesInitialized || fitted.current) return;
    fitted.current = true;

    let cancelled = false;
    const run = () => {
      if (!cancelled) fitView(FIT_VIEW_OPTIONS);
    };

    const fonts = document.fonts;
    if (fonts?.status === "loaded") run();
    else fonts?.ready.then(run).catch(run);

    return () => {
      cancelled = true;
    };
  }, [fitView, nodesInitialized]);

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
        fitViewOptions={FIT_VIEW_OPTIONS}
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
