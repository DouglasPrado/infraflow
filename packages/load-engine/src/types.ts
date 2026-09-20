import type { LoadGeneratorNode } from "@infraflow/schema";

/**
 * Teste de carga real (PRD §77).
 *
 * "O Load Generator do canvas vira configuração real": os endpoints, os pesos,
 * o perfil e o SLO desenhados no §16–§19 passam a ser o script que o k6 executa.
 * Nada aqui é inventado — o que não está no canvas não entra no teste.
 */

export interface LoadTestSpec {
  /**
   * Latência esperada por requisição, em ms.
   *
   * Dimensiona os VUs pela Lei de Little: sustentar N req/s num alvo de L
   * segundos exige N×L requisições simultâneas. Sem esta pista o gerador
   * chutaria, e chutar baixo faz o **gerador** virar o gargalo — o teste passa
   * a medir a máquina que dispara, não a arquitetura.
   *
   * Vem da estimativa do motor de capacidade. Ausente, assume-se um valor
   * conservador.
   */
  expectedLatencyMs?: number;
  /**
   * Endereço que de fato recebe a carga — o do laboratório.
   *
   * Distinto do `baseUrl` do canvas, que descreve o alvo **pretendido** em
   * produção. Misturar os dois faria o relatório dizer que mediu api.example.com
   * quando mediu um container local.
   */
  baseUrl: string;
  generator: Pick<LoadGeneratorNode, "target" | "endpoints" | "profile" | "slo">;
}

/** Um degrau da escada de carga (PRD §18, §20). */
export interface LadderStep {
  index: number;
  targetRps: number;
  durationSeconds: number;
}
