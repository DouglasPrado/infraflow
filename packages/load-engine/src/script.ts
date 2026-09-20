import { evaluate, graphFromDocument, ladderFor } from "@infraflow/analyzer";
import { isLoadGeneratorNode, type ArchitectureDocument } from "@infraflow/schema";
import type { LadderStep, LoadTestSpec } from "./types.ts";

/**
 * Do canvas para o script do k6 (PRD §77).
 *
 * A escada de carga vem de `ladderFor`, a **mesma** que o motor de estimativa
 * usa: se as duas divergissem, comparar estimado com observado (§79) compararia
 * coisas diferentes.
 */

/** Os degraus que o k6 vai executar, na ordem (PRD §18). */
export function buildLadder(spec: LoadTestSpec): LadderStep[] {
  const { profile } = spec.generator;
  return ladderFor(profile).map((targetRps, index) => ({
    index: index + 1,
    targetRps,
    durationSeconds: Math.max(1, Math.round(profile.intervalSeconds)),
  }));
}

/** Cabeçalhos escritos no painel, em `Chave: valor` por linha ou vírgula. */
function parseHeaders(raw: string, authentication: string): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const entry of raw.split(/[\n,]/)) {
    const separator = entry.indexOf(":");
    if (separator <= 0) continue;
    const key = entry.slice(0, separator).trim();
    const value = entry.slice(separator + 1).trim();
    if (key && value) headers[key] = value;
  }

  const auth = authentication.trim();
  if (auth) headers.Authorization = auth;

  return headers;
}

/**
 * Latência assumida quando ninguém informa uma. Deliberadamente folgada: errar
 * para cima custa memória, errar para baixo custa a validade da medição.
 */
const LATÊNCIA_PADRÃO_MS = 250;

/**
 * Quantos VUs reservar, pela Lei de Little.
 *
 * O `ramping-arrival-rate` mantém a taxa **pedida**, não a que o alvo aguenta:
 * sustentar N req/s com latência L exige N×L requisições simultâneas. Faltando
 * VU, o k6 descarta iterações — e isso vira limite do gerador disfarçado de
 * limite da arquitetura.
 *
 * Reserva-se com folga porque a latência **sobe** perto da saturação, que é
 * justamente onde a medição importa; e o teto cobre a subida sem deixar um
 * perfil agressivo pedir mais VU do que a máquina aguenta.
 */
function vus(maxRps: number, expectedLatencyMs: number): { preAllocated: number; max: number } {
  const simultâneas = (maxRps * Math.max(1, expectedLatencyMs)) / 1000;

  return {
    preAllocated: Math.min(1000, Math.max(10, Math.ceil(simultâneas * 1.5))),
    max: Math.min(3000, Math.max(50, Math.ceil(simultâneas * 4))),
  };
}

const json = (value: unknown) => JSON.stringify(value);

/**
 * Gera o script. Determinístico: a mesma configuração produz o mesmo texto.
 *
 * Os limiares por degrau existem por um motivo técnico do k6: submétrica com
 * rótulo só aparece no resumo quando há um limiar declarado para ela. Os
 * limiares `>= 0` são sempre verdadeiros — servem para **fazer o k6 publicar**
 * a medição de cada degrau, que é o que o §20 precisa mostrar.
 */
