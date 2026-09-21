import type { TofuBlock, TofuFile, TofuValue } from "./model.ts";

/**
 * Impressão de HCL já no formato canônico do `tofu fmt`.
 *
 * Sair formatado desde a primeira escrita não é capricho: o §74 coloca
 * `tofu fmt` no pipeline, e um gerador que produz algo que o fmt reescreve
 * transforma cada regeneração num diff falso. As regras abaixo foram lidas da
 * saída do próprio `tofu fmt`, não deduzidas:
 *
 * - atributos de **uma linha** consecutivos têm o `=` alinhado entre si;
 * - atributo de várias linhas fica fora de qualquer alinhamento e usa um
 *   espaço só;
 * - linha em branco e bloco aninhado encerram o grupo de alinhamento.
 */

const INDENT = "  ";

/** Escapa para dentro de aspas, inclusive o que o HCL interpolaria. */
function quote(value: string): string {
  const escaped = value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t")
    // `${` e `%{` abrem interpolação; dobrar o sinal é como o HCL os escapa.
    // A substituição vai como função: em texto, `$$` seria lido pelo próprio
    // `replaceAll` como escape de um `$`, e o dobro nunca chegaria à saída.
    .replaceAll("${", () => "$${")
    .replaceAll("%{", () => "%%{");
  return `"${escaped}"`;
}

/** Um valor vira uma ou mais linhas, já sem indentação de contexto. */
function renderValue(value: TofuValue): string[] {
  switch (value.kind) {
    case "string":
      return [quote(value.value)];

    case "number":
      return [Number.isInteger(value.value) ? String(value.value) : String(value.value)];

    case "bool":
      return [value.value ? "true" : "false"];

    case "expression":
      // Expressão pode ocupar várias linhas (um `jsonencode` inteiro, por
      // exemplo). Quebrar aqui é o que faz o alinhamento tratá-la como o fmt
      // trata: fora de qualquer grupo.
      return value.source.split("\n");

    case "heredoc":
      return [
        `<<-${value.tag}`,
        ...value.content
          .replaceAll("${", () => "$${")
          .replaceAll("%{", () => "%%{")
          .trimEnd()
          .split("\n"),
        value.tag,
      ];

    case "list": {
      if (value.items.length === 0) return ["[]"];
      const rendered = value.items.map(renderValue);
      const inline = rendered.every((lines) => lines.length === 1);
      const oneLine = `[${rendered.map((lines) => lines[0]).join(", ")}]`;
      if (inline && oneLine.length <= 60) return [oneLine];

      return [
        "[",
        ...rendered.flatMap((lines) =>
          lines.map((line, index) => `${INDENT}${line}${index === lines.length - 1 ? "," : ""}`),
        ),
        "]",
      ];
    }

    case "object": {
      if (value.entries.length === 0) return ["{}"];
      const rendered = value.entries.map(
        ([key, entry]) => [key, renderValue(entry)] as [string, string[]],
      );
      const width = Math.max(...rendered.map(([key]) => key.length));

      return [
        "{",
        ...rendered.flatMap(([key, lines]) =>
          lines.length === 1
            ? [`${INDENT}${key.padEnd(width)} = ${lines[0]}`]
            : [`${INDENT}${key} = ${lines[0]}`, ...lines.slice(1).map((line) => `${INDENT}${line}`)],
        ),
        "}",
      ];
    }
  }
}

/** Nome do atributo mais o valor, já quebrado em linhas, sem indentação. */
interface Entry {
  name: string;
  lines: string[];
  heredoc?: boolean;
}

function renderAttributes(attributes: [string, TofuValue][]): string[] {
  const entries: Entry[] = attributes.map(([name, value]) => ({
    name,
    lines: renderValue(value),
    ...(value.kind === "heredoc" ? { heredoc: true } : {}),
  }));

  const out: string[] = [];
  let group: Entry[] = [];

  const flush = () => {
    if (group.length === 0) return;
    const width = Math.max(...group.map((entry) => entry.name.length));
    for (const entry of group) {
      out.push(`${entry.name.padEnd(width)} = ${entry.lines[0]}`);
    }
    group = [];
  };

  for (const entry of entries) {
    if (entry.lines.length === 1) {
      group.push(entry);
      continue;
    }

    // Heredoc é exceção: o `<<-TAG` é um token só, então o fmt o mantém no
    // grupo de alinhamento e joga apenas o corpo para fora.
    if (entry.heredoc) {
      group.push({ name: entry.name, lines: [entry.lines[0]!] });
      flush();
      out.push(...entry.lines.slice(1));
      continue;
    }
    // Atributo de várias linhas: fecha o grupo e sai do alinhamento.
    flush();
    out.push(`${entry.name} = ${entry.lines[0]}`, ...entry.lines.slice(1));
  }
  flush();

  return out;
}

export function printBlock(block: TofuBlock): string[] {
  const labels = block.labels.map((label) => quote(label)).join(" ");
  const head = `${block.type}${labels ? ` ${labels}` : ""} {`;

  const body = renderAttributes(block.attributes);

  for (const nested of block.blocks) {
    // Bloco aninhado sempre separado do que veio antes: fecha o alinhamento e
    // dá ao arquivo a respiração que o fmt preserva.
    if (body.length > 0) body.push("");
    body.push(...printBlock(nested));
  }

  return [head, ...body.map((line) => (line === "" ? "" : `${INDENT}${line}`)), "}"];
}

export function printFile(file: TofuFile): string {
  const header = (file.header ?? []).map((line) => (line ? `# ${line}` : "#"));
  const blocks = file.blocks.map((block) => printBlock(block).join("\n"));

  const parts = [...(header.length > 0 ? [header.join("\n")] : []), ...blocks];
  return `${parts.join("\n\n")}\n`;
}
