"use client";

import { Copy, Check, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, type AssistantTask } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/store/workspace-store";
import { Eyebrow } from "./property-field";

/**
 * PRD §81 — o assistente.
 *
 * Ele não lê o canvas: lê o que o sistema **concluiu** sobre a arquitetura — a
 * validação do §72, a estimativa, o plano do §75, o laboratório do §76 e a
 * medição do §77–§79. Por isso as tarefas são fechadas: são as seis do §81, e
 * cada uma tem de onde tirar resposta.
 */
export function AssistantSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const architectureId = useWorkspaceStore((state) => state.architectureId);

  const [tasks, setTasks] = useState<{ task: AssistantTask; label: string; description: string }[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{ task: AssistantTask; text: string; model: string } | null>(null);
  const [asking, setAsking] = useState<AssistantTask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;

    let live = true;
    api
      .assistantTasks()
      .then((result) => {
        if (!live) return;
        setTasks(result.tasks);
        setAvailable(result.available);
      })
      .catch(() => {
        if (live) setAvailable(false);
      });

    return () => {
      live = false;
    };
  }, [open]);

  const ask = async (task: AssistantTask) => {
    if (!architectureId) return;
    setAsking(task);
    setError(null);
    try {
      setAnswer(await api.ask(architectureId, task, question.trim() || undefined));
    } catch (cause) {
      setAnswer(null);
      setError(cause instanceof ApiError ? cause.message : "O assistente não respondeu.");
    } finally {
      setAsking(null);
    }
  };

  const copy = async () => {
    if (!answer) return;
    await navigator.clipboard.writeText(answer.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-2xl">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="size-4 text-brand" strokeWidth={1.75} />
            Assistente
          </SheetTitle>
          <SheetDescription>
            Responde a partir do que o sistema apurou: validação, estimativa, plano, laboratório e
            medição (PRD §81).
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-5 p-4">
            {available === false && (
              <p className="flex gap-1.5 text-[11px] leading-relaxed text-state-warning">
                <TriangleAlert className="mt-0.5 size-3 shrink-0" strokeWidth={2.25} />
                O assistente precisa de uma credencial da Anthropic configurada na API
                (<code className="font-mono">ANTHROPIC_API_KEY</code>). Sem ela, nenhuma resposta é
                gerada — em vez de devolver texto que não vem de lugar nenhum.
              </p>
            )}

            <section className="space-y-2">
              <Eyebrow>Pergunta (opcional)</Eyebrow>
              <Textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Dá para cortar custo sem perder capacidade?"
                className="min-h-16 text-[12px]"
              />
            </section>

            <section className="grid grid-cols-2 gap-2">
              {tasks.map((task) => (
                <button
                  key={task.task}
                  type="button"
                  disabled={asking !== null || available === false || !architectureId}
                  onClick={() => void ask(task.task)}
                  className={cn(
                    "flex flex-col gap-0.5 rounded-md border p-2.5 text-left transition-colors duration-120",
                    "hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50",
                    answer?.task === task.task && "border-brand/40 bg-brand/[0.04]",
                  )}
                >
                  <span className="flex items-center gap-1.5 text-[12px] font-medium">
                    {asking === task.task && <Loader2 className="size-3 animate-spin" />}
                    {task.label}
                  </span>
                  <span className="text-[10px] leading-relaxed text-muted-foreground">
                    {task.description}
                  </span>
                </button>
              ))}
            </section>

            {error && (
              <p className="flex gap-1.5 text-[11px] leading-relaxed text-state-error">
                <TriangleAlert className="mt-0.5 size-3 shrink-0" strokeWidth={2.25} />
                {error}
              </p>
            )}

            {answer && (
              <>
                <Separator />
                <section className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Eyebrow>Resposta</Eyebrow>
                    <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-[11px]" onClick={copy}>
                      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                      {copied ? "Copiado" : "Copiar"}
                    </Button>
                  </div>
                  <div className="whitespace-pre-wrap break-words text-[12px] leading-relaxed">
                    {answer.text}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Gerado por <span className="font-mono">{answer.model}</span> sobre os dados desta
                    arquitetura.
                  </p>
                </section>
              </>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
