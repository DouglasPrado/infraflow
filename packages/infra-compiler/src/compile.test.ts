import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  connection,
  documentOf,
  loadGeneratorNode,
  referenceArchitecture,
  resourceNode,
} from "@infraflow/validator";
import { compile, emit } from "./index.ts";

const fileOf = (files: { name: string; content: string }[], name: string) =>
  files.find((file) => file.name === name)!.content;

/** Arquitetura com os seis componentes do §74. */
function stack() {
  return documentOf(
    [
      loadGeneratorNode(),
      resourceNode("alb", "aws.alb", {}, "public-alb"),
      resourceNode("ecs", "aws.ecs", {}, "api-service"),
      resourceNode("rds", "aws.rds", {}, "orders-db"),
      resourceNode("redis", "aws.elasticache", { nodes: 2, multiAz: true }, "session-cache"),
      resourceNode("s3", "aws.s3", {}, "product-assets"),
    ],
    [
      connection("load-generator", "alb", "HTTP"),
      connection("alb", "ecs", "HTTP"),
      connection("ecs", "rds", "Database"),
      connection("ecs", "redis", "TCP"),
      connection("ecs", "s3", "Storage"),
    ],
  );
}

describe("pipeline do §74", () => {
  it("emite os cinco arquivos do §34", () => {
    assert.deepEqual(
      emit(stack()).files.map((file) => file.name),
      ["providers.tf", "main.tf", "variables.tf", "outputs.tf", "terraform.tfvars.example"],
    );
  });

  it("é determinístico byte a byte", () => {
    assert.deepEqual(emit(stack()).files, emit(stack()).files);
  });

  it("emite a VPC mesmo sem node de rede no canvas", () => {
    const main = fileOf(emit(stack()).files, "main.tf");

    assert.match(main, /resource "aws_vpc" "main"/);
    assert.match(main, /resource "aws_subnet" "private_2"/);
    assert.match(main, /resource "aws_internet_gateway" "main"/);
  });

  it("compila os seis componentes que o §74 pede", () => {
    const main = fileOf(emit(stack()).files, "main.tf");

    for (const type of [
      "aws_lb",
      "aws_ecs_service",
      "aws_db_instance",
      "aws_s3_bucket",
      "aws_elasticache_replication_group",
    ]) {
      assert.match(main, new RegExp(`resource "${type}" `), type);
    }
  });
});

