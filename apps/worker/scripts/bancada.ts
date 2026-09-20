import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLadder, buildScript, parseSummary } from "@infraflow/load-engine";
import type { LoadTestSpec } from "@infraflow/load-engine";

/**
 * Bancada de aferição do motor de carga (PRD §77).
 *
 * Mede o motor contra um alvo **de resposta conhecida**, não contra o
 * laboratório: só assim dá para separar erro do gerador de limite do alvo. Se o
 * alvo responde em 1ms e aguenta milhares de req/s, tudo que aparecer de
 * divergência entre a carga pedida e a medida é do motor.
 *
 * Uso: node --experimental-strip-types scripts/bancada.ts
 */

export interface Aferição {
  cenário: string;
  pedidoTotal: number;
  medidoTotal: number;
  /** Erro da vazão total, em porcento do pedido. */
  erroVazãoPct: number;
  degraus: {
    pedido: number;
    medido: number;
    erroPct: number;
    p95Ms: number;
    errosPct: number;
  }[];
  descartadas: number;
  /** Veredito do motor sobre de quem foi o teto. */
  teto: string;
  /** Se o k6 considerou os limiares do §19 cumpridos. */
  cumpriuSlo: boolean;
  duraçãoS: number;
  /** Quanto a execução demorou além da escada configurada. */
  atrasoS: number;
}

/** Alvo de resposta constante: um servidor que sabemos que não é o gargalo. */
function alvoConstante(portaEscolhida: number, atrasoMs = 0): { url: string; parar: () => void } {
  const fonte = `
const http = require("node:http");
const atraso = ${atrasoMs};
const servidor = http.createServer((_, res) => {
  const responder = () => { res.writeHead(200, { "content-length": "2" }); res.end("ok"); };
  if (atraso > 0) setTimeout(responder, atraso); else responder();
});
servidor.keepAliveTimeout = 65000;
servidor.maxRequestsPerSocket = 0;
servidor.listen(${portaEscolhida}, "127.0.0.1");
`;
  const arquivo = join(mkdtempSync(join(tmpdir(), "alvo-")), "alvo.js");
  writeFileSync(arquivo, fonte);

  const processo = spawnSync("bash", ["-c", `nohup node ${arquivo} >/dev/null 2>&1 & echo $!`], {
    encoding: "utf8",
  });
  const pid = Number(processo.stdout.trim());

  // Espera o alvo aceitar conexão antes de medir qualquer coisa.
  const limite = Date.now() + 10_000;
  for (;;) {
    const pronto = spawnSync("curl", ["-sf", "-o", "/dev/null", `http://127.0.0.1:${portaEscolhida}/`]);
    if (pronto.status === 0) break;
    if (Date.now() > limite) throw new Error("o alvo de aferição não subiu");
    spawnSync("sleep", ["0.2"]);
  }

  return {
    url: `http://127.0.0.1:${portaEscolhida}`,
    parar: () => {
      if (Number.isFinite(pid)) process.kill(pid, "SIGKILL");
      rmSync(arquivo, { force: true });
    },
  };
}

export function medir(cenário: string, spec: LoadTestSpec): Aferição {
  const ladder = buildLadder(spec);
  const diretório = mkdtempSync(join(tmpdir(), "bancada-"));
  writeFileSync(join(diretório, "loadtest.js"), buildScript(spec));

  const início = new Date();
  const execução = spawnSync("k6", ["run", "--no-color", "--quiet", "loadtest.js"], {
    cwd: diretório,
    encoding: "utf8",
    timeout: 10 * 60 * 1000,
  });
  const fim = new Date();

  if (execução.status !== 0 && execução.status !== 99) {
    throw new Error(`k6 falhou (${execução.status}):\n${execução.stderr?.slice(-600)}`);
  }

  const resumo = JSON.parse(readFileSync(join(diretório, "summary.json"), "utf8")) as unknown;
  const observação = parseSummary(resumo, { ladder, startedAt: início, finishedAt: fim });
  rmSync(diretório, { recursive: true, force: true });

  const pedidoTotal = ladder.reduce((soma, degrau) => soma + degrau.targetRps * degrau.durationSeconds, 0);
  const escadaS = ladder.reduce((soma, degrau) => soma + degrau.durationSeconds, 0);

  return {
    cenário,
    pedidoTotal,
    medidoTotal: observação.requests,
    erroVazãoPct: ((observação.requests - pedidoTotal) / pedidoTotal) * 100,
    degraus: observação.stages.map((degrau) => ({
      pedido: degrau.targetRps,
      medido: Math.round(degrau.rps),
      erroPct: ((degrau.rps - degrau.targetRps) / degrau.targetRps) * 100,
      p95Ms: Math.round(degrau.p95Ms * 10) / 10,
      errosPct: Math.round(degrau.errorRatePct * 100) / 100,
    })),
    descartadas: observação.droppedIterations,
    teto: observação.loadCeiling,
    cumpriuSlo: observação.meetsSlo,
    duraçãoS: Math.round(observação.durationSeconds * 10) / 10,
    atrasoS: Math.round((observação.durationSeconds - escadaS) * 10) / 10,
  };
}

