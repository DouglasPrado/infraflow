"use client";

import { FileJson, FileText } from "lucide-react";
import { REPORT_FILES } from "@infraflow/report-generator";
import { FieldGroup } from "./property-field";

const FILE_ICON = {
  markdown: FileText,
  json: FileJson,
} as const;

/**
 * PRD §23 — terceira aba do inspector.
 * PRD §30 — Export Panel: lista os artefatos que a arquitetura pode gerar.
 */
export function CommandsPanel({ onOpenFile }: { onOpenFile: (file: string) => void }) {
  return (
    <div className="space-y-5 p-3">
      <FieldGroup title="Exportação">
        <div className="space-y-1">
          {REPORT_FILES.map((file) => {
            const Icon = FILE_ICON[file.language];
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
                  <div className="truncate text-[11px] text-muted-foreground">{file.description}</div>
                </div>
              </button>
            );
          })}
        </div>
      </FieldGroup>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Os artefatos são gerados pela API a partir da versão gravada. O
        <code className="mx-1 font-mono">architecture.json</code>
        tem prioridade sobre os documentos (PRD §33).
      </p>
    </div>
  );
}
