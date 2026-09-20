"use client";

import { Search, SquareDashed, StickyNote, Type, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo, useState, type DragEvent } from "react";
import { DND_MIME } from "@/components/canvas/infra-canvas";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CATALOG, LIBRARY_SECTIONS, LOAD_GENERATOR_TYPE } from "@infraflow/registry";
import { resolveIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

interface LibraryEntry {
  payload: string;
  name: string;
  hint: string;
  Icon: LucideIcon;
  /** O Load Generator é o único item com acento — é a origem do teste (PRD §15). */
  accent?: boolean;
}

/** PRD §27 — elementos visuais que não representam infraestrutura. */
const CANVAS_ENTRIES: LibraryEntry[] = [
  { payload: "canvas:note", name: "Sticky Note", hint: "Nota", Icon: StickyNote },
  { payload: "canvas:text", name: "Text", hint: "Texto", Icon: Type },
  { payload: "canvas:group", name: "Group", hint: "Seção", Icon: SquareDashed },
];

const LOAD_GENERATOR_ENTRY: LibraryEntry = {
  payload: LOAD_GENERATOR_TYPE,
  name: "Load Generator",
  hint: "Origem do teste",
  Icon: Zap,
  accent: true,
};

function LibraryItem({ entry }: { entry: LibraryEntry }) {
  const onDragStart = (event: DragEvent<HTMLDivElement>) => {
    event.dataTransfer.setData(DND_MIME, entry.payload);
    event.dataTransfer.effectAllowed = "copy";
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      title={entry.hint}
      className={cn(
        "flex cursor-grab items-center gap-2.5 rounded-md px-2 py-1.5",
        "transition-colors duration-150 hover:bg-accent active:cursor-grabbing",
      )}
    >
      <entry.Icon
        className={cn("size-4 shrink-0", entry.accent ? "text-brand" : "text-muted-foreground")}
        strokeWidth={1.75}
      />
      <span className="truncate text-sm">{entry.name}</span>
    </div>
  );
}

/** PRD §10 — sidebar esquerda com busca e categorias. */
export function ComponentLibrary() {
  const [query, setQuery] = useState("");

  const sections = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = (entry: LibraryEntry) =>
      !needle || entry.name.toLowerCase().includes(needle) || entry.hint.toLowerCase().includes(needle);

    const resourceSections = LIBRARY_SECTIONS.map((section) => ({
      label: section.label,
      entries: (section.category === "testing"
        ? [LOAD_GENERATOR_ENTRY]
        : CATALOG.filter((item) => item.category === section.category).map((item) => ({
            payload: item.type,
            name: item.name,
            hint: item.title,
            Icon: resolveIcon(item.icon).Icon,
          }))
      ).filter(matches),
    }));

    return [...resourceSections, { label: "Canvas", entries: CANVAS_ENTRIES.filter(matches) }].filter(
      (section) => section.entries.length > 0,
    );
  }, [query]);

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-panel lg:flex">
      <div className="relative border-b p-2.5">
        <Search
          className="pointer-events-none absolute left-5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          strokeWidth={1.75}
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar recursos..."
          className="h-8 pl-7 text-sm"
        />
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 px-2 py-3">
          {sections.map((section) => (
            <div key={section.label}>
              <div className="px-2 pb-1.5 text-[10px] font-medium uppercase tracking-eyebrow text-muted-foreground">
                {section.label}
              </div>
              <div className="space-y-px">
                {section.entries.map((entry) => (
                  <LibraryItem key={entry.payload} entry={entry} />
                ))}
              </div>
            </div>
          ))}

          {sections.length === 0 && (
            <p className="px-2 py-8 text-center text-sm text-muted-foreground">
              Nenhum recurso com esse nome.
            </p>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