export function specDe(
  baseUrl: string,
  perfil: { startRps: number; incrementRps: number; intervalSeconds: number; maxRps: number },
  endpoints = [{ id: "a", method: "GET" as const, path: "/", weight: 100 }],
): LoadTestSpec {
  return {
    baseUrl,
    generator: {
      target: {
        protocol: "HTTP",
        baseUrl,
        headers: "",
        authentication: "",
        timeoutMs: 10_000,
      },
      endpoints,
      profile: { type: "Capacity", ...perfil },
      slo: { p95Ms: 500, p99Ms: 1000, errorRatePct: 1 },
    },
  };
}

/**
 * Alvo de **capacidade conhecida**: uma fila M/M/1 de verdade.
 *
 * Node é monotarefa, então ocupar a thread por `serviçoMs` serializa o
 * atendimento — a capacidade é exatamente `1000 / serviçoMs` req/s. É o alvo
 * que permite comparar o que o motor de capacidade prevê com o que acontece.
 */
export function alvoComFila(porta: number, serviçoMs: number): { url: string; capacidadeRps: number; parar: () => void } {
  const fonte = `
const http = require("node:http");
const servico = ${serviçoMs};
const servidor = http.createServer((_, res) => {
  // Ocupa a thread: o próximo pedido espera, como numa fila de servidor único.
  const fim = Date.now() + servico;
  while (Date.now() < fim) {}
  res.writeHead(200, { "content-length": "2" });
  res.end("ok");
});
servidor.keepAliveTimeout = 65000;
servidor.maxRequestsPerSocket = 0;
servidor.listen(${porta}, "127.0.0.1");
`;
  const arquivo = join(mkdtempSync(join(tmpdir(), "fila-")), "fila.js");
  writeFileSync(arquivo, fonte);

  const processo = spawnSync("bash", ["-c", `nohup node ${arquivo} >/dev/null 2>&1 & echo $!`], {
    encoding: "utf8",
  });
  const pid = Number(processo.stdout.trim());

  const limite = Date.now() + 10_000;
  for (;;) {
    const pronto = spawnSync("curl", ["-sf", "-o", "/dev/null", "--max-time", "5", `http://127.0.0.1:${porta}/`]);
    if (pronto.status === 0) break;
    if (Date.now() > limite) throw new Error("o alvo com fila não subiu");
    spawnSync("sleep", ["0.2"]);
  }

  return {
    url: `http://127.0.0.1:${porta}`,
    capacidadeRps: Math.round(1000 / serviçoMs),
    parar: () => {
      if (Number.isFinite(pid)) process.kill(pid, "SIGKILL");
      rmSync(arquivo, { force: true });
    },
  };
}

/**
 * Alvo de serviço **variável**: fila com tempo de atendimento exponencial.
 *
 * O `alvoComFila` atende sempre no mesmo tempo, o que é o melhor caso possível
 * e quase não forma fila. Serviço exponencial é a hipótese que o motor de
 * capacidade assume (M/M/1) — este alvo é o que permite saber se a previsão
 * está calibrada ou só pessimista.
 */
