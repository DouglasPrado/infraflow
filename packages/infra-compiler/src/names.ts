/**
 * Identificadores determinísticos.
 *
 * O mesmo canvas precisa produzir sempre os mesmos endereços de recurso: o
 * state do OpenTofu é indexado por endereço, e um nome que muda entre
 * compilações destrói e recria infraestrutura (PRD §4.3).
 */

/** Nome do canvas → identificador HCL válido. */
export function identifier(value: string): string {
  const slug = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (slug === "") return "resource";
  return /^[0-9]/.test(slug) ? `r_${slug}` : slug;
}

/**
 * Resolve colisões pela **ordem do documento**, não por contador global: dois
 * nodes chamados "cache" viram `cache` e `cache_2`, sempre nessa ordem.
 */
export function uniqueIdentifiers(entries: { id: string; name: string }[]): Map<string, string> {
  const used = new Map<string, number>();
  const result = new Map<string, string>();

  for (const entry of entries) {
    const base = identifier(entry.name);
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    result.set(entry.id, seen === 0 ? base : `${base}_${seen + 1}`);
  }

  return result;
}

/** Nome do recurso na AWS: prefixado pelo projeto, no formato com hífen. */
export function awsName(suffix: string): string {
  return `\${var.project}-${suffix.replaceAll("_", "-")}`;
}

/** Prefixo dos recursos na nuvem, derivado do nome da arquitetura. */
export function projectSlug(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/, "");

  return slug || "infraflow";
}
