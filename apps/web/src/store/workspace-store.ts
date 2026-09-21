"use client";

import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type XYPosition,
} from "@xyflow/react";
import { create } from "zustand";
import { getCatalogItem, LOAD_GENERATOR_TYPE } from "@infraflow/registry";
import type { ArchitectureDocument } from "@infraflow/schema";
import { createDemoEdges, createDemoNodes, DEMO_LOAD_GENERATOR } from "@/lib/demo-architecture";
import { fromDocument } from "@/lib/document";
import { simulate, type SimulationResult } from "@/lib/simulation";
import type {
  EdgeKind,
  InfraEdge,
  InfraNode,
  LoadGeneratorNodeData,
  PropertyValue,
  ResourceNodeData,
} from "@/lib/types";

export type InspectorTab = "properties" | "analysis" | "commands";
export type SimulationStatus = "idle" | "running" | "done";

/** Estado do autosave, exibido na top bar (PRD §71). */
export type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

/** Passo da simulação renderizado na UI (PRD §20). */
export interface RunLogEntry {
  rps: number;
  verdict: "ok" | "warning" | "fail";
}

interface Snapshot {
  nodes: InfraNode[];
  edges: InfraEdge[];
}

interface WorkspaceState extends Snapshot {
  // --- projeto (PRD §9) ---
  projectName: string;
  provider: string;
  environment: string;
  dirty: boolean;

  // --- persistência (PRD §71) ---
  architectureId: string | null;
  saveStatus: SaveStatus;
  saveError: string | null;
  savedAt: number | null;
  hydrate: (architectureId: string, document: ArchitectureDocument) => void;
  setSaveStatus: (status: SaveStatus, error?: string | null) => void;

  // --- canvas ---
  onNodesChange: (changes: NodeChange<InfraNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<InfraEdge>[]) => void;
  onConnect: (connection: Connection) => void;
  addResource: (type: string, position: XYPosition) => string;
  addCanvasElement: (kind: "note" | "text" | "group", position: XYPosition) => string;
  updateResourceProp: (nodeId: string, key: string, value: PropertyValue) => void;
  renameNode: (nodeId: string, name: string) => void;
  updateLoadGenerator: (nodeId: string, patch: Partial<LoadGeneratorNodeData>) => void;
  updateNoteText: (nodeId: string, text: string) => void;
  swapAlternative: (nodeId: string) => void;
  deleteSelected: () => void;
  selectNode: (nodeId: string) => void;
  /** PRD §36 — a medição volta para o grafo. */
  markObserved: (nodeId: string) => void;

  // --- histórico (PRD §57) ---
  commit: () => void;
  undo: () => void;
  redo: () => void;
  past: Snapshot[];
  future: Snapshot[];

  // --- inspector ---
  inspectorTab: InspectorTab;
  setInspectorTab: (tab: InspectorTab) => void;

  // --- simulação (PRD §20, §61) ---
  simulationStatus: SimulationStatus;
  runLog: RunLogEntry[];
  currentRps: number | null;
  result: SimulationResult | null;
  startSimulation: () => void;
  advanceSimulation: () => boolean;
  resetSimulation: () => void;

  save: () => void;
}

let nodeSeq = 0;
const nextId = (prefix: string) => `${prefix}-${++nodeSeq}-${Date.now().toString(36)}`;

const snapshot = (state: Snapshot): Snapshot => ({
  nodes: state.nodes.map((node) => ({ ...node, data: { ...node.data } })) as InfraNode[],
  edges: state.edges.map((edge) => ({ ...edge, data: edge.data ? { ...edge.data } : undefined })),
});

/** Tipo de tráfego inferido pela categoria do destino (PRD §13). */
function edgeKindFor(target: InfraNode | undefined): EdgeKind {
  if (!target || target.type !== "resource") return "HTTP";
  switch (getCatalogItem(target.data.type)?.category) {
    case "database":
      return "Database";
    case "cache":
      return "TCP";
    case "storage":
      return "Storage";
    case "queue":
      return "Queue";
    default:
      return "HTTP";
  }
}

