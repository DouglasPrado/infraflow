import { analyzeObserved, estimate, type ObservedAnalysis } from "@infraflow/analyzer";
import { compile } from "@infraflow/compiler";
import {
  toArchitectureJson,
  type ArchitectureDocument,
  type LoadTestObservation,
  type PlanSummary,
} from "@infraflow/schema";
import { summarize, validateArchitecture, type ValidationIssue } from "@infraflow/validator";

/**
 * O que o assistente sabe (PRD §81).
 *
 * O §81 é explícito: IA só depois do motor determinístico funcionar. Isso não é
 * ordem de construção, é fonte de dados — tudo aqui é **saída do próprio
 * sistema**: a validação do §72, a estimativa do §23, os avisos de compilação
 * do §74, o plano do §75, o laboratório do §76, a medição do §77/§78 e o
 * gargalo do §79.
 *
 * O que o sistema não sabe fica registrado como ausência, em vez de virar
 * espaço em branco que o modelo preenche por conta própria.
 */

export interface ObservedContext {
  runId: string;
  observation: LoadTestObservation;
  analysis: ObservedAnalysis;
}

export interface AssistantContext {
  document: ArchitectureDocument;
  version: number;
  validation: ValidationIssue[];
  compileWarnings: { code: string; message: string; hint?: string }[];
  plan?: { runId: string; summary: PlanSummary };
  lab?: { slug: string; status: string; entryUrl: string | null };
  observed?: ObservedContext;
}

export interface BuildContextInput {
  document: ArchitectureDocument;
  version: number;
  plan?: { runId: string; summary: PlanSummary };
  lab?: { slug: string; status: string; entryUrl: string | null };
  observation?: { runId: string; observation: LoadTestObservation };
}

export function buildContext(input: BuildContextInput): AssistantContext {
  const { warnings } = compile(input.document, { target: "aws" });

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
    ...(input.lab ? { lab: input.lab } : {}),
    ...(input.observation
      ? {
          observed: {
            runId: input.observation.runId,
            observation: input.observation.observation,
            analysis: analyzeObserved(input.document, input.observation.observation),
          },
        }
      : {}),
  };
}

const list = (items: string[], empty: string) =>
  items.length === 0 ? empty : items.map((item) => `- ${item}`).join("\n");

/** Pico por recurso e métrica — a série inteira não cabe e não acrescenta. */
function peaks(observed: ObservedContext): string[] {
  const highest = new Map<string, { value: number; unit: string }>();

  for (const sample of observed.observation.metrics) {
    const key = `${sample.nodeId} · ${sample.metric}`;
    const current = highest.get(key);
    if (!current || sample.value > current.value) {
      highest.set(key, { value: sample.value, unit: sample.unit });
    }
  }

  return [...highest.entries()].map(
    ([key, entry]) => `${key}: pico ${entry.value.toFixed(1)}${entry.unit}`,
  );
}

/**
 * O contexto em texto, como vai para o modelo.
 *
 * Cada bloco diz de onde veio: `Estimated` sai do modelo de capacidade,
 * `Planned` do OpenTofu e `Observed` da execução real (PRD §85). Misturar os
 * três no prompt é a forma mais rápida de o assistente apresentar estimativa
 * como resultado.
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

  sections.push(
    context.lab
      ? `# Laboratório (PRD §76)

- Ambiente: ${context.lab.slug}
- Estado: ${context.lab.status}
- Entrada: ${context.lab.entryUrl ?? "não publicada"}`
      : `# Laboratório (PRD §76)

_Nenhum laboratório foi criado._`,
  );

  if (context.observed) {
    const { observation, analysis, runId } = context.observed;

    sections.push(`# Observed (teste de carga real, PRD §77, §78) — execução ${runId}

- Janela: ${observation.startedAt} → ${observation.finishedAt}
- Requisições: ${observation.requests}
- Vazão sustentada: ${observation.rps.toFixed(0)} req/s
- p50 / p95 / p99: ${observation.p50Ms.toFixed(0)}ms / ${observation.p95Ms.toFixed(0)}ms / ${observation.p99Ms.toFixed(0)}ms
- Erros: ${observation.errorRatePct.toFixed(2)}%
- SLO: ${observation.meetsSlo ? "cumprido" : "violado"}
- Iterações não disparadas: ${observation.droppedIterations}${
    observation.loadCeiling === "generator"
      ? " (teto do gerador: o alvo seguia saudável, a medição subestima a arquitetura)"
      : observation.loadCeiling === "architecture"
        ? " (teto da arquitetura: o alvo saturou, o platô medido é o limite real)"
        : ""
  }

## Escada de carga

${list(
  observation.stages.map(
    (stage) =>
      `pedido ${stage.targetRps} req/s → alcançado ${stage.rps.toFixed(0)} req/s · p95 ${stage.p95Ms.toFixed(0)}ms · erros ${stage.errorRatePct.toFixed(2)}%`,
  ),
  "_Sem degraus._",
)}

## Métricas por recurso (PRD §78)

${list(peaks(context.observed), "_Nenhuma métrica coletada._")}

## Gargalo observado (PRD §79)

- Maior vazão dentro do SLO: ${analysis.maxHealthyRps.toFixed(0)} req/s
- Ponto de ruptura: ${analysis.breakingStage ? `${analysis.breakingStage.targetRps} req/s` : "não alcançado"}
${
  analysis.inconclusive
    ? `- Conclusão: ${analysis.inconclusive}`
    : list(
        analysis.candidates.map(
          (candidate) =>
            `${candidate.nodeId} · ${candidate.metric} ${candidate.value.toFixed(1)}${candidate.unit} · confiança ${candidate.confidence.toFixed(2)} · ${candidate.reason}`,
        ),
        "_Sem candidatos._",
      )
}`);
  } else {
    sections.push(`# Observed (PRD §77, §78, §79)

_Nenhum teste de carga foi executado nesta arquitetura. Não há medição: qualquer
afirmação sobre desempenho real seria especulação._`);
  }

  return sections.join("\n\n---\n\n");
}
