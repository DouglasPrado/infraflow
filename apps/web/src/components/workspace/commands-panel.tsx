"use client";

import { FileCode, FileJson, FileText, Info, TriangleAlert } from "lucide-react";
import { useMemo } from "react";
import { ARTIFACT_GROUPS, compileWarnings } from "@/lib/artifacts";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/store/workspace-store";
import { FieldGroup } from "./property-field";

function iconFor(name: string) {
  if (name.endsWith(".json")) return FileJson;
  if (name.endsWith(".md")) return FileText;
  return FileCode;
}

/**
 * PRD §23 — terceira aba do inspector.
 * PRD §30 — Export Panel: os artefatos que a arquitetura gera.
 */
export function CommandsPanel({ onOpenFile }: { onOpenFile: (file: string) => void }) {
  const nodes = useWorkspaceStore((state) => state.nodes);
  const edges = useWorkspaceStore((state) => state.edges);
  const projectName = useWorkspaceStore((state) => state.projectName);
  const provider = useWorkspaceStore((state) => state.provider);
  const environment = useWorkspaceStore((state) => state.environment);

  const warnings = useMemo(
    () => compileWarnings({ name: projectName, provider, environment }, nodes, edges),
    [projectName, provider, environment, nodes, edges],
  );

  return (
    <div className="space-y-5 p-3">
      {ARTIFACT_GROUPS.map((group) => (
        <FieldGroup key={group.kind} title={group.title}>
          <div className="space-y-1">
            {group.files.map((file) => {
              const Icon = iconFor(file.name);
              return (
                <button
                  key={file.name}
                  type="button"
                  onClick={() => onOpenFile(file.name)}
                  className="flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors duration-120 hover:bg-accent"
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[12px]">{file.name}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {file.description}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </FieldGroup>
      ))}

      {/* PRD §74 — o que o compiler não traduziu nunca some em silêncio. */}
      {warnings.length > 0 && (
        <FieldGroup title="Compilação">
          <ul className="space-y-2">
            {warnings.map((warning) => (
              <li key={`${warning.code}-${warning.nodeId ?? "geral"}`} className="flex gap-1.5">
                {warning.code === "assumption" ? (
                  <Info className="mt-0.5 size-3 shrink-0 text-muted-foreground" strokeWidth={2.25} />
                ) : (
                  <TriangleAlert
                    className={cn(
                      "mt-0.5 size-3 shrink-0",
                      warning.code === "unsupported-resource"
                        ? "text-state-warning"
                        : "text-muted-foreground",
                    )}
                    strokeWidth={2.25}
                  />
                )}
                <span className="min-w-0 space-y-0.5">
                  <span className="block text-[11px] leading-relaxed">{warning.message}</span>
                  {warning.hint && (
                    <span className="block text-[10px] leading-relaxed text-muted-foreground">
                      {warning.hint}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </FieldGroup>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Tudo é gerado pela API a partir da versão gravada. O
        <code className="mx-1 font-mono">architecture.json</code>
        tem prioridade sobre os documentos (PRD §33).
      </p>
    </div>
  );
}
