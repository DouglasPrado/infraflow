/** Formatação de métricas do protótipo. Números sempre tabulares (design.md §3). */

export function formatRps(rps: number): string {
  if (rps >= 1000) {
    const thousands = rps / 1000;
    const label = Number.isInteger(thousands) ? thousands.toString() : thousands.toFixed(1);
    return `${label}K req/s`;
  }
  return `${rps} req/s`;
}

export function formatCompactRps(rps: number): string {
  if (rps >= 1000) {
    const thousands = rps / 1000;
    return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}K`;
  }
  return String(rps);
}

export function formatCost(usd: number): string {
  return `US$ ${usd.toLocaleString("pt-BR")}`;
}
