/** Entrada do motor de análise: o grafo já resolvido para números. */
export interface AnalyzerNode {
  id: string;
  /** Tipo do registry, usado só para rotular. */
  type: string;
  /** Requisições por segundo que o recurso aguenta como está configurado. */
  capacityRps: number;
  /** Tempo para atender uma requisição sem fila, em ms. */
  serviceTimeMs: number;
  /** Fração do tráfego que o recurso responde sozinho, sem acionar os de trás. */
  cacheHitRatio: number;
  /** Conexões ou execuções simultâneas permitidas, quando o recurso tem limite. */
  concurrencyLimit?: number;
}

export interface AnalyzerEdge {
  source: string;
  target: string;
}

/** PRD §19 — critérios que definem "saudável". */
export interface Slo {
  p95Ms: number;
  p99Ms: number;
  errorRatePct: number;
}

/** PRD §18 — perfil de carga configurado no Load Generator. */
export interface LoadProfile {
  startRps: number;
  incrementRps: number;
  maxRps: number;
}

export interface Graph {
  /** Ids que originam carga — os Load Generators do canvas. */
  origins: string[];
  nodes: AnalyzerNode[];
  edges: AnalyzerEdge[];
}

/** Situação de um recurso sob uma carga específica. */
export interface NodeLoad {
  nodeId: string;
  /** Requisições por segundo que chegam a este recurso. */
  arrivalRps: number;
  /** `arrivalRps / capacityRps`. Acima de 1 o recurso não dá conta. */
  utilization: number;
  /** Tempo de resposta do recurso já com fila, em ms. */
  latencyMs: number;
  /** Fração das requisições que ele recusa por saturação. */
  rejectedRatio: number;
  /** Simultaneidade em uso, pela Lei de Little. */
  concurrency: number;
}

export type Verdict = "ok" | "warning" | "fail";

/** Vazão de um trecho do grafo (PRD §22). */
export interface EdgeFlow {
  source: string;
  target: string;
  rps: number;
}

/** Resultado de aplicar uma carga ao grafo. */
export interface LoadPoint {
  offeredRps: number;
  nodes: NodeLoad[];
  /** Quanto passa por cada conexão — nem todo trecho carrega o mesmo. */
  edges: EdgeFlow[];
  /** Latência média fim a fim pelo caminho mais lento, em ms. */
  meanMs: number;
  p95Ms: number;
  p99Ms: number;
  errorRatePct: number;
  meetsSlo: boolean;
  verdict: Verdict;
  /** Recurso mais saturado nesta carga. */
  bottleneckNodeId?: string;
}
