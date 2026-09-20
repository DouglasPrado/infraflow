"use client";

import { ArrowRight, Copy, GitBranch, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { VersionComparison } from "@infraflow/analyzer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api, ApiError, type ArchitectureVersion } from "@/lib/api";
import { formatCost, formatRps } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/store/workspace-store";
import { Eyebrow, Provenance } from "./property-field";

/**
 * PRD §38, §39, §80 — versões, clone e comparação.
 *
 * O fluxo do §80 é `v1 → test → modify → v2 → test → compare`, e esta tela é
 * onde ele acontece: congelar o estado, abrir uma alternativa e olhar o que
 * mudou entre duas versões.
 */

/** Delta onde crescer é melhorar — capacidade. */
function Growth({ value, format }: { value: number; format: (value: number) => string }) {
  if (value === 0) return <span className="text-muted-foreground">sem mudança</span>;
  return (
    <span className={value > 0 ? "text-state-healthy" : "text-state-error"}>
      {value > 0 ? "+" : "−"}
      {format(Math.abs(value))}
    </span>
  );
}

/** Delta onde crescer é piorar — custo e latência. */
function Cost({ value, format }: { value: number; format: (value: number) => string }) {
  if (value === 0) return <span className="text-muted-foreground">sem mudança</span>;
  return (
    <span className={value > 0 ? "text-state-warning" : "text-state-healthy"}>
      {value > 0 ? "+" : "−"}
      {format(Math.abs(value))}
    </span>
  );
}

function Row({
  label,
  from,
  to,
  delta,
}: {
  label: string;
  from: string;
  to: string;
  delta: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2 text-[11px]">
      <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums text-muted-foreground">{from}</span>
      <ArrowRight className="size-3 shrink-0 text-border" />
      <span className="font-mono tabular-nums">{to}</span>
      <span className="ml-auto font-mono tabular-nums">{delta}</span>
    </div>
  );
}

const ms = (value: number) => `${Math.round(value)}ms`;

function Comparison({ comparison }: { comparison: VersionComparison }) {
  const { estimated, observed, diff } = comparison;

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <Provenance kind="Estimated" />
        <Row
          label="Capacidade"
          from={formatRps(estimated.from.capacityRps)}
          to={formatRps(estimated.to.capacityRps)}
          delta={<Growth value={estimated.capacityRps.delta} format={formatRps} />}
        />
        <Row
          label="Custo/mês"
          from={formatCost(estimated.from.monthlyCostUsd)}
          to={formatCost(estimated.to.monthlyCostUsd)}
          delta={<Cost value={estimated.monthlyCostUsd.delta} format={formatCost} />}
        />
        <Row
          label="p95"
          from={ms(estimated.from.p95Ms)}
          to={ms(estimated.to.p95Ms)}
          delta={<Cost value={estimated.p95Ms.delta} format={ms} />}
        />
        {/* PRD §41 — custo por mil req/s. */}
        <Row
          label="Custo / 1K req/s"
          from={estimated.from.costPer1kRps === null ? "—" : formatCost(estimated.from.costPer1kRps)}
          to={estimated.to.costPer1kRps === null ? "—" : formatCost(estimated.to.costPer1kRps)}
          delta={
            estimated.from.costPer1kRps === null || estimated.to.costPer1kRps === null ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <Cost
                value={estimated.to.costPer1kRps - estimated.from.costPer1kRps}
                format={formatCost}
              />
            )
          }
        />
      </section>

      {observed ? (
        <section className="space-y-2">
          <Provenance kind="Observed" />
          <Row
            label="Sustentado"
            from={formatRps(observed.from.maxHealthyRps)}
            to={formatRps(observed.to.maxHealthyRps)}
            delta={<Growth value={observed.maxHealthyRps.delta} format={formatRps} />}
          />
          <Row
            label="p95"
            from={ms(observed.from.p95Ms)}
            to={ms(observed.to.p95Ms)}
            delta={<Cost value={observed.p95Ms.delta} format={ms} />}
          />
        </section>
      ) : (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Sem lado medido: comparar medição de uma versão com estimativa da outra produziria um
          número sem significado. Rode o teste de carga nas duas (§77).
        </p>
      )}

      <Separator />

      <section className="space-y-2">
        <Eyebrow>O que mudou</Eyebrow>
        {diff.identical ? (
          <p className="text-[11px] text-muted-foreground">Nada que afete a arquitetura.</p>
        ) : (
          <ul className="space-y-1.5 text-[11px]">
            {diff.meta.map((change) => (
              <li key={change.key} className="font-mono text-muted-foreground">
                {change.key}: {change.from} → {change.to}
              </li>
            ))}
            {diff.nodes.added.map((node) => (
              <li key={`+${node.id}`} className="text-state-healthy">
                + {node.name} <span className="font-mono text-[10px]">{node.type}</span>
              </li>
            ))}
            {diff.nodes.removed.map((node) => (
              <li key={`-${node.id}`} className="text-state-error">
                − {node.name} <span className="font-mono text-[10px]">{node.type}</span>
              </li>
            ))}
            {diff.nodes.changed.map((node) => (
              <li key={`~${node.id}`} className="space-y-0.5">
                <span className="font-medium">{node.name}</span>
                {node.type && (
                  <span className="ml-1.5 font-mono text-[10px] text-state-warning">
                    {node.type.from} → {node.type.to}
                  </span>
                )}
                <ul className="pl-3">
                  {node.properties.map((property) => (
                    <li key={property.key} className="font-mono text-[10px] text-muted-foreground">
                      {property.key}: {String(property.from ?? "—")} → {String(property.to ?? "—")}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
            {[...diff.edges.added, ...diff.edges.removed].length > 0 && (
              <li className="text-muted-foreground">
                {diff.edges.added.length} conexão(ões) adicionada(s), {diff.edges.removed.length}{" "}
                removida(s)
              </li>
            )}
          </ul>
        )}
      </section>
    </div>
  );
}

export function VersionsSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const architectureId = useWorkspaceStore((state) => state.architectureId);

  const [versions, setVersions] = useState<ArchitectureVersion[]>([]);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [tick, setTick] = useState(0);
  const [pair, setPair] = useState<{ from: number; to: number } | null>(null);
  const [comparison, setComparison] = useState<
    (VersionComparison & { from: { number: number } }) | null
  >(null);

  useEffect(() => {
    if (!open || !architectureId) return;

    let live = true;
    api
      .versions(architectureId)
      .then((list) => {
        if (!live) return;
        setVersions(list);
      })
      .catch((cause: unknown) => {
        if (live) setError(cause instanceof ApiError ? cause.message : "Não foi possível ler as versões.");
      });

    return () => {
      live = false;
    };
  }, [open, architectureId, tick]);

  // Duas versões ou mais: compara as duas mais recentes por padrão.
  const selected = pair ?? (versions.length >= 2 ? { from: versions[1]!.number, to: versions[0]!.number } : null);
  const fromVersion = selected?.from;
  const toVersion = selected?.to;

  useEffect(() => {
    if (!architectureId || fromVersion === undefined || toVersion === undefined) return;

    let live = true;
    api
      .compare(architectureId, fromVersion, toVersion)
      .then((result) => {
        if (live) setComparison(result);
      })
      .catch(() => {
        if (live) setComparison(null);
      });

    return () => {
      live = false;
    };
  }, [architectureId, fromVersion, toVersion]);

  const snapshot = useCallback(async () => {
    if (!architectureId) return;
    setPending(true);
    setError(null);
    try {
      await api.snapshot(architectureId, label.trim() || undefined);
      setLabel("");
      setTick((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Não foi possível congelar a versão.");
    } finally {
      setPending(false);
    }
  }, [architectureId, label]);

  const clone = useCallback(
    async (version: number) => {
      if (!architectureId) return;
      setPending(true);
      setError(null);
      try {
        const created = await api.clone(architectureId, version);
        router.push(`/workspace/${created.id}`);
        onOpenChange(false);
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : "Não foi possível clonar.");
      } finally {
        setPending(false);
      }
    },
    [architectureId, onOpenChange, router],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2 text-sm">
            <GitBranch className="size-4 text-muted-foreground" strokeWidth={1.75} />
            Versões
          </SheetTitle>
          <SheetDescription>
            Congele um marco, clone para explorar uma alternativa, compare o que mudou (PRD §80).
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-5 p-4">
            <section className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <label className="text-[11px] text-muted-foreground" htmlFor="version-label">
                  Rótulo do marco
                </label>
                <Input
                  id="version-label"
                  value={label}
                  placeholder="linha de base"
                  className="h-8"
                  onChange={(event) => setLabel(event.target.value)}
                />
              </div>
              <Button size="sm" className="h-8" disabled={pending || !architectureId} onClick={() => void snapshot()}>
                Congelar
              </Button>
            </section>

            {error && (
              <p className="flex gap-1.5 text-[11px] leading-relaxed text-state-error">
                <TriangleAlert className="mt-0.5 size-3 shrink-0" strokeWidth={2.25} />
                {error}
              </p>
            )}

            <section className="space-y-1">
              <Eyebrow>Histórico</Eyebrow>
              {versions.map((version) => (
                <div
                  key={version.number}
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-2.5 py-1.5",
                    selected &&
                      (version.number === selected.from || version.number === selected.to) &&
                      "border-brand/40 bg-brand/[0.04]",
                  )}
                >
                  <span className="w-8 shrink-0 font-mono text-[11px] tabular-nums">
                    v{version.number}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11px]">
                    {version.label ?? <span className="text-muted-foreground">em trabalho</span>}
                  </span>
                  {version.tested && (
                    <span className="shrink-0 rounded-sm bg-brand/10 px-1.5 py-0.5 text-[10px] uppercase tracking-eyebrow text-brand">
                      testada
                    </span>
                  )}
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5 text-[10px]"
                      onClick={() =>
                        setPair((current) =>
                          current?.to === version.number
                            ? current
                            : { from: current?.to ?? version.number, to: version.number },
                        )
                      }
                    >
                      comparar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 gap-1 px-1.5 text-[10px]"
                      disabled={pending}
                      onClick={() => void clone(version.number)}
                    >
                      <Copy className="size-3" />
                      clonar
                    </Button>
                  </div>
                </div>
              ))}
              {versions.length === 0 && (
                <p className="text-[11px] text-muted-foreground">Nenhuma versão ainda.</p>
              )}
            </section>

            {selected && comparison && (
              <>
                <Separator />
                <section className="space-y-3">
                  <Eyebrow>
                    v{selected.from} → v{selected.to}
                  </Eyebrow>
                  <Comparison comparison={comparison} />
                </section>
              </>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
