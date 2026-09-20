"use client";

import { ReactFlowProvider } from "@xyflow/react";
import type { ArchitectureDocument } from "@infraflow/schema";
import { useCallback, useEffect, useState } from "react";
import { InfraCanvas } from "@/components/canvas/infra-canvas";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAutosave } from "@/hooks/use-autosave";
import type { SessionUser } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace-store";
import { CommandPalette } from "./command-palette";
import { ComponentLibrary } from "./component-library";
import { ExportSheet } from "./export-sheet";
import { AssistantSheet } from "./assistant-sheet";
import { RunSheet } from "./run-sheet";
import { VersionsSheet } from "./versions-sheet";
import { Inspector } from "./inspector";
import { StatusBar } from "./status-bar";
import { TopBar } from "./top-bar";

/** Intervalo entre degraus da simulação (design.md §8). */
const STEP_MS = 600;

/** Percorre os degraus já calculados pelo store (PRD §61). */
function useSimulationRunner() {
  const status = useWorkspaceStore((state) => state.simulationStatus);
  const advance = useWorkspaceStore((state) => state.advanceSimulation);

  useEffect(() => {
    if (status !== "running") return;
    const timer = setInterval(() => advance(), STEP_MS);
    return () => clearInterval(timer);
  }, [status, advance]);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function WorkspaceShellInner({ user }: { user: SessionUser }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [exportFile, setExportFile] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);

  useSimulationRunner();
  useAutosave();

  const undo = useWorkspaceStore((state) => state.undo);
  const redo = useWorkspaceStore((state) => state.redo);
  const deleteSelected = useWorkspaceStore((state) => state.deleteSelected);
  const save = useWorkspaceStore((state) => state.save);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;

      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }

      if (isEditableTarget(event.target)) return;

      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }

      if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        save();
        return;
      }

      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        deleteSelected();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteSelected, redo, save, undo]);

  const openFile = useCallback((file?: string) => setExportFile(file ?? "ARCHITECTURE.md"), []);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TopBar
        user={user}
        onOpenExport={openFile}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenVersions={() => setVersionsOpen(true)}
        onOpenAssistant={() => setAssistantOpen(true)}
      />

      <div className="flex min-h-0 flex-1">
        <ComponentLibrary />
        <main className="min-w-0 flex-1">
          <InfraCanvas />
        </main>
        <Inspector onOpenFile={openFile} onOpenRun={setOpenRun} />
      </div>

      <StatusBar />

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onOpenFile={openFile} />
      <ExportSheet file={exportFile} onOpenChange={(open) => !open && setExportFile(null)} />
      <RunSheet runId={openRun} onOpenChange={(open) => !open && setOpenRun(null)} />
      <VersionsSheet open={versionsOpen} onOpenChange={setVersionsOpen} />
      <AssistantSheet open={assistantOpen} onOpenChange={setAssistantOpen} />
    </div>
  );
}

/** PRD §8 — estrutura do workspace. */
export function WorkspaceShell({
  architectureId,
  document,
  user,
}: {
  architectureId: string;
  document: ArchitectureDocument;
  user: SessionUser;
}) {
  const hydrate = useWorkspaceStore((state) => state.hydrate);
  const loadedId = useWorkspaceStore((state) => state.architectureId);

  // Carrega antes da primeira pintura, para o canvas nunca mostrar a demo
  // local no lugar do que está gravado.
  if (loadedId !== architectureId) hydrate(architectureId, document);

  return (
    <ReactFlowProvider>
      <TooltipProvider delayDuration={300}>
        <WorkspaceShellInner user={user} />
      </TooltipProvider>
    </ReactFlowProvider>
  );
}
