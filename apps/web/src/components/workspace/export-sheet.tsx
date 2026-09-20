"use client";

import { Check, Copy, Download, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { describe as describeArtifact, kindOf } from "@/lib/artifacts";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api, API_BASE, ApiError } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace-store";

/**
 * PRD §30, §31 — Export Panel e preview do artefato.
 *
 * O conteúdo vem da API, gerado a partir da **versão gravada** — é o mesmo byte
 * que o download entrega e que um agente leria (§32). Gerar uma prévia no
 * cliente e baixar outra coisa no servidor seria duas fontes de verdade para o
 * mesmo arquivo.
 */
export function ExportSheet({
  file,
  onOpenChange,
}: {
  file: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const architectureId = useWorkspaceStore((state) => state.architectureId);
  const saveStatus = useWorkspaceStore((state) => state.saveStatus);

  const [copied, setCopied] = useState(false);
  /**
   * O resultado carrega o nome do arquivo a que pertence. Assim trocar de
   * artefato já mostra "Gerando…" sem precisar limpar estado dentro do efeito —
   * e o conteúdo de um arquivo nunca aparece sob o título de outro.
   */
  const [loaded, setLoaded] = useState<{ file: string; content?: string; error?: string } | null>(
    null,
  );

  const description = file ? describeArtifact(file) : undefined;
  const current = loaded?.file === file ? loaded : null;
  const content = current?.content ?? "";

  useEffect(() => {
    if (!file || !architectureId) return;

    let active = true;

    api
      .artifact(architectureId, kindOf(file), file)
      .then((text) => {
        if (active) setLoaded({ file, content: text });
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setLoaded({
          file,
          error: cause instanceof ApiError ? cause.message : "Não foi possível gerar o artefato.",
        });
      });

    return () => {
      active = false;
    };
    // `saveStatus` entra de propósito: terminado um autosave, o artefato mudou.
  }, [file, architectureId, saveStatus]);

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
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          {current?.error ? (
            <p className="flex gap-1.5 p-4 text-[11px] leading-relaxed text-state-error">
              <TriangleAlert className="mt-0.5 size-3 shrink-0" strokeWidth={2.25} />
              {current.error}
            </p>
          ) : (
            <pre className="whitespace-pre-wrap break-words p-4 font-mono text-[12px] leading-relaxed">
              {current ? content : "Gerando…"}
            </pre>
          )}
        </ScrollArea>

        <div className="flex justify-end gap-2 border-t p-3">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            disabled={content === ""}
            onClick={copy}
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copiado" : "Copiar"}
          </Button>

          {/* O navegador baixa direto da API: o Content-Disposition já vem como
              anexo, então não há blob intermediário para divergir do preview. */}
          {architectureId && file && (
            <Button asChild size="sm" className="h-8 gap-1.5">
              <a href={`${API_BASE}/architectures/${architectureId}/${kindOf(file)}/${file}`} download={file}>
                <Download className="size-3.5" />
                Baixar
              </a>
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
