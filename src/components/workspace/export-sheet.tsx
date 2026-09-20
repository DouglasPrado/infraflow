"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { EXPORT_FILES, renderReport } from "@/lib/reports";
import { useWorkspaceStore } from "@/store/workspace-store";

/** PRD §31 — preview do artefato em drawer. */
export function ExportSheet({
  file,
  onOpenChange,
}: {
  file: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);

  const nodes = useWorkspaceStore((state) => state.nodes);
  const edges = useWorkspaceStore((state) => state.edges);
  const result = useWorkspaceStore((state) => state.result);
  const projectName = useWorkspaceStore((state) => state.projectName);
  const environment = useWorkspaceStore((state) => state.environment);

  const meta = EXPORT_FILES.find((candidate) => candidate.name === file);
  const content = file ? renderReport(file, { nodes, edges, result, projectName, environment }) : "";

  const copy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Sheet open={file !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-2xl">
        <SheetHeader className="border-b">
          <SheetTitle className="font-mono text-sm">{file}</SheetTitle>
          <SheetDescription>{meta?.description}</SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <pre className="whitespace-pre-wrap break-words p-4 font-mono text-[12px] leading-relaxed">
            {content}
          </pre>
        </ScrollArea>

        <div className="flex justify-end border-t p-3">
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={copy}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copiado" : "Copiar"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
