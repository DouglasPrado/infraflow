"use client";

import { Check, CircleX, Loader2, TriangleAlert } from "lucide-react";
import type { LoadTestObservation, PlanSummary } from "@infraflow/schema";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { useRun } from "@/hooks/use-runs";
import { formatRps } from "@/lib/format";
import type { RunDetail, RunStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Eyebrow, Provenance } from "./property-field";

/** PRD §12 — a mesma gramática de estado dos nodes, aplicada à execução. */
export const RUN_TONE: Record<RunStatus, string> = {
  QUEUED: "text-muted-foreground",
  RUNNING: "text-brand",
  SUCCEEDED: "text-state-healthy",
  FAILED: "text-state-error",
};

export const RUN_LABEL: Record<RunStatus, string> = {
  QUEUED: "Na fila",
  RUNNING: "Executando",
  SUCCEEDED: "Concluída",
  FAILED: "Falhou",
};

export function RunIcon({ status, className }: { status: RunStatus; className?: string }) {
  const shared = cn("size-3 shrink-0", RUN_TONE[status], className);
  if (status === "SUCCEEDED") return <Check className={shared} strokeWidth={2.5} />;
  if (status === "FAILED") return <CircleX className={shared} strokeWidth={2.25} />;
  if (status === "RUNNING") return <Loader2 className={cn(shared, "animate-spin")} strokeWidth={2.25} />;
  return <span className={cn("size-1.5 shrink-0 rounded-full bg-current", RUN_TONE[status])} />;
}

const ACTION_TONE: Record<string, string> = {
  create: "text-state-healthy",
  update: "text-state-warning",
  replace: "text-state-warning",
  delete: "text-state-error",
  read: "text-muted-foreground",
  "no-op": "text-muted-foreground",
};

function Counter({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("font-mono text-sm font-medium tabular-nums", tone)}>{value}</div>
    </div>
  );
}

/** Série medida → pico e média por recurso, que é o que se lê de relance. */
function aggregate(metrics: LoadTestObservation["metrics"]) {
  const byKey = new Map<string, { nodeId: string; metric: string; unit: string; peak: number; total: number; count: number }>();

  for (const sample of metrics) {
    const key = `${sample.nodeId}:${sample.metric}`;
    const current = byKey.get(key) ?? {
      nodeId: sample.nodeId,
      metric: sample.metric,
      unit: sample.unit,
      peak: 0,
      total: 0,
      count: 0,
    };
    byKey.set(key, {
      ...current,
      peak: Math.max(current.peak, sample.value),
      total: current.total + sample.value,
      count: current.count + 1,
    });
  }

  return [...byKey.values()]
    .map((entry) => ({ ...entry, mean: entry.total / entry.count }))
    .sort((left, right) => (left.nodeId === right.nodeId ? left.metric.localeCompare(right.metric) : left.nodeId.localeCompare(right.nodeId)));
}

