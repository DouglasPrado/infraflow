/**
 * Modelo de OpenTofu (PRD §74).
 *
 * O compiler não monta texto: monta esta árvore. Concatenar string produz HCL
 * que parece certo e quebra na hora do `validate` — e o §85 classifica IaC
 * incorreta como risco de alto impacto. Com um modelo tipado, o que não se pode
 * representar não se pode gerar, e a impressão vira um problema só de formato.
 */

export type TofuValue =
  | { kind: "string"; value: string }
  | { kind: "number"; value: number }
  | { kind: "bool"; value: boolean }
  | { kind: "list"; items: TofuValue[] }
  | { kind: "object"; entries: [string, TofuValue][] }
  /** Expressão HCL crua: referência, interpolação, função. Nunca escapada. */
  | { kind: "expression"; source: string };

export interface TofuBlock {
  type: string;
  labels: string[];
  attributes: [string, TofuValue][];
  blocks: TofuBlock[];
}

export interface TofuFile {
  name: string;
  /** Comentário de cabeçalho, uma linha por item. */
  header?: string[];
  blocks: TofuBlock[];
}

export const str = (value: string): TofuValue => ({ kind: "string", value });
export const num = (value: number): TofuValue => ({ kind: "number", value });
export const bool = (value: boolean): TofuValue => ({ kind: "bool", value });
export const list = (items: TofuValue[]): TofuValue => ({ kind: "list", items });
export const obj = (entries: [string, TofuValue][]): TofuValue => ({ kind: "object", entries });

/** Referência a outro recurso, variável ou função. */
export const ref = (source: string): TofuValue => ({ kind: "expression", source });

/**
 * String com interpolação: `"${var.project}-api"`.
 *
 * Precisa ser expressão, não string: o impressor escapa `${` dentro de literais
 * — é o que impede um nome de recurso digitado no canvas de virar código.
 */
export const interpolated = (template: string): TofuValue =>
  ref(`"${template.replaceAll('"', '\\"')}"`);

export function block(
  type: string,
  labels: string[],
  attributes: [string, TofuValue][] = [],
  blocks: TofuBlock[] = [],
): TofuBlock {
  return { type, labels, attributes, blocks };
}

export const resource = (
  type: string,
  name: string,
  attributes: [string, TofuValue][],
  blocks: TofuBlock[] = [],
): TofuBlock => block("resource", [type, name], attributes, blocks);

export const data = (
  type: string,
  name: string,
  attributes: [string, TofuValue][] = [],
  blocks: TofuBlock[] = [],
): TofuBlock => block("data", [type, name], attributes, blocks);

export const variable = (name: string, attributes: [string, TofuValue][]): TofuBlock =>
  block("variable", [name], attributes);

export const output = (name: string, attributes: [string, TofuValue][]): TofuBlock =>
  block("output", [name], attributes);

/** Endereço do recurso no state — `aws_vpc.main`. */
export function address(block: TofuBlock): string {
  return block.labels.join(".");
}

/** Referência a um atributo de um recurso já declarado. */
export function attributeOf(block: TofuBlock, attribute: string): TofuValue {
  return ref(`${address(block)}.${attribute}`);
}
