/** Utilidades de formatação. Determinísticas — nada de data nem de locale. */

export function table(headers: string[], rows: string[][], empty = "Nada a listar"): string {
  if (rows.length === 0) {
    return `_${empty}._`;
  }
  const head = `| ${headers.join(" | ")} |`;
  const rule = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
  return `${head}\n${rule}\n${body}`;
}

/** Número com separador de milhar fixo, para o relatório não mudar com o locale. */
export function integer(value: number): string {
  return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function decimal(value: number, places = 1): string {
  return value.toFixed(places);
}

export function percent(ratio: number): string {
  return `${decimal(ratio * 100)}%`;
}

export function usd(value: number): string {
  return `US$ ${integer(value)}`;
}

/** Código inline, escapando a crase para não quebrar a tabela. */
export function code(value: string | number | boolean): string {
  return `\`${String(value).replaceAll("`", "'")}\``;
}

export function section(title: string, body: string): string {
  return `## ${title}\n\n${body}\n`;
}
