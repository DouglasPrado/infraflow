import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HOURS_PER_MONTH, isPriceable, planFor } from "./skus.ts";

/**
 * PRD §40 — do recurso do canvas para o SKU da AWS.
 *
 * Cada filtro aqui foi conferido contra a Price List de verdade. Os testes
 * travam as decisões que já saíram erradas uma vez: SKU de sobretaxa no lugar
 * do preço base, e cobrança dobrada de armazenamento Multi-AZ.
 */

const query = (type: string, props: Record<string, string | number | boolean>, index = 0) => {
  const plan = planFor(type, props, "us-east-1");
  assert.ok(isPriceable(plan), `${type} deveria ser precificável`);
  return plan.queries[index]!;
};

describe("o que dá para precificar", () => {
  it("EC2 conta horas por instância", () => {
    const ec2 = query("aws.ec2", { instanceType: "t3.medium", instances: 3 });

    assert.equal(ec2.serviceCode, "AmazonEC2");
    assert.equal(ec2.quantity, HOURS_PER_MONTH * 3);
    assert.equal(ec2.filters.instanceType, "t3.medium");
    // Sem isto a tabela devolve SKU de sobretaxa de suporte estendido.
    assert.deepEqual(ec2.usageTypeExcludes, ["ExtendedSupport"]);
  });

  it("Fargate cobra vCPU e memória em SKUs separados", () => {
    const props = { cpu: "2 vCPU", memory: "4GB", autoScaling: false, desiredReplicas: 2 };
    const vcpu = query("aws.ecs", props, 0);
    const memoria = query("aws.ecs", props, 1);

    assert.equal(vcpu.quantity, HOURS_PER_MONTH * 2 * 2);
    assert.equal(memoria.quantity, HOURS_PER_MONTH * 2 * 4);
    // `memorytype=perGB` casa também com ECS sobre EC2, que custa zero.
    assert.equal(memoria.usageTypeContains, "Fargate-GB-Hours");
    assert.equal(vcpu.usageTypeContains, "Fargate-vCPU-Hours");
  });

  it("com autoscaling, conta o piso declarado e não o teto", () => {
    const vcpu = query("aws.ecs", {
      cpu: "1 vCPU",
      memory: "2GB",
      autoScaling: true,
      minReplicas: 2,
      maxReplicas: 20,
    });
    // Paga-se o que está de pé, não o que o autoscaling pode subir.
    assert.equal(vcpu.quantity, HOURS_PER_MONTH * 2 * 1);
  });

  it("RDS distingue Single-AZ de Multi-AZ pelo mesmo marcador", () => {
    const single = query("aws.rds", { multiAz: false, storageGb: 100 });
    const multi = query("aws.rds", { multiAz: true, storageGb: 100 });

    assert.equal(single.filters.deploymentOption, "Single-AZ");
    assert.equal(multi.filters.deploymentOption, "Multi-AZ");
    // `InstanceUsage:db.…` e `Multi-AZUsage:db.…` compartilham este trecho.
    assert.equal(single.usageTypeContains, "Usage:db.");
    assert.equal(multi.usageTypeContains, "Usage:db.");
  });

  it("não cobra o armazenamento Multi-AZ duas vezes", () => {
    const single = query("aws.rds", { multiAz: false, storageGb: 100 }, 1);
    const multi = query("aws.rds", { multiAz: true, storageGb: 100 }, 1);

    // O SKU Multi-AZ já custa o dobro por GB; multiplicar aqui dobraria de novo.
    assert.equal(single.quantity, 100);
    assert.equal(multi.quantity, 100);
  });

  it("o engine do painel vira o engine da AWS", () => {
    assert.equal(query("aws.rds", { engine: "MySQL 8" }).filters.databaseEngine, "MySQL");
    assert.equal(query("aws.rds", { engine: "MariaDB 11" }).filters.databaseEngine, "MariaDB");
    assert.equal(query("aws.rds", { engine: "PostgreSQL 16" }).filters.databaseEngine, "PostgreSQL");
  });

  it("ElastiCache conta horas por node e ignora suporte estendido", () => {
    const cache = query("aws.elasticache", { nodeType: "cache.t3.micro", nodes: 2 });

    assert.equal(cache.quantity, HOURS_PER_MONTH * 2);
    assert.equal(cache.usageTypeContains, "NodeUsage:");
    assert.deepEqual(cache.usageTypeExcludes, ["ExtendedSupport"]);
  });

  it("balanceador conta horas, sem LCU", () => {
    assert.equal(query("aws.alb", {}).quantity, HOURS_PER_MONTH);
    assert.equal(query("aws.nlb", {}).filters.productFamily, "Load Balancer-Network");
  });
});

describe("o que não dá para precificar diz por quê", () => {
  const semPreco = (type: string) => {
    const plan = planFor(type, {}, "us-east-1");
    assert.ok(!isPriceable(plan), `${type} não deveria ser precificável`);
    return plan.reason;
  };

  it("serviço cobrado por uso, sem volume no canvas", () => {
    assert.match(semPreco("aws.s3"), /volume/);
    assert.match(semPreco("aws.cloudfront"), /transferência/);
    assert.match(semPreco("aws.lambda"), /invocação/);
    assert.match(semPreco("aws.sqs"), /mensagem/);
    assert.match(semPreco("aws.cloudwatch"), /métrica/);
  });

  it("recurso que não é da AWS", () => {
    assert.match(semPreco("opensource.postgresql"), /fora da AWS/);
  });
});
