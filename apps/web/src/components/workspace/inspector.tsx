"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspaceStore, type InspectorTab } from "@/store/workspace-store";
import { AnalysisPanel } from "./analysis-panel";
import { CommandsPanel } from "./commands-panel";
import { PropertiesPanel } from "./properties-panel";

/** PRD §23 — sidebar direita alterna entre Properties, Analysis e Commands. */
export function Inspector({
  onOpenFile,
  onOpenRun,
}: {
  onOpenFile: (file: string) => void;
  onOpenRun: (runId: string) => void;
}) {
  const tab = useWorkspaceStore((state) => state.inspectorTab);
  const setTab = useWorkspaceStore((state) => state.setInspectorTab);

  return (
    <aside className="hidden w-80 shrink-0 flex-col border-l bg-panel md:flex">
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as InspectorTab)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="border-b p-2">
          <TabsList className="w-full">
            <TabsTrigger value="properties">Properties</TabsTrigger>
            <TabsTrigger value="analysis">Analysis</TabsTrigger>
            <TabsTrigger value="commands">Commands</TabsTrigger>
          </TabsList>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <TabsContent value="properties" className="h-full">
            <PropertiesPanel />
          </TabsContent>
          <TabsContent value="analysis">
            <AnalysisPanel />
          </TabsContent>
          <TabsContent value="commands">
            <CommandsPanel onOpenFile={onOpenFile} onOpenRun={onOpenRun} />
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </aside>
  );
}
