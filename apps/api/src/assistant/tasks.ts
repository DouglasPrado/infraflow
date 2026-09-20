/**
 * O que o assistente pode fazer (PRD §81), e nada além disso.
 *
 * Cada tarefa é um pedido fechado sobre o contexto que o sistema já produziu.
 * Não existe "pergunte qualquer coisa": o §81 lista seis usos, e um assistente
 * sem escopo acabaria respondendo sobre infraestrutura que ninguém desenhou.
 */

export const ASSISTANT_TASKS = [
  "explain-architecture",
  "explain-bottleneck",
  "suggest-improvements",
  "explain-tradeoffs",
  "generate-documentation",
  "prepare-agent-instructions",
] as const;

export type AssistantTask = (typeof ASSISTANT_TASKS)[number];

/**
 * Regras que valem para toda tarefa.
 *
 * A mais importante é a última: o §85 trata confundir estimativa com medição
 * como risco do produto, e um assistente é exatamente onde essa confusão
 * aconteceria sem ninguém perceber.
 */
export const SYSTEM_PROMPT = `Você é o assistente do InfraFlow, uma ferramenta de planejamento e teste de infraestrutura.

Responda em português do Brasil, com precisão e sem enfeite.

Regras que não se quebram:

1. Use **apenas** os dados do contexto fornecido. Ele é a saída do próprio
   sistema: o grafo desenhado, a validação, a estimativa de capacidade, a
   compilação para OpenTofu, o plano, o laboratório e a medição.
2. Nunca invente número. Se o contexto não traz um dado, diga que ele não existe
   e o que precisa ser executado para obtê-lo.
3. Distinga as três leituras e nomeie qual está usando:
   - **Estimated**: vem do modelo de capacidade, a partir de valores declarados
     no registry. É estimativa.
   - **Planned**: vem do \`tofu plan\`. É intenção conferida contra o provider.
   - **Observed**: vem do teste de carga real e das métricas coletadas. É medição.
   Apresentar estimativa como resultado medido é o erro mais grave possível aqui.
4. Quando a análise de gargalo diz que não é possível concluir, repita o motivo
   em vez de escolher um culpado.
5. Cite o recurso pelo nome que aparece no canvas.
6. Seja breve. Markdown, sem títulos decorativos, sem repetir o contexto.`;

interface TaskDefinition {
  /** Rótulo curto, exibido na interface. */
  label: string;
  /** Uma linha: o que esta tarefa responde. */
  description: string;
  instruction: string;
  /** Teto de saída. Documentação precisa de mais espaço que uma explicação. */
  maxTokens: number;
}

export const TASKS: Record<AssistantTask, TaskDefinition> = {
  "explain-architecture": {
    label: "Explicar arquitetura",
    description: "O que foi desenhado e como as peças se ligam",
    maxTokens: 4000,
    instruction: `Explique esta arquitetura: o que ela faz, por onde o tráfego entra, que
caminho percorre e qual é o papel de cada recurso. Aponte o que a validação
encontrou, se encontrou algo. Termine com a leitura de capacidade e custo,
dizendo de qual das três leituras ela vem.`,
  },

  "explain-bottleneck": {
    label: "Explicar gargalo",
    description: "Onde a arquitetura cede e por quê",
    maxTokens: 4000,
    instruction: `Explique onde esta arquitetura cede e por quê.

Se houver medição, use-a: diga qual recurso foi apontado, com que evidência e
com que confiança. Se a análise disser que não é possível concluir, explique o
motivo e o que precisa ser feito para conseguir uma conclusão.

Se não houver medição nenhuma, diga isso claramente e explique qual recurso o
**modelo** indica como limitante — deixando explícito que é estimativa.`,
  },

  "suggest-improvements": {
    label: "Sugerir melhorias",
    description: "O que mudar, e o que cada mudança custa",
    maxTokens: 4000,
    instruction: `Proponha no máximo cinco mudanças concretas nesta arquitetura, em ordem de
impacto. Para cada uma diga: o recurso e a propriedade a mexer, o efeito
esperado e o custo aproximado da mudança.

Baseie-se no que o contexto mostra — achados da validação, gargalo observado,
avisos de compilação. Não proponha o que já está feito.`,
  },

  "explain-tradeoffs": {
    label: "Explicar tradeoffs",
    description: "O que cada escolha do desenho está trocando",
    maxTokens: 4000,
    instruction: `Aponte os tradeoffs deste desenho: onde ele troca custo por capacidade,
disponibilidade por simplicidade, latência por consistência. Use as escolhas
que estão no contexto — classe de instância, réplicas, Multi-AZ, cache,
política de despejo.

Para cada tradeoff, diga em que situação a escolha atual é a certa e em que
situação ela deixa de ser.`,
  },

  "generate-documentation": {
    label: "Gerar documentação",
    description: "Um texto que descreve a arquitetura para quem chega agora",
    maxTokens: 8000,
    instruction: `Escreva a documentação desta arquitetura em Markdown, para alguém que vai
operá-la e nunca a viu. Cubra: visão geral, recursos e configuração, fluxo do
tráfego, capacidade e custo, o que foi medido e o que não foi, riscos
conhecidos.

Não repita o architecture.json em bloco: descreva o que ele significa.`,
  },

  "prepare-agent-instructions": {
    label: "Instruções para agente",
    description: "O que um agente de código precisa para implementar isto",
    maxTokens: 8000,
    instruction: `Escreva instruções em Markdown para um agente de código implementar esta
infraestrutura, no espírito do GOAL.md do PRD §32.

Seja específico sobre o que já existe (os arquivos de OpenTofu são gerados pelo
InfraFlow), o que precisa de decisão humana, e o que a validação e a compilação
já apontaram como pendência. Deixe claro que o \`architecture.json\` tem
prioridade sobre qualquer documento gerado.`,
  },
};
