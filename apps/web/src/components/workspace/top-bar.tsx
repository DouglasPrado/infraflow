"use client";

import { useReactFlow } from "@xyflow/react";
import {
  Check,
  CloudAlert,
  FileCode,
  FileText,
  LoaderCircle,
  LogOut,
  Play,
  Redo2,
  RotateCcw,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, type SessionUser } from "@/lib/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/store/workspace-store";

function IconAction({
  label,
  icon: Icon,
  onClick,
  disabled,
  className,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-7 text-muted-foreground", className)}
          onClick={onClick}
          disabled={disabled}
        >
          <Icon className="size-3.5" strokeWidth={1.75} />
          <span className="sr-only">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Marca: um traço vertical ganhando altura — a escada de carga (PRD §20). */
function Mark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-4 text-brand">
      <path
        d="M1.5 12.5h3v2h-3zM6 8.5h3v6H6zM10.5 2.5h3v12h-3z"
        fill="currentColor"
        opacity="0.35"
      />
      <path d="M1.5 12.5h3v2h-3zM6 8.5h3v6H6z" fill="currentColor" />
    </svg>
  );
}

/** Estado do autosave, em palavras (PRD §71). */
function SaveIndicator() {
  const status = useWorkspaceStore((state) => state.saveStatus);
  const error = useWorkspaceStore((state) => state.saveError);

  if (status === "error") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-state-error">
            <CloudAlert className="size-3.5" strokeWidth={1.75} />
            Não salvo
          </span>
        </TooltipTrigger>
        <TooltipContent>{error ?? "Falha ao salvar."}</TooltipContent>
      </Tooltip>
    );
  }

  if (status === "saving" || status === "pending") {
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" strokeWidth={1.75} />
        Salvando
      </span>
    );
  }

  if (status === "saved") {
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Check className="size-3.5 text-state-healthy" strokeWidth={2.25} />
        Salvo
      </span>
    );
  }

  return null;
}

function UserMenu({ user }: { user: SessionUser }) {
  const router = useRouter();

  const initials = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 rounded-full bg-secondary text-[11px] font-medium"
        >
          {initials || "?"}
          <span className="sr-only">Conta</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate text-sm font-medium">{user.name}</div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            void api.logout().finally(() => {
              router.replace("/login");
              router.refresh();
            });
          }}
        >
          <LogOut />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** PRD §9 — Top Bar. */
export function TopBar({
  user,
  onOpenExport,
  onOpenPalette,
}: {
  user: SessionUser;
  onOpenExport: (file?: string) => void;
  onOpenPalette: () => void;
}) {
  const { zoomIn, zoomOut } = useReactFlow();

  const projectName = useWorkspaceStore((state) => state.projectName);
  const provider = useWorkspaceStore((state) => state.provider);
  const environment = useWorkspaceStore((state) => state.environment);
  const canUndo = useWorkspaceStore((state) => state.past.length > 0);
  const canRedo = useWorkspaceStore((state) => state.future.length > 0);
  const undo = useWorkspaceStore((state) => state.undo);
  const redo = useWorkspaceStore((state) => state.redo);
  const setInspectorTab = useWorkspaceStore((state) => state.setInspectorTab);
  const startSimulation = useWorkspaceStore((state) => state.startSimulation);
  const resetSimulation = useWorkspaceStore((state) => state.resetSimulation);
  const simulationStatus = useWorkspaceStore((state) => state.simulationStatus);

  const running = simulationStatus === "running";

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-panel pl-3 pr-2">
      <div className="flex items-center gap-2">
        <Mark />
        <span className="text-sm font-semibold tracking-tight">InfraFlow</span>
      </div>

      <span aria-hidden className="mx-1 hidden h-4 w-px bg-border sm:block" />

      {/* Contexto do projeto: um bloco só, lido da esquerda para a direita. */}
      <div className="hidden items-baseline gap-2 sm:flex">
        <span className="text-sm font-medium">{projectName}</span>
        <Select value={provider} onValueChange={(value) => useWorkspaceStore.setState({ provider: value })}>
          <SelectTrigger
            size="sm"
            className="h-6 gap-1 border-0 bg-secondary px-2 text-[11px] font-medium shadow-none hover:bg-accent"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="AWS">AWS</SelectItem>
            <SelectItem value="Open Source">Open Source</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={environment}
          onValueChange={(value) => useWorkspaceStore.setState({ environment: value })}
        >
          <SelectTrigger
            size="sm"
            className="h-6 gap-1 border-0 bg-secondary px-2 font-mono text-[11px] shadow-none hover:bg-accent"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="dev" className="font-mono">
              dev
            </SelectItem>
            <SelectItem value="staging" className="font-mono">
              staging
            </SelectItem>
            <SelectItem value="prod" className="font-mono">
              prod
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="ml-auto flex items-center gap-1">
        {/* Gerar artefatos: três ações irmãs, agrupadas e silenciosas. */}
        <Button
          variant="ghost"
          size="sm"
          className="hidden h-7 px-2 text-muted-foreground hover:text-foreground lg:inline-flex"
          onClick={() => setInspectorTab("analysis")}
        >
          Analisar
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="hidden h-7 gap-1.5 px-2 text-muted-foreground hover:text-foreground lg:inline-flex"
          onClick={() => onOpenExport("ARCHITECTURE.md")}
        >
          <FileText className="size-3.5" strokeWidth={1.75} />
          Markdown
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="hidden h-7 gap-1.5 px-2 text-muted-foreground hover:text-foreground lg:inline-flex"
          onClick={() => onOpenExport("main.tf")}
        >
          <FileCode className="size-3.5" strokeWidth={1.75} />
          OpenTofu
        </Button>

        <span aria-hidden className="mx-1 hidden h-4 w-px bg-border lg:block" />

        <IconAction className="hidden text-muted-foreground lg:inline-flex" label="Desfazer" icon={Undo2} onClick={undo} disabled={!canUndo} />
        <IconAction className="hidden text-muted-foreground lg:inline-flex" label="Refazer" icon={Redo2} onClick={redo} disabled={!canRedo} />
        <IconAction className="hidden text-muted-foreground lg:inline-flex" label="Diminuir zoom" icon={ZoomOut} onClick={() => zoomOut()} />
        <IconAction className="hidden text-muted-foreground lg:inline-flex" label="Aumentar zoom" icon={ZoomIn} onClick={() => zoomIn()} />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 font-mono text-[11px] text-muted-foreground"
              onClick={onOpenPalette}
            >
              ⌘K
            </Button>
          </TooltipTrigger>
          <TooltipContent>Command palette</TooltipContent>
        </Tooltip>

        <span aria-hidden className="mx-1 hidden h-4 w-px bg-border sm:block" />

        <div className="hidden min-w-[74px] justify-end sm:flex">
          <SaveIndicator />
        </div>

        {/* Verbo do produto: a única ação preenchida da barra. */}
        <Button
          size="sm"
          className="h-7 gap-1.5 px-3"
          onClick={running ? resetSimulation : startSimulation}
          variant={running ? "secondary" : "default"}
        >
          {running ? (
            <RotateCcw className="size-3.5" strokeWidth={2} />
          ) : (
            <Play className="size-3.5" strokeWidth={2} fill="currentColor" />
          )}
          {running ? "Parar" : "Teste de carga"}
        </Button>

        <UserMenu user={user} />
      </div>
    </header>
  );
}