/** PRD §75 — o que o OpenTofu declarou que vai fazer. */
function PlanResult({ summary }: { summary: PlanSummary }) {
  return (
    <>
      <section className="space-y-3">
        <Provenance kind="Planned" />
        <div className="grid grid-cols-3 gap-3">
          <Counter label="A criar" value={summary.add} tone="text-state-healthy" />
          <Counter label="A alterar" value={summary.change} tone="text-state-warning" />
          <Counter label="A destruir" value={summary.destroy} tone="text-state-error" />
        </div>
      </section>

      <Separator />

      <section className="space-y-2">
        <Eyebrow>Recursos</Eyebrow>
        <ul className="space-y-1">
          {summary.changes.map((change) => (
            <li key={change.address} className="flex items-baseline gap-2">
              <span
                className={cn(
                  "w-14 shrink-0 text-[10px] uppercase tracking-eyebrow",
                  ACTION_TONE[change.action],
                )}
              >
                {change.action}
              </span>
              <span className="min-w-0 truncate font-mono text-[11px]">{change.address}</span>
            </li>
          ))}
        </ul>
      </section>

      {summary.compileWarnings.length > 0 && (
        <>
          <Separator />
          <section className="space-y-2">
            <Eyebrow>Compilação</Eyebrow>
            <ul className="space-y-2">
              {summary.compileWarnings.map((warning) => (
                <li key={`${warning.code}-${warning.nodeId ?? "geral"}`} className="flex gap-1.5">
                  <TriangleAlert
                    className="mt-0.5 size-3 shrink-0 text-state-warning"
                    strokeWidth={2.25}
                  />
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
          </section>
        </>
      )}
    </>
  );
}

/**
 * PRD §77 — o que o k6 mediu.
 *
 * `Observed` e não `Estimated`: estes números vieram de requisição de verdade
 * contra o laboratório, e o §85 proíbe confundir as duas leituras.
 */
function LoadTestResult({ observation }: { observation: LoadTestObservation }) {
  const peak = observation.stages.reduce(
    (best, stage) => (stage.errorRatePct <= 1 && stage.rps > best ? stage.rps : best),
    0,
  );

  return (
    <>
      <section className="space-y-3">
        <Provenance kind="Observed" />
        <div>
          <div className="text-[11px] text-muted-foreground">Vazão sustentada</div>
          <div className="mt-0.5 font-mono text-[32px] font-medium leading-none tracking-tight tabular-nums">
            {formatRps(Math.round(observation.rps))}
          </div>
        </div>
        <div className="grid grid-cols-4 gap-3 border-t pt-3">
          <Counter label="Requisições" value={observation.requests} />
          <Counter label="p95" value={Math.round(observation.p95Ms)} />
          <Counter label="p99" value={Math.round(observation.p99Ms)} />
          <Counter
            label="Erros %"
            value={Math.round(observation.errorRatePct * 10) / 10}
            tone={observation.errorRatePct > 0 ? "text-state-error" : undefined}
          />
        </div>
        <div
          className={cn(
            "text-[11px]",
            observation.meetsSlo ? "text-state-healthy" : "text-state-error",
          )}
        >
          {observation.meetsSlo ? "SLO cumprido (§19)." : "SLO violado (§19)."}
        </div>
      </section>

      <Separator />

      <section className="space-y-2">
        <Eyebrow>Escada de carga</Eyebrow>
        <div className="space-y-1">
          <div className="flex items-baseline gap-2 text-[10px] uppercase tracking-eyebrow text-muted-foreground">
            <span className="w-16 shrink-0 text-right">pedido</span>
            <span className="w-16 shrink-0 text-right">alcançado</span>
            <span className="w-14 shrink-0 text-right">p95</span>
            <span className="w-12 shrink-0 text-right">erros</span>
          </div>
          {observation.stages.map((stage) => (
            <div key={stage.targetRps} className="flex items-baseline gap-2 font-mono text-[11px] tabular-nums">
              <span className="w-16 shrink-0 text-right text-muted-foreground">
                {Math.round(stage.targetRps)}
              </span>
              <span className="w-16 shrink-0 text-right">{Math.round(stage.rps)}</span>
              <span className="w-14 shrink-0 text-right">{Math.round(stage.p95Ms)}ms</span>
              <span
                className={cn(
                  "w-12 shrink-0 text-right",
                  stage.errorRatePct > 0 ? "text-state-error" : "text-muted-foreground",
                )}
              >
                {Math.round(stage.errorRatePct * 10) / 10}%
              </span>
            </div>
          ))}
        </div>
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Maior degrau sustentado com menos de 1% de erro: {formatRps(Math.round(peak))}.
        </p>
      </section>

      {observation.metrics.length > 0 && (
        <>
          <Separator />
          <section className="space-y-2">
            <Eyebrow>Métricas por recurso (§78)</Eyebrow>
            <div className="space-y-1">
              {aggregate(observation.metrics).map((entry) => (
                <div
                  key={`${entry.nodeId}-${entry.metric}`}
                  className="flex items-baseline gap-2 text-[11px]"
                >
                  <span className="w-28 shrink-0 truncate font-mono text-muted-foreground">
                    {entry.nodeId}
                  </span>
                  <span className="w-16 shrink-0 text-[10px] uppercase tracking-eyebrow text-muted-foreground">
                    {entry.metric}
                  </span>
                  <span className="font-mono tabular-nums">
                    pico {entry.peak.toFixed(1)}
                    {entry.unit}
                  </span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    · média {entry.mean.toFixed(1)}
                    {entry.unit}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Coletadas do Prometheus do laboratório, já ligadas ao node do canvas.
            </p>
          </section>
        </>
      )}

      {observation.loadCeiling !== "none" && (
        <>
          <Separator />
          <p
            className={`flex gap-1.5 text-[11px] leading-relaxed ${
              observation.loadCeiling === "generator" ? "text-state-warning" : "text-muted-foreground"
            }`}
          >
            <TriangleAlert className="mt-0.5 size-3 shrink-0" strokeWidth={2.25} />
            {observation.loadCeiling === "generator" ? (
              <>
                O gerador descartou {observation.droppedIterations} iterações enquanto o alvo seguia
                saudável: o limite encontrado é o da máquina que gera, não o da arquitetura. Repita
                com um perfil menor para medir a arquitetura.
              </>
            ) : (
              <>
                O alvo saturou: a latência inflou e {observation.droppedIterations} iterações não
                chegaram a sair. A vazão do platô é o teto da arquitetura, não do gerador.
              </>
            )}
          </p>
        </>
      )}
    </>
  );
}

function resultOf(run: RunDetail | null) {
  if (!run?.result) return null;
  if (run.kind === "PLAN") return <PlanResult summary={run.result as PlanSummary} />;
  if (run.kind === "LOAD_TEST") {
    return <LoadTestResult observation={run.result as LoadTestObservation} />;
  }
  return null;
}

const KIND_LABEL: Record<string, string> = {
  PLAN: "tofu plan",
  LOAD_TEST: "teste de carga (k6)",
  LAB_APPLY: "criação do laboratório",
  LAB_DESTROY: "destruição do laboratório",
};

/**
 * PRD §75, §77 — o resultado da execução dentro do workspace.
 *
 * Mostra o que o OpenTofu disse, inclusive quando ele recusou: falta de
 * credencial e região errada são resposta, não ausência de resultado. Por isso
 * o log cru fica disponível — é onde o motivo está escrito.
 */
export function RunSheet({
  runId,
  onOpenChange,
}: {
  runId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const run = useRun(runId);

  return (
    <Sheet open={runId !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-2xl">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2 font-mono text-sm">
            {run && <RunIcon status={run.status} />}
            {run?.slug ?? "Execução"}
          </SheetTitle>
          <SheetDescription>
            {run
              ? `${KIND_LABEL[run.kind] ?? run.kind} · versão v${run.version} · ${RUN_LABEL[run.status]}`
              : "Carregando…"}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-5 p-4">
            {run?.error && (
              <section className="space-y-2">
                <Eyebrow className="text-state-error">Falhou</Eyebrow>
                <pre className="whitespace-pre-wrap break-words rounded-md border border-state-error/35 bg-state-error/[0.06] p-3 font-mono text-[11px] leading-relaxed">
                  {run.error}
                </pre>
              </section>
            )}

            {resultOf(run)}

            {run && run.logs.length > 0 && (
              <>
                <Separator />
                <section className="space-y-2">
                  <Eyebrow>Saída do processo</Eyebrow>
                  <pre className="whitespace-pre-wrap break-words rounded-md border bg-secondary/40 p-3 font-mono text-[11px] leading-relaxed">
                    {run.logs}
                  </pre>
                </section>
              </>
            )}

            {run && run.status !== "SUCCEEDED" && run.status !== "FAILED" && (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                A execução roda num worker separado (PRD §51). Esta tela acompanha o estado.
              </p>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
