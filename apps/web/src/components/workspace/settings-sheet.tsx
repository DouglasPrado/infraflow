"use client";

import { Check, KeyRound, Loader2, Trash2, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api, ApiError, type CredentialView } from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspace-store";
import { Eyebrow } from "./property-field";

/**
 * Configurações do projeto (PRD §52).
 *
 * A credencial é guardada cifrada no servidor e **nunca volta** — o que a tela
 * mostra é o suficiente para você saber qual chave está ali. É ela que o worker
 * usa para planejar e que a API usa para consultar o preço de tabela (§40),
 * em vez da credencial da máquina.
 */

/** Regiões com preço e disponibilidade que o produto já exercita. */
const REGIONS = [
  "us-east-1",
  "us-east-2",
  "us-west-2",
  "eu-west-1",
  "eu-central-1",
  "sa-east-1",
  "ap-southeast-1",
];

export function SettingsSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const architectureId = useWorkspaceStore((state) => state.architectureId);

  const [view, setView] = useState<CredentialView | null>(null);
  const [region, setRegion] = useState("us-east-1");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!open || !architectureId) return;

    let live = true;
    api
      .credential(architectureId)
      .then((result) => {
        if (!live) return;
        setView(result);
        if (result.region) setRegion(result.region);
      })
      .catch(() => {
        if (live) setView(null);
      });

    return () => {
      live = false;
    };
  }, [open, architectureId, tick]);

  const save = useCallback(async () => {
    if (!architectureId) return;
    setPending(true);
    setError(null);
    try {
      const result = await api.saveCredential(architectureId, {
        region,
        accessKeyId: accessKeyId.trim(),
        secretAccessKey: secretAccessKey.trim(),
      });
      setView(result);
      // O segredo não fica na memória da página depois de guardado.
      setAccessKeyId("");
      setSecretAccessKey("");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Não foi possível guardar.");
    } finally {
      setPending(false);
    }
  }, [architectureId, region, accessKeyId, secretAccessKey]);

  const remove = useCallback(async () => {
    if (!architectureId) return;
    setPending(true);
    setError(null);
    try {
      await api.deleteCredential(architectureId);
      setTick((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Não foi possível remover.");
    } finally {
      setPending(false);
    }
  }, [architectureId]);

  const completo = accessKeyId.trim().length > 15 && secretAccessKey.trim().length > 15;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-lg">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2 text-sm">
            <KeyRound className="size-4 text-muted-foreground" strokeWidth={1.75} />
            Configurações
          </SheetTitle>
          <SheetDescription>
            A credencial é deste projeto, fica cifrada no servidor e não volta para esta tela
            (PRD §52).
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-5 p-4">
            {view?.canStore === false && (
              <p className="flex gap-1.5 text-[11px] leading-relaxed text-state-warning">
                <TriangleAlert className="mt-0.5 size-3 shrink-0" strokeWidth={2.25} />
                A API está sem <code className="font-mono">INFRAFLOW_SECRET_KEY</code>, então não
                há como cifrar o segredo. Gere uma com{" "}
                <code className="font-mono">openssl rand -base64 32</code> e reinicie a API.
              </p>
            )}

            {view?.configured && (
              <section className="space-y-2 rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <Check className="size-3 shrink-0 text-state-healthy" strokeWidth={2.5} />
                  <Eyebrow>Credencial guardada</Eyebrow>
                </div>
                <dl className="space-y-1 text-[11px]">
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-muted-foreground">Chave</dt>
                    <dd className="font-mono">{view.hint}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-muted-foreground">Conta</dt>
                    <dd className="font-mono">{view.accountId ?? "—"}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-muted-foreground">Região</dt>
                    <dd className="font-mono">{view.region}</dd>
                  </div>
                </dl>
                {view.lastError && (
                  <p className="text-[11px] leading-relaxed text-state-error">{view.lastError}</p>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 text-[11px]"
                  disabled={pending}
                  onClick={() => void remove()}
                >
                  <Trash2 className="size-3" />
                  Remover
                </Button>
              </section>
            )}

            <Separator />

            <section className="space-y-3">
              <Eyebrow>{view?.configured ? "Substituir credencial" : "Credencial da AWS"}</Eyebrow>

              <div className="space-y-1">
                <Label className="text-[11px] font-normal text-muted-foreground">Região</Label>
                <Select value={region} onValueChange={setRegion}>
                  <SelectTrigger className="h-8 font-mono text-[12px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REGIONS.map((item) => (
                      <SelectItem key={item} value={item} className="font-mono">
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] font-normal text-muted-foreground" htmlFor="akid">
                  Access key ID
                </Label>
                <Input
                  id="akid"
                  value={accessKeyId}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="AKIA…"
                  className="h-8 font-mono text-[12px]"
                  onChange={(event) => setAccessKeyId(event.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] font-normal text-muted-foreground" htmlFor="secret">
                  Secret access key
                </Label>
                <Input
                  id="secret"
                  type="password"
                  value={secretAccessKey}
                  autoComplete="off"
                  spellCheck={false}
                  className="h-8 font-mono text-[12px]"
                  onChange={(event) => setSecretAccessKey(event.target.value)}
                />
              </div>

              <Button
                size="sm"
                className="h-8 w-full gap-1.5"
                disabled={pending || !completo || view?.canStore === false}
                onClick={() => void save()}
              >
                {pending && <Loader2 className="size-3.5 animate-spin" />}
                Verificar e guardar
              </Button>

              {error && (
                <p className="flex gap-1.5 text-[11px] leading-relaxed text-state-error">
                  <TriangleAlert className="mt-0.5 size-3 shrink-0" strokeWidth={2.25} />
                  {error}
                </p>
              )}

              <p className="text-[11px] leading-relaxed text-muted-foreground">
                A chave é conferida na AWS antes de ser guardada. Ela passa a ser usada para
                consultar preço de tabela (§40) e para o <code className="font-mono">tofu plan</code>{" "}
                do worker — que deixa de usar a credencial da sua máquina.
              </p>
            </section>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
