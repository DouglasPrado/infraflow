"use client";

import { FileCode, FileJson, FileText, Play, Redo2, RotateCcw, Undo2 } from "lucide-react";
import { useReactFlow } from "@xyflow/react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { CATALOG, LOAD_GENERATOR_TYPE } from "@infraflow/registry";
import { resolveIcon } from "@/lib/icons";
import { EXPORT_FILES } from "@/lib/reports";
import { useWorkspaceStore } from "@/store/workspace-store";

const FILE_ICON = { markdown: FileText, json: FileJson, hcl: FileCode } as const;

/** PRD §9 — command palette (⌘K). */
export function CommandPalette({
  open,
  onOpenChange,
  onOpenFile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenFile: (file: string) => void;
}) {
  const { screenToFlowPosition } = useReactFlow();
  const addResource = useWorkspaceStore((state) => state.addResource);
  const undo = useWorkspaceStore((state) => state.undo);
  const redo = useWorkspaceStore((state) => state.redo);
  const startSimulation = useWorkspaceStore((state) => state.startSimulation);
  const resetSimulation = useWorkspaceStore((state) => state.resetSimulation);

  const run = (action: () => void) => {
    onOpenChange(false);
    action();
  };

  /** Novos recursos nascem no centro da viewport. */
  const centerPosition = () =>
    screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command Palette"
      description="Buscar recursos e ações"
    >
      <Command>
        <CommandInput placeholder="Buscar recursos e ações..." />
        <CommandList>
          <CommandEmpty>Nenhum resultado.</CommandEmpty>

          <CommandGroup heading="Ações">
            <CommandItem onSelect={() => run(startSimulation)}>
              <Play />
              Executar teste de carga
            </CommandItem>
            <CommandItem onSelect={() => run(resetSimulation)}>
              <RotateCcw />
              Reiniciar simulação
            </CommandItem>
            <CommandItem onSelect={() => run(undo)}>
              <Undo2 />
              Desfazer
            </CommandItem>
            <CommandItem onSelect={() => run(redo)}>
              <Redo2 />
              Refazer
            </CommandItem>
          </CommandGroup>

          <CommandGroup heading="Adicionar recurso">
            <CommandItem
              value="Load Generator"
              onSelect={() => run(() => addResource(LOAD_GENERATOR_TYPE, centerPosition()))}
            >
              <Play />
              Load Generator
            </CommandItem>
            {CATALOG.map((item) => {
              const icon = resolveIcon(item.icon);
              return (
                <CommandItem
                  key={item.type}
                  value={`${item.name} ${item.title} ${item.category}`}
                  onSelect={() => run(() => addResource(item.type, centerPosition()))}
                >
                  <icon.Icon />
                  {item.name}
                  <span className="ml-auto text-[11px] text-muted-foreground">{item.title}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>

          <CommandGroup heading="Exportar">
            {EXPORT_FILES.map((file) => {
              const Icon = FILE_ICON[file.language];
              return (
                <CommandItem
                  key={file.name}
                  value={file.name}
                  onSelect={() => run(() => onOpenFile(file.name))}
                >
                  <Icon />
                  {file.name}
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
