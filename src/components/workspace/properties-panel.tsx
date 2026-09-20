"use client";

import { ArrowLeftRight, MousePointerClick } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { getCatalogItem } from "@/lib/catalog";
import type { InfraNode } from "@/lib/types";
import { useWorkspaceStore } from "@/store/workspace-store";
import { LoadGeneratorProperties } from "./load-generator-properties";
import { Field, FieldGroup, PropertyControl, Provenance } from "./property-field";

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <MousePointerClick className="size-5 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        Selecione um elemento do canvas para ver suas propriedades.
      </p>
    </div>
  );
}

function ResourceProperties({ node }: { node: Extract<InfraNode, { type: "resource" }> }) {
  const updateResourceProp = useWorkspaceStore((state) => state.updateResourceProp);
  const renameNode = useWorkspaceStore((state) => state.renameNode);
  const swapAlternative = useWorkspaceStore((state) => state.swapAlternative);

  const item = getCatalogItem(node.data.type);
  if (!item) return <EmptyState />;

  const alternative = item.alternative ? getCatalogItem(item.alternative) : undefined;

  return (
    <div className="space-y-5 p-3">
      <div className="flex items-start gap-2">
        <item.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium">{item.title}</h2>
          <p className="font-mono text-[11px] text-muted-foreground">{item.type}</p>
        </div>
      </div>

      <Field label="Name">
        <Input
          value={node.data.name}
          onChange={(event) => renameNode(node.id, event.target.value)}
          className="h-8 font-mono text-sm"
        />
      </Field>

      <Separator />

      <FieldGroup title="Configuração">
        {item.properties.map((field) => (
          <Field key={field.key} label={field.label}>
            <PropertyControl
              field={field}
              value={node.data.props[field.key]}
              onChange={(value) => updateResourceProp(node.id, field.key, value)}
            />
          </Field>
        ))}
      </FieldGroup>

      {alternative && (
        <>
          <Separator />
          <FieldGroup title="Alternativa">
            <div className="flex items-center justify-between gap-2 rounded-md border p-2.5">
              <div className="flex min-w-0 items-center gap-2 text-sm">
                <span className="truncate">{item.name}</span>
                <ArrowLeftRight className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate text-muted-foreground">{alternative.name}</span>
              </div>
              <Button variant="outline" size="sm" className="h-7 shrink-0" onClick={() => swapAlternative(node.id)}>
                Trocar
              </Button>
            </div>
          </FieldGroup>
        </>
      )}

      <Separator />

      <FieldGroup title="Capacidade estimada">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Mocked capacity</span>
          <span className="font-mono text-sm tabular-nums">{item.capacityRps.toLocaleString("pt-BR")} req/s</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Estimated cost</span>
          <span className="font-mono text-sm tabular-nums">US$ {item.monthlyCostUsd}/mês</span>
        </div>
        <Provenance kind="Estimated" />
      </FieldGroup>
    </div>
  );
}

function CanvasElementProperties({ node }: { node: InfraNode }) {
  const renameNode = useWorkspaceStore((state) => state.renameNode);
  const updateNoteText = useWorkspaceStore((state) => state.updateNoteText);

  if (node.type === "group") {
    return (
      <div className="space-y-5 p-3">
        <h2 className="text-sm font-medium">Group</h2>
        <Field label="Label">
          <Input
            value={node.data.label}
            onChange={(event) => renameNode(node.id, event.target.value)}
            className="h-8 text-sm"
          />
        </Field>
      </div>
    );
  }

  if (node.type === "note") {
    return (
      <div className="space-y-5 p-3">
        <h2 className="text-sm font-medium">{node.data.variant === "sticky" ? "Sticky Note" : "Text"}</h2>
        <Field label="Conteúdo">
          <textarea
            value={node.data.text}
            onChange={(event) => updateNoteText(node.id, event.target.value)}
            rows={5}
            className="w-full resize-none rounded-md border bg-transparent p-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </Field>
      </div>
    );
  }

  return <EmptyState />;
}

/** PRD §14 — sidebar direita, aba Properties. */
export function PropertiesPanel() {
  const node = useWorkspaceStore((state) => state.nodes.find((candidate) => candidate.selected));

  if (!node) return <EmptyState />;
  if (node.type === "resource") return <ResourceProperties node={node} />;
  if (node.type === "loadGenerator") return <LoadGeneratorProperties node={node} />;
  return <CanvasElementProperties node={node} />;
}
