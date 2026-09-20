import { evaluate } from "@infraflow/analyzer";
import {
  alvoComFila,
  alvoConstante,
  alvoContador,
  alvoVariável,
  medir,
  specDe,
} from "./bancada.ts";

/**
 * Bancada de calibração do motor de carga.
 *
 * `node --experimental-strip-types scripts/calibrar.ts`
 *
 * Mede o gerador contra alvos de latência e capacidade **conhecidas**, para que
 * qualquer divergência só possa ter vindo dele. É o contraponto dos testes de
 * `packages/load-engine`: lá se verifica o script gerado, aqui se verifica o
 * que o k6 de fato produz quando roda.
 *
 * Não é teste automatizado — pede k6 instalado, sobe servidores locais e leva
 * alguns minutos. Roda à mão quando o gerador muda.
 */

let falhas = 0;
const confere = (ok: boolean, descrição: string) => {
  if (!ok) falhas += 1;
  console.log(`  ${ok ? "OK  " : "ERRO"} ${descrição}`);
};

// --- 1. Fidelidade da vazão em alvos de latência conhecida ---------------
console.log("\n1. vazão pedida contra vazão entregue");
for (const atraso of [0, 50, 200]) {
  const alvo = alvoConstante(19750, atraso);
  try {
    const r = medir(`latência ${atraso}ms`, {
      ...specDe(alvo.url, { startRps: 100, incrementRps: 300, intervalSeconds: 8, maxRps: 400 }),
      expectedLatencyMs: Math.max(1, atraso),
    });
    const pior = Math.max(...r.degraus.map((d) => Math.abs(d.erroPct)));
    confere(pior < 2, `latência ${atraso}ms · pior desvio de vazão ${pior.toFixed(1)}%`);
    confere(r.descartadas === 0, `latência ${atraso}ms · sem descartes (${r.descartadas})`);
  } finally {
    alvo.parar();
  }
}

// --- 2. Calibração do modelo de filas ------------------------------------
console.log("\n2. previsão do motor de capacidade contra medição");
{
  const MÉDIA = 10;
  const slo = { p95Ms: 5000, p99Ms: 10_000, errorRatePct: 50 };
  const alvo = alvoVariável(19751, MÉDIA);
  try {
    const r = medir("exponencial", {
      ...specDe(alvo.url, { startRps: 20, incrementRps: 20, intervalSeconds: 8, maxRps: 80 }),
      expectedLatencyMs: MÉDIA * 4,
    });
    /**
     * Serviço exponencial é a hipótese que o motor assume (M/M/1). Contra um
     * alvo de serviço constante a previsão erra 4–15× — e está certa: variância
     * zero é o melhor caso, que nenhum serviço real entrega.
     */
    const razões = r.degraus.map((d) => {
      const grafo = {
        origins: ["carga"],
        nodes: [{ id: "alvo", type: "teste", capacityRps: alvo.capacidadeRps, serviceTimeMs: MÉDIA, cacheHitRatio: 0 }],
        edges: [{ source: "carga", target: "alvo" }],
      };
      return evaluate(grafo, d.pedido, slo).p95Ms / Math.max(1, d.p95Ms);
    });
    const pior = Math.max(...razões);
    // Conservadora, mas não fantasiosa: prever o dobro do real já é demais.
    confere(pior < 2.5, `previsão no máximo ${pior.toFixed(1)}× a medição`);
    confere(Math.min(...razões) >= 1, "previsão nunca otimista");
  } finally {
    alvo.parar();
  }
}

// --- 3. De quem é o teto -------------------------------------------------
console.log("\n3. teto da arquitetura contra teto do gerador");
{
  const satura = alvoComFila(19752, 10);
  try {
    const r = medir("alvo satura", specDe(satura.url, {
      startRps: 30, incrementRps: 60, intervalSeconds: 8, maxRps: 210,
    }));
    confere(r.teto === "architecture", `alvo saturado → "${r.teto}"`);
    confere(
      Math.max(...r.degraus.map((d) => d.medido)) < 210,
      "o platô medido fica abaixo do pedido",
    );
  } finally {
    satura.parar();
  }

  const saudável = alvoConstante(19753, 300);
  try {
    // Mente para o dimensionador: 5ms em vez dos 300ms reais.
    const r = medir("gerador fraco", {
      ...specDe(saudável.url, { startRps: 40, incrementRps: 40, intervalSeconds: 8, maxRps: 120 }),
      expectedLatencyMs: 5,
    });
    confere(r.teto === "generator", `gerador subdimensionado → "${r.teto}"`);
  } finally {
    saudável.parar();
  }
}

// --- 4. Mistura do workload e veredito de SLO ----------------------------
console.log("\n4. pesos do workload e SLO");
{
  const contador = alvoContador(19754);
  try {
    medir("pesos", {
      ...specDe(contador.url, { startRps: 200, incrementRps: 0, intervalSeconds: 10, maxRps: 200 }, [
        { id: "a", method: "GET", path: "/produtos", weight: 70 },
        { id: "b", method: "GET", path: "/checkout", weight: 25 },
        { id: "c", method: "GET", path: "/saude", weight: 5 },
      ]),
      expectedLatencyMs: 5,
    });
    const c = contador.contagem();
    const total = Object.values(c).reduce((soma, n) => soma + n, 0);
    for (const [caminho, esperado] of [["/produtos", 70], ["/checkout", 25], ["/saude", 5]] as const) {
      const obtido = ((c[caminho] ?? 0) / total) * 100;
      confere(Math.abs(obtido - esperado) < 2, `${caminho} · ${esperado}% pedido, ${obtido.toFixed(1)}% entregue`);
    }
  } finally {
    contador.parar();
  }

  const lento = alvoConstante(19755, 120);
  try {
    const perfil = { startRps: 50, incrementRps: 0, intervalSeconds: 8, maxRps: 50 };
    for (const [p95, esperado] of [[400, true], [60, false]] as const) {
      const base = specDe(lento.url, perfil);
      const r = medir(`slo ${p95}`, {
        ...base,
        expectedLatencyMs: 120,
        generator: { ...base.generator, slo: { p95Ms: p95, p99Ms: p95 * 2, errorRatePct: 5 } },
      });
      confere(r.cumpriuSlo === esperado, `alvo de 120ms contra SLO de ${p95}ms → meetsSlo=${r.cumpriuSlo}`);
    }
  } finally {
    lento.parar();
  }
}

// --- 5. Escada no limite do §18 ------------------------------------------
console.log("\n5. escada de 40 degraus (MAX_STEPS)");
{
  const alvo = alvoConstante(19756, 5);
  try {
    const r = medir("escada longa", {
      ...specDe(alvo.url, { startRps: 10, incrementRps: 10, intervalSeconds: 2, maxRps: 1000 }),
      expectedLatencyMs: 10,
    });
    confere(r.degraus.length === 40, `${r.degraus.length} degraus`);
    confere(r.degraus.every((d) => d.medido > 0), "nenhum degrau voltou vazio");
    /**
     * O primeiro degrau é 10 req/s em 2s: vinte requisições. Uma a mais ou a
     * menos já são 5%, e isso é quantização, não desvio do gerador.
     */
    const pior = Math.max(...r.degraus.slice(1).map((d) => Math.abs(d.erroPct)));
    confere(pior < 2, `pior desvio fora do primeiro degrau: ${pior.toFixed(1)}%`);
  } finally {
    alvo.parar();
  }
}

console.log(falhas === 0 ? "\ncalibração completa sem divergências" : `\n${falhas} divergência(s)`);
process.exit(falhas === 0 ? 0 : 1);
