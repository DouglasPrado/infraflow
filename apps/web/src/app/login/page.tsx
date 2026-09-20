import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { getSessionUser } from "@/lib/server-api";

/** Marca do produto: um traço vertical ganhando altura — a escada de carga. */
function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className}>
      <path d="M1.5 12.5h3v2h-3zM6 8.5h3v6H6zM10.5 2.5h3v12h-3z" fill="currentColor" opacity="0.35" />
      <path d="M1.5 12.5h3v2h-3zM6 8.5h3v6H6z" fill="currentColor" />
    </svg>
  );
}

/** PRD §7 — tela de login. */
export default async function LoginPage() {
  // Quem já tem sessão não vê o formulário.
  if (await getSessionUser()) redirect("/");

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-canvas px-6 py-10">
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

        <LoginForm />
      </div>
    </main>
  );
}
