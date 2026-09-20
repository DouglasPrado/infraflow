import { cn } from "@/lib/utils";

/**
 * Ícone de serviço.
 *
 * Os SVGs vivem em `public/icons/` e são gerados por `pnpm icons` a partir dos
 * Architecture Icons oficiais da AWS (`aws-icons`, MIT) e do `simple-icons`
 * (CC0). O registry é livre de UI, então ele carrega só o identificador.
 *
 * Cor de marca é informação — é o que distingue RDS de Redis num relance.
 * Não confundir com a cor arbitrária por categoria, que foi removida por
 * competir com o estado (design.md §3).
 */
export function ServiceIcon({
  icon,
  label,
  className,
}: {
  icon: string;
  label: string;
  className?: string;
}) {
  return (
    // Ícone decorativo: o nome do recurso já está escrito ao lado.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/icons/${icon}.svg`}
      alt=""
      aria-hidden
      title={label}
      draggable={false}
      className={cn("size-4 shrink-0 object-contain select-none", className)}
    />
  );
}
