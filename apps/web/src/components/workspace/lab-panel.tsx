"use client";

import { ExternalLink, FlaskConical, Loader2, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLabs } from "@/hooks/use-labs";
import type { LabStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/store/workspace-store";
import { FieldGroup } from "./property-field";

const LABEL: Record<LabStatus, string> = {
  CREATING: "Provisionando",
  READY: "Pronto",
  DESTROYING: "Destruindo",
  DESTROYED: "Destruído",
  FAILED: "Falhou",
};

const TONE: Record<LabStatus, string> = {
  CREATING: "text-brand",
  READY: "text-state-healthy",
  DESTROYING: "text-state-warning",
  DESTROYED: "text-muted-foreground",
  FAILED: "text-state-error",
};

function remaining(expiresAt: string): string {
  const minutes = Math.round((new Date(expiresAt).getTime() - Date.now()) / 60_000);
  if (minutes <= 0) return "expirado";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.round(minutes / 60)} h`;
}

/**
 * PRD §76 — Create Lab → apply → Deploy → Ready.
 *
 * O laboratório é infraestrutura de verdade, temporária e isolada: rede
 * própria e uma única porta publicada. O prazo fica à vista porque o §54 exige
 * que o que sobe desça — e o worker derruba sozinho quando ele vence.
 */
export function LabPanel() {
  const architectureId = useWorkspaceStore((state) => state.architectureId);
  const { lab, error, pending, create, destroy, moving } = useLabs(architectureId);

  return (
    <FieldGroup title="Laboratório">
      <div className="space-y-2">
        {!lab || lab.status === "DESTROYED" ? (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-8 w-full gap-1.5"
              disabled={pending || !architectureId}
              onClick={() => void create()}
            >
              <FlaskConical className="size-3.5" />
              Criar laboratório
            </Button>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Sobe a arquitetura em containers isolados, com uma única porta publicada, para
              receber carga real (PRD §76).
            </p>
          </>
        ) : (
          <div className="space-y-2.5 rounded-md border p-2.5">
            <div className="flex items-center gap-2">
              {moving ? (
                <Loader2 className={cn("size-3 shrink-0 animate-spin", TONE[lab.status])} strokeWidth={2.25} />
              ) : (
                <span className={cn("size-1.5 shrink-0 rounded-full bg-current", TONE[lab.status])} />
              )}
              <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{lab.slug}</span>
              <span className={cn("shrink-0 text-[10px] uppercase tracking-eyebrow", TONE[lab.status])}>
                {LABEL[lab.status]}
              </span>
            </div>

            {lab.entryUrl && lab.status === "READY" && (
              <a
                href={lab.entryUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 font-mono text-[11px] text-brand transition-opacity duration-150 hover:opacity-75"
              >
                <ExternalLink className="size-3 shrink-0" strokeWidth={2.25} />
                {lab.entryUrl}
              </a>
            )}

            {lab.containers.length > 0 && (
              <ul className="space-y-0.5">
                {lab.containers.map((container) => (
                  <li key={container.name} className="flex items-baseline gap-2 text-[10px]">
                    <span className="w-14 shrink-0 uppercase tracking-eyebrow text-muted-foreground">
                      {container.role}
                    </span>
                    <span className="min-w-0 truncate font-mono text-muted-foreground">
                      {container.image}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {lab.error && (
              <p className="text-[11px] leading-relaxed text-state-error">{lab.error}</p>
            )}

            <div className="flex items-center justify-between gap-2 border-t pt-2">
              <span className="text-[10px] text-muted-foreground">
                expira em {remaining(lab.expiresAt)}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 text-[11px]"
                disabled={pending || lab.status === "DESTROYING"}
                onClick={() => void destroy()}
              >
                <Trash2 className="size-3" />
                Destruir
              </Button>
            </div>
          </div>
        )}

        {error && (
          <p className="flex gap-1.5 text-[11px] leading-relaxed text-state-error">
            <TriangleAlert className="mt-0.5 size-3 shrink-0" strokeWidth={2.25} />
            {error}
          </p>
        )}
      </div>
    </FieldGroup>
  );
}