const HISTORY_LIMIT = 50;

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  nodes: createDemoNodes(),
  edges: createDemoEdges(),
  past: [],
  future: [],

  projectName: "Arquitetura Web",
  provider: "AWS",
  environment: "dev",
  dirty: false,

  architectureId: null,
  saveStatus: "idle",
  saveError: null,
  savedAt: null,

  /**
   * Carrega o documento vindo da API. Zera o histórico e a simulação: undo não
   * deve atravessar o carregamento, e o resultado do teste é da sessão anterior.
   */
  hydrate: (architectureId, document) => {
    const { nodes, edges } = fromDocument(document);
    set({
      architectureId,
      nodes,
      edges,
      projectName: document.name,
      provider: document.provider,
      environment: document.environment,
      past: [],
      future: [],
      dirty: false,
      saveStatus: "saved",
      saveError: null,
      savedAt: Date.now(),
      simulationStatus: "idle",
      runLog: [],
      currentRps: null,
      result: null,
    });
  },

  setSaveStatus: (status, error = null) =>
    set({
      saveStatus: status,
      saveError: error,
      ...(status === "saved" ? { savedAt: Date.now(), dirty: false } : {}),
    }),

  inspectorTab: "properties",
  simulationStatus: "idle",
  runLog: [],
  currentRps: null,
  result: null,

  commit: () => {
    const { nodes, edges, past } = get();
    set({
      past: [...past, snapshot({ nodes, edges })].slice(-HISTORY_LIMIT),
      future: [],
      dirty: true,
    });
  },

  undo: () => {
    const { past, future, nodes, edges } = get();
    const previous = past.at(-1);
    if (!previous) return;
    set({
      nodes: previous.nodes,
      edges: previous.edges,
      past: past.slice(0, -1),
      future: [snapshot({ nodes, edges }), ...future].slice(0, HISTORY_LIMIT),
      dirty: true,
    });
  },

  redo: () => {
    const { past, future, nodes, edges } = get();
    const next = future[0];
    if (!next) return;
    set({
      nodes: next.nodes,
      edges: next.edges,
      past: [...past, snapshot({ nodes, edges })].slice(-HISTORY_LIMIT),
      future: future.slice(1),
      dirty: true,
    });
  },

  onNodesChange: (changes) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) as InfraNode[] });
    if (changes.some((change) => change.type !== "select" && change.type !== "dimensions")) {
      set({ dirty: true });
    }
  },

  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) });
    if (changes.some((change) => change.type !== "select")) set({ dirty: true });
  },

  onConnect: (connection) => {
    get().commit();
    const target = get().nodes.find((node) => node.id === connection.target);
    set({
      edges: addEdge(
        { ...connection, type: "flow", data: { kind: edgeKindFor(target) } },
        get().edges,
      ),
    });
  },

  addResource: (type, position) => {
    get().commit();
    const id = type === LOAD_GENERATOR_TYPE ? nextId("loadgen") : nextId("node");

    if (type === LOAD_GENERATOR_TYPE) {
      const node: InfraNode = {
        id,
        type: "loadGenerator",
        position,
        selected: true,
        data: { ...DEMO_LOAD_GENERATOR, name: "Capacity Test", state: "default" },
      };
      set({ nodes: [...deselectAll(get().nodes), node], inspectorTab: "properties" });
      return id;
    }

    const item = getCatalogItem(type);
    if (!item) return id;

    const data: ResourceNodeData = {
      type,
      name: item.name.toLowerCase().replace(/\s+/g, "-"),
      props: { ...item.defaults },
      state: "default",
    };

    set({
      nodes: [...deselectAll(get().nodes), { id, type: "resource", position, selected: true, data }],
      inspectorTab: "properties",
    });
    return id;
  },

  addCanvasElement: (kind, position) => {
    get().commit();
    const id = nextId(kind);

    const node: InfraNode =
      kind === "group"
        ? {
            id,
            type: "group",
            position,
            style: { width: 360, height: 220 },
            selected: true,
            data: { label: "Group" },
          }
        : {
            id,
            type: "note",
            position,
            style: { width: 210, height: 120 },
            selected: true,
            data: { variant: kind === "note" ? "sticky" : "text", text: "" },
          };

    set({ nodes: [...deselectAll(get().nodes), node], inspectorTab: "properties" });
    return id;
  },

  updateResourceProp: (nodeId, key, value) => {
    get().commit();
    set({
      nodes: get().nodes.map((node) =>
        node.id === nodeId && node.type === "resource"
          ? { ...node, data: { ...node.data, props: { ...node.data.props, [key]: value } } }
          : node,
      ) as InfraNode[],
    });
  },

  renameNode: (nodeId, name) => {
    set({
      nodes: get().nodes.map((node) =>
        node.id === nodeId && (node.type === "resource" || node.type === "loadGenerator")
          ? { ...node, data: { ...node.data, name } }
          : node.id === nodeId && node.type === "group"
            ? { ...node, data: { ...node.data, label: name } }
            : node,
      ) as InfraNode[],
      dirty: true,
    });
  },

  updateLoadGenerator: (nodeId, patch) => {
    get().commit();
    set({
      nodes: get().nodes.map((node) =>
        node.id === nodeId && node.type === "loadGenerator"
          ? { ...node, data: { ...node.data, ...patch } }
          : node,
      ) as InfraNode[],
    });
  },

  updateNoteText: (nodeId, text) => {
    set({
      nodes: get().nodes.map((node) =>
        node.id === nodeId && node.type === "note" ? { ...node, data: { ...node.data, text } } : node,
      ) as InfraNode[],
      dirty: true,
    });
  },

  /** PRD §29 — troca o recurso pela alternativa equivalente. */
  swapAlternative: (nodeId) => {
    const node = get().nodes.find((candidate) => candidate.id === nodeId);
    if (!node || node.type !== "resource") return;

    const alternativeType = getCatalogItem(node.data.type)?.alternative;
    const alternative = alternativeType ? getCatalogItem(alternativeType) : undefined;
    if (!alternative) return;

    get().commit();
    set({
      nodes: get().nodes.map((candidate) =>
        candidate.id === nodeId && candidate.type === "resource"
          ? {
              ...candidate,
              data: {
                ...candidate.data,
                type: alternative.type,
                name: alternative.name.toLowerCase().replace(/\s+/g, "-"),
                props: { ...alternative.defaults },
              },
            }
          : candidate,
      ) as InfraNode[],
    });
  },

  deleteSelected: () => {
    const selected = new Set(get().nodes.filter((node) => node.selected).map((node) => node.id));
    const selectedEdges = new Set(get().edges.filter((edge) => edge.selected).map((edge) => edge.id));
    if (selected.size === 0 && selectedEdges.size === 0) return;

    get().commit();
    set({
      nodes: get().nodes.filter((node) => !selected.has(node.id) && !(node.parentId && selected.has(node.parentId))),
      edges: get().edges.filter(
        (edge) => !selectedEdges.has(edge.id) && !selected.has(edge.source) && !selected.has(edge.target),
      ),
    });
  },

  selectNode: (nodeId) => {
    set({
      nodes: get().nodes.map((node) => ({ ...node, selected: node.id === nodeId })) as InfraNode[],
      inspectorTab: "properties",
    });
  },

  /**
   * Destaca no canvas o recurso que a **medição** apontou (PRD §36, §79).
   *
   * Ação explícita do usuário, não automática: o canvas também carrega o
   * estado da simulação, e pintar sozinho faria as duas leituras brigarem sem
   * que ninguém soubesse qual está na tela.
   */
  markObserved: (nodeId) => {
    set({
      simulationStatus: "idle",
      runLog: [],
      currentRps: null,
      nodes: get().nodes.map((node) => {
        if (node.type !== "resource") return node;
        return {
          ...node,
          data: {
            ...node.data,
            state: node.id === nodeId ? "bottleneck" : "default",
            utilization: undefined,
            rps: undefined,
          },
          selected: node.id === nodeId,
        };
      }) as InfraNode[],
    });
  },

  setInspectorTab: (tab) => set({ inspectorTab: tab }),

  startSimulation: () => {
    const { nodes, edges } = get();
    const result = simulate(nodes, edges);
    if (result.steps.length === 0) return;

    set({
      result,
      simulationStatus: "running",
      runLog: [],
      currentRps: null,
      inspectorTab: "analysis",
    });
  },

  /** Avança um degrau. Devolve `false` quando a simulação termina. */
  advanceSimulation: () => {
    const { result, runLog } = get();
    if (!result) return false;

    const step = result.steps[runLog.length];
    if (!step) {
      set({ simulationStatus: "done" });
      return false;
    }

    const byNode = new Map(step.readings.map((reading) => [reading.nodeId, reading]));

    set({
      currentRps: step.rps,
      runLog: [...runLog, { rps: step.rps, verdict: step.verdict }],
      nodes: get().nodes.map((node) => {
        if (node.type === "loadGenerator") {
          return { ...node, data: { ...node.data, state: "running", rps: step.rps } };
        }
        if (node.type !== "resource") return node;
        const reading = byNode.get(node.id);
        if (!reading) return node;
        return {
          ...node,
          data: {
            ...node.data,
            state: reading.state,
            utilization: reading.utilization,
            rps: step.rps,
          },
        };
      }) as InfraNode[],
      // Cada trecho exibe a sua própria vazão: um CDN absorve parte da carga,
      // então o que chega à origem é menor que o que foi gerado (PRD §22).
      edges: get().edges.map((edge) => {
        const flow = step.edgeReadings.find(
          (reading) => reading.source === edge.source && reading.target === edge.target,
        );
        return {
          ...edge,
          data: { ...(edge.data ?? { kind: "HTTP" as EdgeKind }), rps: flow?.rps },
        };
      }),
    });

    if (runLog.length + 1 >= result.steps.length) set({ simulationStatus: "done" });
    return true;
  },

  resetSimulation: () => {
    set({
      simulationStatus: "idle",
      runLog: [],
      currentRps: null,
      result: null,
      nodes: get().nodes.map((node) => {
        if (node.type === "resource") {
          return {
            ...node,
            data: { ...node.data, state: "default", utilization: undefined, rps: undefined },
          };
        }
        if (node.type === "loadGenerator") {
          return { ...node, data: { ...node.data, state: "default", rps: undefined } };
        }
        return node;
      }) as InfraNode[],
      edges: get().edges.map((edge) => ({
        ...edge,
        data: { ...(edge.data ?? { kind: "HTTP" as EdgeKind }), rps: undefined },
      })),
    });
  },

  /** Força um ciclo de autosave — o ⌘S do usuário. */
  save: () => set({ dirty: true, saveStatus: "pending" }),
}));

function deselectAll(nodes: InfraNode[]): InfraNode[] {
  return nodes.map((node) => (node.selected ? { ...node, selected: false } : node));
}
