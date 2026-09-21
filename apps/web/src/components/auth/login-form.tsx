"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import { createDemoEdges, createDemoNodes } from "@/lib/demo-architecture";
import { demoDocument } from "@/lib/document";
import { cn } from "@/lib/utils";

/** Marca do GitHub — não faz parte do set de ícones do projeto (design.md §7). */
function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className} fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

type Mode = "login" | "register";

/**
 * PRD §7 — a tela de login. A autenticação deixou de ser simulada.
 *
 * O §7 não previu cadastro; sem ele não há como ter a primeira conta. Esta é a
 * menor extensão possível: o mesmo formulário, alternando o modo.
 */
export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRegister = mode === "register";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "");

    setPending(true);
    setError(null);

    try {
      if (isRegister) await api.register(name, email, password);
      else await api.login(email, password);

      // Primeira entrada: cria a arquitetura de trabalho a partir da demo (§65).
      const { architectureId } = await api.workspace(
        demoDocument(createDemoNodes(), createDemoEdges()),
      );

      router.replace(`/workspace/${architectureId}`);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Não foi possível conectar à API. Ela está rodando?",
      );
      setPending(false);
    }
  }

  return (
    <div className="mt-8 rounded-xl border bg-panel p-4 shadow-[0_1px_3px_-1px_oklch(0.2_0.02_248/0.1)]">
      <Button
        type="button"
        className="w-full gap-2"
        disabled
        title="Requer um OAuth App do GitHub configurado"
      >
        <GitHubMark className="size-4" />
        Continuar com GitHub
      </Button>
      <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
        Indisponível — falta configurar o OAuth App
      </p>

      <div className="my-4 flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[11px] text-muted-foreground">ou</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <form className="space-y-3" onSubmit={submit}>
        {isRegister && (
          <div className="space-y-1.5">
            <Label htmlFor="name" className="text-[11px] font-normal text-muted-foreground">
              Nome
            </Label>
            <Input id="name" name="name" required autoComplete="name" className="h-9" />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="email" className="text-[11px] font-normal text-muted-foreground">
            E-mail
          </Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="h-9"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password" className="text-[11px] font-normal text-muted-foreground">
            Senha
          </Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete={isRegister ? "new-password" : "current-password"}
            className="h-9"
          />
          {isRegister && (
            <p className="text-[11px] text-muted-foreground">Ao menos 8 caracteres.</p>
          )}
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-md border border-state-error/35 bg-state-error/[0.06] px-2.5 py-2 text-[12px] text-state-error"
          >
            {error}
          </p>
        )}

        <Button type="submit" variant="secondary" className="w-full gap-2" disabled={pending}>
          {pending && <LoaderCircle className={cn("size-3.5 animate-spin")} />}
          {isRegister ? "Criar conta" : "Entrar"}
        </Button>
      </form>

      <button
        type="button"
        onClick={() => {
          setMode(isRegister ? "login" : "register");
          setError(null);
        }}
        className="mt-3 w-full text-center text-[11px] text-muted-foreground transition-colors duration-150 hover:text-foreground"
      >
        {isRegister ? "Já tenho conta" : "Criar uma conta"}
      </button>
    </div>
  );
}
