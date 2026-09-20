import { estimate } from "@infraflow/analyzer";
import { compile } from "@infraflow/compiler";
import { toArchitectureJson, type ArchitectureDocument, type PlanSummary } from "@infraflow/schema";
import { summarize, validateArchitecture, type ValidationIssue } from "@infraflow/validator";

/**
 * O que o assistente sabe (PRD §81).
 *
 * O §81 é explícito: IA só depois do motor determinístico funcionar. Isso não é
 * ordem de construção, é fonte de dados — tudo aqui é **saída do próprio
 * sistema**: a validação do §72, a estimativa do §23, os avisos de compilação
 * do §74 e o plano do §75.
 *
 * O que o sistema não sabe fica registrado como ausência, em vez de virar
 * espaço em branco que o modelo preenche por conta própria.
 */

export interface AssistantContext {
  document: ArchitectureDocument;
  version: number;
  validation: ValidationIssue[];
  compileWarnings: { code: string; message: string; hint?: string }[];
  plan?: { runId: string; summary: PlanSummary };
}

export interface BuildContextInput {
  document: ArchitectureDocument;
  version: number;
  plan?: { runId: string; summary: PlanSummary };
}

export function buildContext(input: BuildContextInput): AssistantContext {
  const { warnings } = compile(input.document);

  return {
    document: input.document,
    version: input.version,
    validation: validateArchitecture(input.document),
    compileWarnings: warnings.map((warning) => ({
      code: warning.code,
      message: warning.message,
      ...(warning.hint ? { hint: warning.hint } : {}),
    })),
    ...(input.plan ? { plan: input.plan } : {}),
  };
}

const list = (items: string[], empty: string) =>
  items.length === 0 ? empty : items.map((item) => `- ${item}`).join("\n");

/**
 * O contexto em texto, como vai para o modelo.
 *
 * Cada bloco diz de onde veio: `Estimated` sai do modelo de capacidade e
 * `Planned` do OpenTofu (PRD §85). Não há medição no sistema, e o contexto diz
 * isso — senão o assistente apresenta estimativa como resultado.
 */
export function renderContext(context: AssistantContext): string {
  const numbers = estimate(context.document);
  const validation = summarize(context.validation);

  const sections: string[] = [
    `# architecture.json (fonte estruturada, PRD §33)

\`\`\`json
${JSON.stringify(toArchitectureJson(context.document), null, 2)}
\`\`\``,

    `# Estimated (modelo de capacidade, PRD §23, §40)

- Capacidade de planejamento: ${numbers.capacityRps} req/s
- Custo mensal: US$ ${numbers.monthlyCostUsd}
- Recursos: ${numbers.resourceCount}
- Versão da arquitetura: v${context.version}

Estes números vêm de capacidades declaradas no registry, não de medição.`,

    `# Validação (PRD §72) — ${validation.errors} erro(s), ${validation.warnings} aviso(s)

${list(
  context.validation.map(
    (issue) => `[${issue.severity}/${issue.category}] ${issue.subjectId}: ${issue.message}`,
  ),
  "_Nenhum problema encontrado._",
)}`,

    `# Compilação para OpenTofu (PRD §74)

${list(
  context.compileWarnings.map((warning) => `[${warning.code}] ${warning.message}`),
  "_Sem avisos._",
)}`,
  ];

  sections.push(
    context.plan
      ? `# Planned (tofu plan, PRD §75) — execução ${context.plan.runId}

- Criar: ${context.plan.summary.add} · Alterar: ${context.plan.summary.change} · Destruir: ${context.plan.summary.destroy}
- Alvo: ${context.plan.summary.target}

${list(
  context.plan.summary.changes.slice(0, 40).map((change) => `${change.action} ${change.address}`),
  "_Sem mudanças._",
)}`
      : `# Planned (PRD §75)

_Nenhum \`tofu plan\` foi executado nesta arquitetura._`,
  );

  sections.push(`# Observed

_O sistema não mede execução real: todo número acima é estimativa do motor de
capacidade sobre os recursos configurados no canvas._`);

  return sections.join("\n\n---\n\n");
}