describe("conexão do canvas vira regra de rede", () => {
  const main = fileOf(emit(stack()).files, "main.tf");

  it("abre o banco só para o serviço que o consome", () => {
    assert.match(
      main,
      /resource "aws_vpc_security_group_ingress_rule" "orders_db_from_api_service" \{[\s\S]*?referenced_security_group_id = aws_security_group\.api_service\.id[\s\S]*?from_port\s+= 5432/,
    );
  });

  it("abre o cache na porta do Redis", () => {
    assert.match(main, /"session_cache_from_api_service"[\s\S]*?from_port\s+= 6379/);
  });

  it("só o balanceador aceita a internet", () => {
    assert.match(main, /"public_alb_public_443"[\s\S]*?cidr_ipv4\s+= "0\.0\.0\.0\/0"/);
    assert.doesNotMatch(main, /"orders_db_public/);
    assert.doesNotMatch(main, /"api_service_public/);
  });

  it("registra o serviço no grupo de destino do balanceador", () => {
    assert.match(main, /resource "aws_ecs_service" "api_service" \{[\s\S]*?load_balancer \{/);
    assert.match(main, /target_group_arn = aws_lb_target_group\.public_alb\.arn/);
  });

  it("não abre nada quando não há conexão", () => {
    const solto = documentOf(
      [resourceNode("rds", "aws.rds", {}, "orders-db"), resourceNode("ecs", "aws.ecs", {}, "api")],
      [],
    );
    assert.doesNotMatch(fileOf(emit(solto).files, "main.tf"), /ingress_rule/);
  });
});

describe("propriedade do painel tem efeito no HCL", () => {
  it("Multi-AZ do banco", () => {
    const off = fileOf(emit(documentOf([resourceNode("rds", "aws.rds", { multiAz: false })], [])).files, "main.tf");
    const on = fileOf(emit(documentOf([resourceNode("rds", "aws.rds", { multiAz: true })], [])).files, "main.tf");

    assert.match(off, /multi_az\s+= false/);
    assert.match(on, /multi_az\s+= true/);
  });

  it("engine escolhido define versão, família e porta", () => {
    const mysql = documentOf(
      [
        loadGeneratorNode(),
        resourceNode("ecs", "aws.ecs"),
        resourceNode("db", "aws.rds", { engine: "MySQL 8" }),
      ],
      [connection("load-generator", "ecs", "HTTP"), connection("ecs", "db", "Database")],
    );
    const main = fileOf(emit(mysql).files, "main.tf");

    assert.match(main, /engine\s+= "mysql"/);
    assert.match(main, /family = "mysql8\.0"/);
    // A porta da regra de rede acompanha o engine.
    assert.match(main, /"db_from_ecs"[\s\S]*?from_port\s+= 3306/);
  });

  it("max connections vira parameter group", () => {
    const main = fileOf(
      emit(documentOf([resourceNode("rds", "aws.rds", { maxConnections: 450 })], [])).files,
      "main.tf",
    );
    assert.match(main, /name\s+= "max_connections"[\s\S]*?value\s+= "450"/);
  });

  it("autoscaling do serviço emite alvo e política", () => {
    const sem = fileOf(
      emit(documentOf([resourceNode("ecs", "aws.ecs", { autoScaling: false })], [])).files,
      "main.tf",
    );
    const com = fileOf(
      emit(documentOf([resourceNode("ecs", "aws.ecs", { autoScaling: true, minReplicas: 3, maxReplicas: 12 })], [])).files,
      "main.tf",
    );

    assert.doesNotMatch(sem, /aws_appautoscaling_target/);
    assert.match(com, /min_capacity\s+= 3/);
    assert.match(com, /max_capacity\s+= 12/);
  });

  it("CPU e memória viram unidades do Fargate", () => {
    const main = fileOf(
      emit(documentOf([resourceNode("ecs", "aws.ecs", { cpu: "4 vCPU", memory: "8GB" })], [])).files,
      "main.tf",
    );
    assert.match(main, /cpu\s+= "4096"/);
    assert.match(main, /memory\s+= "8192"/);
  });

  it("versionamento e criptografia do bucket", () => {
    const main = fileOf(
      emit(
        documentOf([resourceNode("s3", "aws.s3", { versioning: false, encryption: "SSE-KMS" })], []),
      ).files,
      "main.tf",
    );

    assert.match(main, /status = "Suspended"/);
    assert.match(main, /sse_algorithm = "aws:kms"/);
  });

  it("balanceador interno não recebe a internet e fica no privado", () => {
    const main = fileOf(
      emit(documentOf([resourceNode("alb", "aws.alb", { scheme: "internal" })], [])).files,
      "main.tf",
    );

    assert.match(main, /internal\s+= true/);
    assert.match(main, /subnets\s+= \[aws_subnet\.private_1\.id/);
    assert.doesNotMatch(main, /_public_443/);
  });
});

describe("o que o compiler não traduz", () => {
  it("avisa em vez de inventar equivalência, e sugere a alternativa do registry", () => {
    const { warnings } = compile(referenceArchitecture());
    const redis = warnings.find((warning) => warning.nodeId === "redis");

    assert.equal(redis?.code, "unsupported-resource");
    assert.match(redis?.hint ?? "", /ElastiCache/);
    assert.ok(warnings.some((warning) => warning.nodeId === "cloudfront"));
  });

  it("lista só o que virou infraestrutura", () => {
    assert.deepEqual(compile(referenceArchitecture()).compiledNodeIds, ["alb", "ecs", "rds", "s3"]);
  });

  it("avisa que o listener HTTPS precisa de certificado", () => {
    const { warnings } = compile(stack());
    assert.ok(warnings.some((warning) => warning.code === "requires-input"));
  });

  it("registra a decisão de não emitir NAT Gateway", () => {
    assert.ok(compile(stack()).warnings.some((warning) => warning.code === "assumption"));
  });
});

describe("nomes", () => {
  it("resolve colisão pela ordem do documento", () => {
    const main = fileOf(
      emit(
        documentOf(
          [resourceNode("a", "aws.s3", {}, "assets"), resourceNode("b", "aws.s3", {}, "assets")],
          [],
        ),
      ).files,
      "main.tf",
    );

    assert.match(main, /resource "aws_s3_bucket" "assets" \{/);
    assert.match(main, /resource "aws_s3_bucket" "assets_2" \{/);
  });

  it("não deixa nome do canvas virar interpolação", () => {
    const main = fileOf(
      emit(documentOf([resourceNode("s3", "aws.s3", {}, "${var.project}")], [])).files,
      "main.tf",
    );

    assert.doesNotMatch(main, /bucket = "\$\{var\.project\}"/);
  });
});

describe("terraform.tfvars.example", () => {
  it("traz o ambiente da arquitetura e a imagem padrão", () => {
    const content = fileOf(emit(stack()).files, "terraform.tfvars.example");

    assert.match(content, /environment = "dev"/);
    assert.match(content, /container_image = "public\.ecr\.aws/);
  });
});
