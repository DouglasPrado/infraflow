"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Marca do GitHub — não faz parte do set de ícones do projeto (design.md §6). */
function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className} fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

/** Marca do produto: um traço vertical ganhando altura — a escada de carga. */
function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className}>
      <path d="M1.5 12.5h3v2h-3zM6 8.5h3v6H6zM10.5 2.5h3v12h-3z" fill="currentColor" opacity="0.35" />
      <path d="M1.5 12.5h3v2h-3zM6 8.5h3v6H6z" fill="currentColor" />
    </svg>
  );
}

/**
 * PRD §7 — tela de login.
 * A autenticação é simulada: qualquer submissão entra no workspace demo.
 */
export default function LoginPage() {
  const router = useRouter();

  const enter = (event?: FormEvent) => {
    event?.preventDefault();
    router.push("/workspace/demo");
  };

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-canvas px-6">
      {/* A mesma grade do canvas: entra-se no produto pela própria prancheta. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(var(--canvas-dot) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
          WebkitMaskImage:
            "radial-gradient(ellipse 60% 50% at 50% 45%, #000 15%, transparent 100%)",
          maskImage: "radial-gradient(ellipse 60% 50% at 50% 45%, #000 15%, transparent 100%)",
        }}
      />

      <div className="relative w-full max-w-[336px]">
        <div className="flex items-center gap-2">
          <Mark className="size-5 text-brand" />
          <span className="text-base font-semibold tracking-tight">InfraFlow</span>
        </div>

        <h1 className="mt-6 text-[26px] font-medium leading-[1.25] tracking-tight">
          Planeje.
          <br />
          Teste.
          <br />
          <span className="text-muted-foreground">Evolua sua infraestrutura.</span>
        </h1>

        <div className="mt-8 rounded-xl border bg-panel p-4 shadow-[0_1px_3px_-1px_oklch(0.2_0.02_248/0.1)]">
          <Button className="w-full gap-2" onClick={() => enter()}>
            <GitHubMark className="size-4" />
            Continuar com GitHub
          </Button>

          <div className="my-4 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-[11px] text-muted-foreground">ou</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <form className="space-y-3" onSubmit={enter}>
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-[11px] font-normal text-muted-foreground">
                E-mail
              </Label>
              <Input id="email" type="email" autoComplete="email" className="h-9" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-[11px] font-normal text-muted-foreground">
                Senha
              </Label>
              <Input id="password" type="password" autoComplete="current-password" className="h-9" />
            </div>

            <Button type="submit" variant="secondary" className="w-full">
              Entrar
            </Button>
          </form>
        </div>

        <p className="mt-4 text-center font-mono text-[11px] text-muted-foreground">
          Protótipo — autenticação simulada
        </p>
      </div>
    </main>
  );
}
