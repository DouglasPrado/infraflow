import { cn } from "@/lib/utils";

/**
 * Medidor de saturação — o elemento assinatura do InfraFlow.
 *
 * O trilho representa 0 → 125% da capacidade do recurso e carrega um tique fino
 * no teto (100%). Uma barra que cruza o tique está literalmente acima da linha:
 * o gargalo é identificável sem ler número algum (PRD §68, §84).
 */

const TRACK_CEILING = 1.25;
const TICK_AT = `${(1 / TRACK_CEILING) * 100}%`;

export function saturationTone(utilization: number): string {
  if (utilization >= 1) return "bg-state-bottleneck";
  if (utilization >= 0.9) return "bg-state-warning";
  return "bg-state-healthy";
}

export function SaturationMeter({
  utilization,
  className,
  height = "h-[5px]",
  square,
}: {
  utilization: number;
  className?: string;
  height?: string;
  /** Sem cantos arredondados, para sangrar na borda de um card. */
  square?: boolean;
}) {
  const fill = Math.min(utilization / TRACK_CEILING, 1) * 100;

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden bg-meter-track",
        square ? "rounded-none" : "rounded-full",
        height,
        className,
      )}
      role="meter"
      aria-valuenow={Math.round(utilization * 100)}
      aria-valuemin={0}
      aria-valuemax={125}
      aria-label="Saturação"
    >
      <div
        className={cn(
          "h-full transition-[width] duration-500 ease-out",
          square ? "rounded-none" : "rounded-full",
          saturationTone(utilization),
        )}
        style={{ width: `${fill}%` }}
      />
      {/* Teto de capacidade: a linha que a barra pode cruzar. */}
      <span
        aria-hidden
        className="absolute inset-y-0 w-[1.5px] -translate-x-1/2 bg-foreground/55"
        style={{ left: TICK_AT }}
      />
    </div>
  );
}