export function alvoVariável(porta: number, médiaMs: number): { url: string; capacidadeRps: number; parar: () => void } {
  const fonte = `
const http = require("node:http");
const media = ${médiaMs};
// Inverso da exponencial: média preservada, variância igual à da teoria.
const amostra = () => -Math.log(1 - Math.random()) * media;
const servidor = http.createServer((_, res) => {
  const fim = Date.now() + amostra();
  while (Date.now() < fim) {}
  res.writeHead(200, { "content-length": "2" });
  res.end("ok");
});
servidor.keepAliveTimeout = 65000;
servidor.maxRequestsPerSocket = 0;
servidor.listen(${porta}, "127.0.0.1");
`;
  const arquivo = join(mkdtempSync(join(tmpdir(), "expo-")), "expo.js");
  writeFileSync(arquivo, fonte);

  const processo = spawnSync("bash", ["-c", `nohup node ${arquivo} >/dev/null 2>&1 & echo $!`], {
    encoding: "utf8",
  });
  const pid = Number(processo.stdout.trim());

  const limite = Date.now() + 10_000;
  for (;;) {
    const pronto = spawnSync("curl", ["-sf", "-o", "/dev/null", "--max-time", "5", `http://127.0.0.1:${porta}/`]);
    if (pronto.status === 0) break;
    if (Date.now() > limite) throw new Error("o alvo variável não subiu");
    spawnSync("sleep", ["0.2"]);
  }

  return {
    url: `http://127.0.0.1:${porta}`,
    capacidadeRps: Math.round(1000 / médiaMs),
    parar: () => {
      if (Number.isFinite(pid)) process.kill(pid, "SIGKILL");
      rmSync(arquivo, { force: true });
    },
  };
}

/**
 * Alvo que **conta por caminho**, para conferir os pesos do workload (§17).
 *
 * Se o sorteio do script erra a proporção, o teste mede uma mistura que ninguém
 * desenhou — e o número final descreve outra aplicação.
 */
export function alvoContador(porta: number, atrasoMs = 0): {
  url: string;
  contagem: () => Record<string, number>;
  parar: () => void;
} {
  const fonte = `
const http = require("node:http");
const contagem = Object.create(null);
const servidor = http.createServer((req, res) => {
  if (req.url === "/__contagem") {
    const corpo = JSON.stringify(contagem);
    res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(corpo) });
    return res.end(corpo);
  }
  contagem[req.url] = (contagem[req.url] || 0) + 1;
  const responder = () => {
    res.writeHead(200, { "content-length": "2" });
    res.end("ok");
  };
  ${"$"}{0}
  if (${atrasoMs} > 0) setTimeout(responder, ${atrasoMs}); else responder();
});
servidor.keepAliveTimeout = 65000;
servidor.maxRequestsPerSocket = 0;
servidor.listen(${porta}, "127.0.0.1");
`.replace("${0}", "");
  const arquivo = join(mkdtempSync(join(tmpdir(), "contador-")), "contador.js");
  writeFileSync(arquivo, fonte);

  const processo = spawnSync("bash", ["-c", `nohup node ${arquivo} >/dev/null 2>&1 & echo $!`], {
    encoding: "utf8",
  });
  const pid = Number(processo.stdout.trim());

  const limite = Date.now() + 10_000;
  for (;;) {
    const pronto = spawnSync("curl", ["-sf", "-o", "/dev/null", "--max-time", "5", `http://127.0.0.1:${porta}/__contagem`]);
    if (pronto.status === 0) break;
    if (Date.now() > limite) throw new Error("o alvo contador não subiu");
    spawnSync("sleep", ["0.2"]);
  }

  return {
    url: `http://127.0.0.1:${porta}`,
    contagem: () => {
      const saída = spawnSync("curl", ["-s", `http://127.0.0.1:${porta}/__contagem`], { encoding: "utf8" });
      return JSON.parse(saída.stdout || "{}") as Record<string, number>;
    },
    parar: () => {
      if (Number.isFinite(pid)) process.kill(pid, "SIGKILL");
      rmSync(arquivo, { force: true });
    },
  };
}

export { alvoConstante };
