import Anthropic from "@anthropic-ai/sdk";
import { renderContext, type AssistantContext } from "./context.ts";
import { SYSTEM_PROMPT, TASKS, type AssistantTask } from "./tasks.ts";

/**
 * A ponte com o modelo (PRD §81).
 *
 * O transporte é injetável por um motivo prático: o teste precisa exercitar a
 * montagem do contexto e o formato da resposta sem gastar chamada de API nem
 * depender de credencial.
 */

export interface AssistantRequest {
  task: AssistantTask;
  context: AssistantContext;
  /** Pergunta livre do usuário, dentro do escopo da tarefa. */
  question?: string;
}

export interface AssistantAnswer {
  text: string;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export type AssistantTransport = (request: AssistantRequest) => Promise<AssistantAnswer>;

/** Modelo padrão. Trocar aqui, não espalhado pelas rotas. */
const MODEL = "claude-opus-5";

export function isConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN);
}

function promptFor(request: AssistantRequest): string {
  const task = TASKS[request.task];

  return [
    renderContext(request.context),
    "---",
    `# Tarefa\n\n${task.instruction}`,
    ...(request.question
      ? [`# Pergunta do usuário\n\n${request.question}\n\nResponda dentro do escopo da tarefa acima.`]
      : []),
  ].join("\n\n");
}

/**
 * Transporte real.
 *
 * Usa streaming para o modelo e devolve a mensagem completa: documentação
 * gerada passa de minutos de geração, e requisição não-streaming dessa duração
 * estoura o tempo limite do cliente HTTP. Quem chama continua recebendo uma
 * resposta única.
 */
export function claudeTransport(): AssistantTransport {
  const client = new Anthropic();

  return async (request) => {
    const task = TASKS[request.task];

    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: task.maxTokens,
      // O contexto é grande e estável entre perguntas sobre a mesma versão.
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      thinking: { type: "adaptive" },
      messages: [{ role: "user", content: promptFor(request) }],
    });

    const message = await stream.finalMessage();

    const text = message.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n")
      .trim();

    return {
      text,
      model: message.model,
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      },
    };
  };
}

/** Exposto para teste: é o texto exato que vai ao modelo. */
export const buildPrompt = promptFor;
