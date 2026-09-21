"use client";

import { Info } from "lucide-react";
import { usePricing } from "@/hooks/use-pricing";
import { formatCost } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FieldGroup, Provenance } from "./property-field";

/**
 * Custo pela tabela da AWS (PRD §40).
 *
 * `Priced` é uma leitura distinta de `Estimated`: vem da Price List da AWS
 * para a configuração desenhada, não de valor declarado no registry. E nenhuma
 * das duas é `Observed` — nem a AWS sabe quanto você vai consumir.
 *
 * O que não dá para precificar aparece assim mesmo, com o motivo. Um serviço
 * cobrado por uso não tem preço mensal sem uma hipótese de volume, e o canvas
 * não declara volume.
 */
export function PricingPanel() {
  const pricing = usePricing();
  if (!pricing) return null;

  const deTabela = pricing.nodes.filter((node) => node.source === "priced");
  const dePalpite = pricing.nodes.filter((node) => node.source === "estimated");

  return (
    <FieldGroup title="Custo mensal">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Provenance kind="Priced" />
          <span className="font-mono text-[10px] text-muted-foreground">{pricing.region}</span>
        </div>

        <div>
          <div className="font-mono text-[28px] font-medium leading-none tracking-tight tabular-nums">
            {formatCost(Math.round(pricing.monthlyUsd))}
          </div>
          <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            {formatCost(Math.round(pricing.pricedMonthlyUsd))} de tabela da AWS
            {dePalpite.length > 0 && ` · o resto é estimativa`}
          </div>
        </div>

        {deTabela.length > 0 && (
          <ul className="space-y-1.5">
            {deTabela.map((node) => (
              <li key={node.nodeId} className="space-y-0.5">
                <div className="flex items-baseline gap-2 text-[11px]">
                  <span className="min-w-0 flex-1 truncate">{node.name}</span>
                  <span className="shrink-0 font-mono tabular-nums">
                    {formatCost(Math.round(node.monthlyUsd))}
                  </span>
                </div>
                {node.breakdown?.map((part) => (
                  <div
                    key={part.sku}
                    className="flex items-baseline gap-2 pl-2 text-[10px] text-muted-foreground"
                  >
                    <span className="min-w-0 flex-1 truncate">{part.label}</span>
                    <span className="shrink-0 font-mono tabular-nums">
                      {formatCost(Math.round(part.monthlyUsd))}
                    </span>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        )}

        {dePalpite.length > 0 && (
          <div className="space-y-1.5 border-t pt-2">
            <div className="text-[10px] uppercase tracking-eyebrow text-muted-foreground">
              Sem preço de tabela
            </div>
            {dePalpite.map((node) => (
              <div key={node.nodeId} className="space-y-0.5">
                <div className="flex items-baseline gap-2 text-[11px]">
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{node.name}</span>
                  <span className={cn("shrink-0 font-mono tabular-nums text-muted-foreground")}>
                    {formatCost(Math.round(node.monthlyUsd))}
                  </span>
                </div>
                {node.reason && (
                  <p className="flex gap-1 pl-2 text-[10px] leading-relaxed text-muted-foreground">
                    <Info className="mt-0.5 size-2.5 shrink-0" strokeWidth={2.25} />
                    {node.reason}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Preço on-demand da tabela pública da AWS, consultado com a credencial deste projeto.
          Não inclui Savings Plans, Reserved, transferência de dados nem free tier.
        </p>
      </div>
    </FieldGroup>
  );
}
