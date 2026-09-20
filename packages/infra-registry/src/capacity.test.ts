import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CAPACITY_MODEL, COST_MODEL, capacityFor, monthlyCostFor } from "./capacity.ts";
import { CATALOG, getCatalogItem } from "./catalog.ts";

type Props = Record<string, string | number | boolean>;

const item = (type: string) => getCatalogItem(type)!;
const withProps = (type: string, overrides: Props = {}): Props => ({
  ...item(type).defaults,
  ...overrides,
});

describe("invariante do padrão", () => {
  it("na configuração padrão, capacidade é exatamente a do catálogo", () => {
    for (const entry of CATALOG) {
      assert.equal(
        capacityFor(entry, entry.defaults),
        entry.capacityRps,
        `${entry.type}: fatores de capacidade não multiplicam 1 no padrão`,
      );
    }
  });

  it("na configuração padrão, custo é exatamente o do catálogo", () => {
    for (const entry of CATALOG) {
      assert.equal(
        monthlyCostFor(entry, entry.defaults),
        entry.monthlyCostUsd,
        `${entry.type}: fatores de custo não multiplicam 1 no padrão`,
      );
    }
  });

  it("todo fator aponta para uma propriedade que existe", () => {
    for (const [type, factors] of [...Object.entries(CAPACITY_MODEL), ...Object.entries(COST_MODEL)]) {
      const entry = getCatalogItem(type);
      assert.ok(entry, `modelo declarado para tipo inexistente: ${type}`);

      for (const factor of factors) {
        const keys = factor.kind === "autoscale"
          ? [factor.toggleKey, factor.onKey, factor.offKey]
          : [factor.key];

        for (const key of keys) {
          assert.ok(key in entry.defaults, `${type}: fator aponta para "${key}", que não existe`);
        }
      }
    }
  });
});

describe("capacidade responde à configuração", () => {
  it("instância maior de RDS aumenta a capacidade", () => {
    const base = capacityFor(item("aws.rds"), withProps("aws.rds"));
    const maior = capacityFor(item("aws.rds"), withProps("aws.rds", { instanceClass: "db.m6g.large" }));
    assert.ok(maior > base, `${maior} deveria superar ${base}`);
  });

  it("conexões limitam a vazão mesmo com instância grande", () => {
    const semPool = capacityFor(
      item("aws.rds"),
      withProps("aws.rds", { instanceClass: "db.r6g.xlarge" }),
    );
    const comPool = capacityFor(
      item("aws.rds"),
      withProps("aws.rds", { instanceClass: "db.r6g.xlarge", maxConnections: 2000 }),
    );
    // É isto que dá sentido a "enable connection pooling" (PRD §25).
    assert.ok(comPool > semPool, "aumentar conexões deveria destravar a instância maior");
  });

  it("mais réplicas de ECS aumentam a capacidade", () => {
    const base = capacityFor(item("aws.ecs"), withProps("aws.ecs"));
    const maior = capacityFor(item("aws.ecs"), withProps("aws.ecs", { maxReplicas: 40 }));
    assert.equal(maior, base * 4);
  });

  it("desligar o autoscaling derruba a capacidade para o número desejado", () => {
    const comAuto = capacityFor(item("aws.ecs"), withProps("aws.ecs"));
    const semAuto = capacityFor(item("aws.ecs"), withProps("aws.ecs", { autoScaling: false }));
    assert.ok(semAuto < comAuto, "sem autoscaling só existem as réplicas desejadas");
  });

  it("persistência do Redis cobra um pedaço da vazão", () => {
    const sem = capacityFor(item("opensource.redis"), withProps("opensource.redis"));
    const com = capacityFor(item("opensource.redis"), withProps("opensource.redis", { persistence: true }));
    assert.ok(com < sem);
  });

  it("nunca devolve capacidade zero ou negativa", () => {
    const absurdo = capacityFor(item("aws.ecs"), { ...item("aws.ecs").defaults, maxReplicas: 0, cpu: "?" });
    assert.ok(absurdo >= 1);
  });

  it("ignora propriedade com tipo errado em vez de estourar", () => {
    const valor = capacityFor(item("aws.ecs"), {
      ...item("aws.ecs").defaults,
      maxReplicas: "muitas",
    });
    assert.ok(Number.isFinite(valor) && valor > 0);
  });
});

describe("custo responde à configuração", () => {
  it("Multi-AZ dobra a conta do RDS", () => {
    const simples = monthlyCostFor(item("aws.rds"), withProps("aws.rds"));
    const multiAz = monthlyCostFor(item("aws.rds"), withProps("aws.rds", { multiAz: true }));
    assert.equal(multiAz, simples * 2);
  });

  it("Multi-AZ não aumenta a vazão — é disponibilidade, não capacidade", () => {
    const simples = capacityFor(item("aws.rds"), withProps("aws.rds"));
    const multiAz = capacityFor(item("aws.rds"), withProps("aws.rds", { multiAz: true }));
    assert.equal(multiAz, simples);
  });

  it("o custo do ECS segue as réplicas desejadas, não o teto do autoscaling", () => {
    const base = monthlyCostFor(item("aws.ecs"), withProps("aws.ecs"));
    const tetoMaior = monthlyCostFor(item("aws.ecs"), withProps("aws.ecs", { maxReplicas: 100 }));
    assert.equal(tetoMaior, base, "subir o teto não custa nada enquanto não escalar");

    const maisTarefas = monthlyCostFor(item("aws.ecs"), withProps("aws.ecs", { desiredReplicas: 6 }));
    assert.equal(maisTarefas, base * 3);
  });

  it("armazenamento maior encarece o RDS", () => {
    const base = monthlyCostFor(item("aws.rds"), withProps("aws.rds"));
    const maior = monthlyCostFor(item("aws.rds"), withProps("aws.rds", { storageGb: 400 }));
    assert.equal(maior, base * 4);
  });
});