export function buildScript(spec: LoadTestSpec): string {
  const { target, endpoints, profile, slo } = spec.generator;
  const ladder = buildLadder(spec);
  const pool = vus(profile.maxRps, spec.expectedLatencyMs ?? LATÊNCIA_PADRÃO_MS);

  const total = endpoints.reduce((sum, endpoint) => sum + endpoint.weight, 0);
  const weighted = endpoints.map((endpoint) => ({
    method: endpoint.method,
    path: endpoint.path,
    // Pesos que não somam 100 são normalizados: o canvas permite qualquer valor.
    share: total > 0 ? endpoint.weight / total : 1 / Math.max(1, endpoints.length),
  }));

  const stages = ladder.flatMap((step) => [
    // Duração zero faz o degrau ser degrau: sem ela o k6 interpola a subida.
    { target: step.targetRps, duration: "0s" },
    { target: step.targetRps, duration: `${step.durationSeconds}s` },
  ]);

  const stageThresholds = ladder.flatMap((step) => [
    [`http_req_duration{stage:${step.index}}`, ["p(95)>=0"]],
    [`http_req_failed{stage:${step.index}}`, ["rate>=0"]],
    [`http_reqs{stage:${step.index}}`, ["count>=0"]],
  ]);

  const boundaries = ladder.map((step, index) => ({
    stage: step.index,
    endsAt: ladder.slice(0, index + 1).reduce((sum, entry) => sum + entry.durationSeconds, 0),
  }));

  return `// Gerado pelo InfraFlow a partir do Load Generator do canvas (PRD §16-§19, §77).
// Não editar: recompile a partir do desenho.
import exec from "k6/execution";
import http from "k6/http";

const BASE_URL = ${json(spec.baseUrl)};
const HEADERS = ${json(parseHeaders(target.headers, target.authentication))};
const TIMEOUT = ${json(`${Math.max(1000, Math.round(target.timeoutMs))}ms`)};
const ENDPOINTS = ${json(weighted)};
const BOUNDARIES = ${json(boundaries)};

export const options = {
  // O corpo não interessa: mede-se vazão e latência, não conteúdo.
  discardResponseBodies: true,
  summaryTrendStats: ["avg", "min", "med", "max", "p(50)", "p(95)", "p(99)"],
  scenarios: {
    capacity: {
      executor: "ramping-arrival-rate",
      startRate: ${json(profile.startRps)},
      timeUnit: "1s",
      preAllocatedVUs: ${json(pool.preAllocated)},
      maxVUs: ${json(pool.max)},
      stages: ${json(stages)},
    },
  },
  thresholds: {
    // O SLO do §19, verificado pelo próprio k6.
    "http_req_duration": ["p(95)<${slo.p95Ms}", "p(99)<${slo.p99Ms}"],
    "http_req_failed": ["rate<${slo.errorRatePct / 100}"],
${stageThresholds.map(([name, rules]) => `    ${json(name)}: ${json(rules)},`).join("\n")}
  },
};

/**
 * Em que degrau da escada a requisição está sendo disparada.
 *
 * O relógio é o do cenário, não do VU. Código de módulo roda uma vez por VU, e
 * o executor cria VUs durante a execução quando a latência sobe: um VU nascido
 * no meio do teste acharia que o teste acabou de começar e marcaria tudo como
 * primeiro degrau. O startTime do cenário é o mesmo para todos os VUs,
 * inclusive os que chegam depois.
 */
function currentStage() {
  const elapsed = (Date.now() - exec.scenario.startTime) / 1000;
  for (const boundary of BOUNDARIES) {
    if (elapsed < boundary.endsAt) return String(boundary.stage);
  }
  return String(BOUNDARIES.length);
}

/** Sorteia o endpoint conforme o peso configurado no workload (§17). */
function pick() {
  let roll = Math.random();
  for (const endpoint of ENDPOINTS) {
    roll -= endpoint.share;
    if (roll <= 0) return endpoint;
  }
  return ENDPOINTS[ENDPOINTS.length - 1];
}

export default function () {
  const endpoint = pick();
  const tags = { stage: currentStage(), endpoint: endpoint.path };

  http.request(endpoint.method, BASE_URL + endpoint.path, null, {
    headers: HEADERS,
    timeout: TIMEOUT,
    tags: tags,
  });
}

export function handleSummary(data) {
  return { "summary.json": JSON.stringify(data) };
}
`;
}

/**
 * Latência que o dimensionador deve assumir, vinda da estimativa (PRD §79).
 *
 * O teto da escada é o degrau mais pesado, e é dele que o pool precisa dar
 * conta: dimensionar pela latência do primeiro degrau deixaria o gerador sem
 * fôlego justamente onde a medição importa.
 *
 * Isto é **estimativa alimentando a instrumentação**, não estimativa virando
 * resultado. O número escolhido aqui não entra em nenhuma leitura do §85 — se
 * estiver errado, o que aparece é descarte, não um valor inventado.
 */
export function expectedLatencyFor(document: ArchitectureDocument): number | undefined {
  const generator = document.nodes.find(isLoadGeneratorNode);
  if (!generator) return undefined;

  const { profile, slo } = generator;
  const ladder = ladderFor(profile);
  const topo = ladder[ladder.length - 1];
  if (topo === undefined) return undefined;

  const previsto = evaluate(graphFromDocument(document), topo, slo).p95Ms;
  if (!Number.isFinite(previsto) || previsto <= 0) return undefined;

  /**
   * Teto de sanidade: perto da saturação a previsão dispara, e reservar VU por
   * uma latência de minutos consumiria memória sem melhorar medição alguma.
   */
  return Math.min(previsto, 10_000);
}
