"use client";

import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { PropertyField, PropertyValue } from "@/lib/types";

/** Linha de formulário do inspector. Rótulo acima, controle abaixo (design.md §4). */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] font-normal text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/** Cabeçalho de seção — o mesmo eyebrow em todo o produto. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h3
      className={cn(
        "text-[10px] font-medium uppercase tracking-eyebrow text-muted-foreground",
        className,
      )}
    >
      {children}
    </h3>
  );
}

/**
 * PRD §85 — `Estimated`, `Observed` e `Suggested` nunca podem se confundir.
 * A mesma etiqueta em todo o produto.
 */
export function Provenance({ kind }: { kind: "Estimated" | "Observed" | "Suggested" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-eyebrow",
        kind === "Observed" ? "bg-brand/10 text-brand" : "bg-secondary text-muted-foreground",
      )}
    >
      {kind}
    </span>
  );
}

export function FieldGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <Eyebrow>{title}</Eyebrow>
      {children}
    </section>
  );
}

export function PropertyControl({
  field,
  value,
  onChange,
}: {
  field: PropertyField;
  value: PropertyValue | undefined;
  onChange: (value: PropertyValue) => void;
}) {
  switch (field.kind) {
    case "switch":
      return (
        <div className="flex h-8 items-center justify-between rounded-md border px-2.5">
          <span className="text-sm text-muted-foreground">{value ? "Enabled" : "Disabled"}</span>
          <Switch checked={Boolean(value)} onCheckedChange={onChange} />
        </div>
      );

    case "select":
      return (
        <Select value={String(value ?? "")} onValueChange={onChange}>
          <SelectTrigger size="sm" className="h-8 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    case "number":
      return (
        <div className="relative">
          <Input
            type="number"
            value={Number(value ?? 0)}
            min={field.min}
            max={field.max}
            step={field.step}
            onChange={(event) => onChange(Number(event.target.value))}
            className="h-8 pr-10 font-mono text-sm tabular-nums"
          />
          {field.unit && (
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-[11px] text-muted-foreground">
              {field.unit}
            </span>
          )}
        </div>
      );

    default:
      return (
        <Input
          value={String(value ?? "")}
          placeholder={field.placeholder}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 text-sm"
        />
      );
  }
}
