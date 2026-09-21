import type { ResourceNode } from "@infraflow/schema";
import {
  attributeOf,
  block,
  bool,
  interpolated,
  list,
  num,
  obj,
  output,
  ref,
  resource,
  str,
  variable,
  type TofuBlock,
} from "@infraflow/opentofu-generator";
import type { CompileWarning } from "../types.ts";
import { egressAll, securityGroup, type NetworkRefs } from "./network.ts";

/**
 * Tradução de cada recurso do canvas para AWS (PRD §74).
 *
 * O escopo é o que o §74 lista: VPC, ALB, ECS, RDS, S3 e Redis. Tipo fora dessa
 * lista **não** é traduzido por aproximação — vira aviso com a alternativa que
 * o registry já conhece (§29). Inventar equivalência silenciosa é exatamente o
 * risco de IaC incorreta do §85.
 *
 * Toda propriedade do painel que chega aqui tem efeito no HCL. Propriedade que
 * o alvo não suporta sai como aviso, não some.
 */

export interface EmitInput {
  node: ResourceNode;
  /** Identificador HCL estável do node. */
  name: string;
  network: NetworkRefs;
}

export interface Emission {
  blocks: TofuBlock[];
  outputs: TofuBlock[];
  variables: TofuBlock[];
  /** Linhas do terraform.tfvars.example, como `chave = valor`. */
  tfvars: [string, string][];
  warnings: CompileWarning[];
  /** Grupo de segurança que representa o recurso na rede. */
  securityGroup?: TofuBlock;
  /** Porta em que o recurso aceita conexão de quem aponta para ele. */
  listenPort?: number;
  /** Portas abertas à internet, quando o recurso é porta de entrada. */
  publicPorts?: number[];
  /** Balanceador: grupo de destino a que um serviço se registra. */
  targetGroup?: TofuBlock;
  /** Balanceador: listener de que o serviço precisa depender. */
  listener?: TofuBlock;
  /** Bloco principal, para a fiação entre recursos. */
  main?: TofuBlock;
}

export type Emitter = (input: EmitInput) => Emission;

const empty = (): Omit<Emission, "blocks"> => ({
  outputs: [],
  variables: [],
  tfvars: [],
  warnings: [],
});

function text(node: ResourceNode, key: string, fallback = ""): string {
  const value = node.properties[key];
  return value === undefined ? fallback : String(value);
}

function integer(node: ResourceNode, key: string, fallback: number): number {
  const value = node.properties[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function flag(node: ResourceNode, key: string, fallback = false): boolean {
  const value = node.properties[key];
  return typeof value === "boolean" ? value : fallback;
}

const tags = (suffix: string) => obj([["Name", interpolated(`\${var.project}-${suffix}`)]]);

const hyphen = (name: string) => name.replaceAll("_", "-");

// ------------------------------------------------------------------- ALB

/** `listeners` do painel — "HTTPS:443, HTTP:80" — vira um listener por entrada. */
function parseListeners(value: string): { protocol: string; port: number }[] {
  const parsed = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const [protocol, port] = entry.split(":");
      const parsedPort = Number(port);
      if (!protocol || !Number.isFinite(parsedPort)) return [];
      return [{ protocol: protocol.toUpperCase(), port: parsedPort }];
    });

  return parsed.length > 0 ? parsed : [{ protocol: "HTTP", port: 80 }];
}

const alb: Emitter = ({ node, name, network }) => {
  const base = empty();
  const group = securityGroup(name, `Balanceador ${node.name}`, network);
  const listeners = parseListeners(text(node, "listeners", "HTTP:80"));
  const internal = text(node, "scheme", "internet-facing") === "internal";

  const balancer = resource("aws_lb", name, [
    ["name", interpolated(`\${var.project}-${hyphen(name)}`)],
    ["internal", bool(internal)],
    ["load_balancer_type", str("application")],
    ["security_groups", list([attributeOf(group, "id")])],
    ["subnets", internal ? network.privateSubnetIds : network.publicSubnetIds],
    ["idle_timeout", num(integer(node, "idleTimeoutS", 60))],
    ["tags", tags(hyphen(name))],
  ]);

  const targetGroup = resource(
    "aws_lb_target_group",
    name,
    [
      ["name", interpolated(`\${var.project}-${hyphen(name)}`)],
      ["port", ref("var.container_port")],
      ["protocol", str("HTTP")],
      ["vpc_id", network.vpcId],
      ["target_type", str("ip")],
    ],
    [
      block("health_check", [], [
        ["path", str("/")],
        ["matcher", str("200-399")],
        ["interval", num(30)],
        ["timeout", num(5)],
      ]),
      ...(flag(node, "stickySessions")
        ? [
            block("stickiness", [], [
              ["type", str("lb_cookie")],
              ["enabled", bool(true)],
            ]),
          ]
        : []),
    ],
  );

  const warnings: CompileWarning[] = [];
  const listenerBlocks = listeners.map((listener) =>
    resource(
      "aws_lb_listener",
      `${name}_${listener.protocol.toLowerCase()}_${listener.port}`,
      [
        ["load_balancer_arn", attributeOf(balancer, "arn")],
        ["port", num(listener.port)],
        ["protocol", str(listener.protocol)],
        ...(listener.protocol === "HTTPS"
          ? ([
              ["ssl_policy", str("ELBSecurityPolicy-TLS13-1-2-2021-06")],
              ["certificate_arn", ref("var.certificate_arn")],
            ] as [string, ReturnType<typeof str>][])
          : []),
      ],
      [
        block("default_action", [], [
          ["type", str("forward")],
          ["target_group_arn", attributeOf(targetGroup, "arn")],
        ]),
      ],
    ),
  );

  if (listeners.some((listener) => listener.protocol === "HTTPS")) {
    warnings.push({
      code: "requires-input",
      nodeId: node.id,
      message: `O listener HTTPS de "${node.name}" precisa de um certificado.`,
      hint: "Informe `certificate_arn` no terraform.tfvars antes do apply.",
    });
  }

  return {
    ...base,
    warnings,
    blocks: [group, egressAll(name, group), balancer, targetGroup, ...listenerBlocks],
    outputs: [
      output(`${name}_dns_name`, [
        ["value", attributeOf(balancer, "dns_name")],
        ["description", str(`Endereco publico de ${node.name}`)],
      ]),
    ],
    securityGroup: group,
    listenPort: listeners[0]?.port,
    // Só quem é porta de entrada aceita a internet; um balanceador interno
    // recebe apenas de quem aponta para ele no canvas.
    publicPorts: internal ? [] : listeners.map((listener) => listener.port),
    targetGroup,
    listener: listenerBlocks[0],
    main: balancer,
  };
};

// ------------------------------------------------------------------- ECS

/** "2 vCPU" → 2048; a unidade de CPU do Fargate é o milésimo de vCPU. */
function cpuUnits(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 1024) : 512;
}

/** "4GB" → 4096 MiB. */
function memoryMib(value: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1024;
  return /mb/i.test(value) ? Math.round(parsed) : Math.round(parsed * 1024);
}

const ecs: Emitter = ({ node, name, network }) => {
  const base = empty();
  const group = securityGroup(name, `Servico ${node.name}`, network);

  const cluster = resource("aws_ecs_cluster", name, [
    ["name", interpolated(`\${var.project}-${hyphen(name)}`)],
    ["tags", tags(hyphen(name))],
  ]);

  const logs = resource("aws_cloudwatch_log_group", name, [
    ["name", interpolated(`/ecs/\${var.project}-${hyphen(name)}`)],
    ["retention_in_days", num(14)],
  ]);

  const executionRole = resource("aws_iam_role", `${name}_execution`, [
    ["name", interpolated(`\${var.project}-${hyphen(name)}-execution`)],
    [
      "assume_role_policy",
      ref(
        [
          "jsonencode({",
          '  Version = "2012-10-17"',
          "  Statement = [{",
          '    Effect    = "Allow"',
          '    Action    = "sts:AssumeRole"',
          '    Principal = { Service = "ecs-tasks.amazonaws.com" }',
          "  }]",
          "})",
        ].join("\n"),
      ),
    ],
  ]);

  const rolePolicy = resource("aws_iam_role_policy_attachment", `${name}_execution`, [
    ["role", attributeOf(executionRole, "name")],
    [
      "policy_arn",
      str("arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"),
    ],
  ]);

  const cpu = cpuUnits(text(node, "cpu", "0.5 vCPU"));
  const memory = memoryMib(text(node, "memory", "1GB"));

  const task = resource("aws_ecs_task_definition", name, [
    ["family", interpolated(`\${var.project}-${hyphen(name)}`)],
    ["network_mode", str("awsvpc")],
    ["requires_compatibilities", list([str("FARGATE")])],
    ["cpu", str(String(cpu))],
    ["memory", str(String(memory))],
    ["execution_role_arn", attributeOf(executionRole, "arn")],
    [
      "container_definitions",
      ref(
        [
          "jsonencode([{",
          `  name      = "${hyphen(name)}"`,
          "  image     = var.container_image",
          "  essential = true",
          "  portMappings = [{",
          "    containerPort = var.container_port",
          '    protocol      = "tcp"',
          "  }]",
          "  logConfiguration = {",
          '    logDriver = "awslogs"',
          "    options = {",
          `      awslogs-group         = aws_cloudwatch_log_group.${name}.name`,
          "      awslogs-region        = var.region",
          '      awslogs-stream-prefix = "ecs"',
          "    }",
          "  }",
          "}])",
        ].join("\n"),
      ),
    ],
  ]);

  const autoScaling = flag(node, "autoScaling", false);
  const desired = autoScaling
    ? integer(node, "minReplicas", integer(node, "desiredReplicas", 1))
    : integer(node, "desiredReplicas", 1);

  const service = resource(
    "aws_ecs_service",
    name,
    [
      ["name", interpolated(`\${var.project}-${hyphen(name)}`)],
      ["cluster", attributeOf(cluster, "id")],
      ["task_definition", attributeOf(task, "arn")],
      ["desired_count", num(desired)],
      ["launch_type", str("FARGATE")],
    ],
    [
      block("network_configuration", [], [
        ["subnets", network.publicSubnetIds],
        ["security_groups", list([attributeOf(group, "id")])],
        // Sem NAT Gateway, a tarefa precisa de IP publico para puxar a imagem.
        ["assign_public_ip", bool(true)],
      ]),
    ],
  );

  const scaling: TofuBlock[] = [];
  if (autoScaling) {
    const target = resource("aws_appautoscaling_target", name, [
      ["service_namespace", str("ecs")],
      [
        "resource_id",
        interpolated(`service/\${aws_ecs_cluster.${name}.name}/\${aws_ecs_service.${name}.name}`),
      ],
      ["scalable_dimension", str("ecs:service:DesiredCount")],
      ["min_capacity", num(integer(node, "minReplicas", desired))],
      ["max_capacity", num(integer(node, "maxReplicas", desired))],
    ]);

    scaling.push(
      target,
      resource(
        "aws_appautoscaling_policy",
        `${name}_cpu`,
        [
          ["name", interpolated(`\${var.project}-${hyphen(name)}-cpu`)],
          ["policy_type", str("TargetTrackingScaling")],
          ["service_namespace", attributeOf(target, "service_namespace")],
          ["resource_id", attributeOf(target, "resource_id")],
          ["scalable_dimension", attributeOf(target, "scalable_dimension")],
        ],
        [
          block(
            "target_tracking_scaling_policy_configuration",
            [],
            [["target_value", num(70)]],
            [
              block("predefined_metric_specification", [], [
                ["predefined_metric_type", str("ECSServiceAverageCPUUtilization")],
              ]),
            ],
          ),
        ],
      ),
    );
  }

  return {
    ...base,
    blocks: [
      group,
      egressAll(name, group),
      cluster,
      logs,
      executionRole,
      rolePolicy,
      task,
      service,
      ...scaling,
    ],
    variables: [],
    securityGroup: group,
    listenPort: undefined,
    main: service,
  };
};

// ------------------------------------------------------------------- RDS

interface EngineSpec {
  engine: string;
  version: string;
  family: string;
  port: number;
}

/** O rótulo do painel — "PostgreSQL 16" — carrega engine, versão e porta. */
const ENGINES: Record<string, EngineSpec> = {
  "PostgreSQL 17": { engine: "postgres", version: "17", family: "postgres17", port: 5432 },
  "PostgreSQL 16": { engine: "postgres", version: "16", family: "postgres16", port: 5432 },
  "PostgreSQL 15": { engine: "postgres", version: "15", family: "postgres15", port: 5432 },
  "MySQL 8": { engine: "mysql", version: "8.0", family: "mysql8.0", port: 3306 },
  "MariaDB 11": { engine: "mariadb", version: "11.4", family: "mariadb11.4", port: 3306 },
};

const rds: Emitter = ({ node, name, network }) => {
  const base = empty();
  const engineLabel = text(node, "engine", "PostgreSQL 16");
  const spec = ENGINES[engineLabel] ?? ENGINES["PostgreSQL 16"]!;

  const group = securityGroup(name, `Banco ${node.name}`, network);

  const subnets = resource("aws_db_subnet_group", name, [
    ["name", interpolated(`\${var.project}-${hyphen(name)}`)],
    ["subnet_ids", network.privateSubnetIds],
    ["tags", tags(hyphen(name))],
  ]);

  const parameters = resource(
    "aws_db_parameter_group",
    name,
    [
      ["name", interpolated(`\${var.project}-${hyphen(name)}`)],
      ["family", str(spec.family)],
    ],
    [
      block("parameter", [], [
        ["name", str("max_connections")],
        ["value", str(String(integer(node, "maxConnections", 200)))],
        ["apply_method", str("pending-reboot")],
      ]),
    ],
  );

  const instance = resource("aws_db_instance", name, [
    ["identifier", interpolated(`\${var.project}-${hyphen(name)}`)],
    ["engine", str(spec.engine)],
    ["engine_version", str(spec.version)],
    ["instance_class", str(text(node, "instanceClass", "db.t3.medium"))],
    ["allocated_storage", num(integer(node, "storageGb", 20))],
    ["storage_encrypted", bool(true)],
    ["multi_az", bool(flag(node, "multiAz"))],
    ["db_subnet_group_name", attributeOf(subnets, "name")],
    ["parameter_group_name", attributeOf(parameters, "name")],
    ["vpc_security_group_ids", list([attributeOf(group, "id")])],
    ["username", str("infraflow")],
    // A senha fica no Secrets Manager, gerida pela AWS: nada de segredo em
    // tfvars nem no state (PRD §52).
    ["manage_master_user_password", bool(true)],
    ["skip_final_snapshot", bool(true)],
    ["apply_immediately", bool(true)],
    ["tags", tags(hyphen(name))],
  ]);

  return {
    ...base,
    blocks: [group, egressAll(name, group), subnets, parameters, instance],
    outputs: [
      output(`${name}_endpoint`, [
        ["value", attributeOf(instance, "endpoint")],
        ["description", str(`Endpoint de ${node.name}`)],
      ]),
    ],
    securityGroup: group,
    listenPort: spec.port,
    main: instance,
  };
};

// -------------------------------------------------------------------- S3

const s3: Emitter = ({ node, name }) => {
  const base = empty();

  const bucket = resource("aws_s3_bucket", name, [
    ["bucket", interpolated(`\${var.project}-\${var.environment}-${hyphen(name)}`)],
    ["tags", tags(hyphen(name))],
  ]);

  const blocks: TofuBlock[] = [
    bucket,
    resource("aws_s3_bucket_public_access_block", name, [
      ["bucket", attributeOf(bucket, "id")],
      ["block_public_acls", bool(true)],
      ["block_public_policy", bool(true)],
      ["ignore_public_acls", bool(true)],
      ["restrict_public_buckets", bool(true)],
    ]),
    resource(
      "aws_s3_bucket_versioning",
      name,
      [["bucket", attributeOf(bucket, "id")]],
      [
        block("versioning_configuration", [], [
          ["status", str(flag(node, "versioning", true) ? "Enabled" : "Suspended")],
        ]),
      ],
    ),
  ];

  const encryption = text(node, "encryption", "SSE-S3");
  const warnings: CompileWarning[] = [];

  if (encryption === "None") {
    warnings.push({
      code: "assumption",
      nodeId: node.id,
      message: `O bucket "${node.name}" foi declarado sem criptografia.`,
      hint: "A AWS aplica SSE-S3 por padrão; o recurso de criptografia não foi emitido.",
    });
  } else {
    blocks.push(
      resource(
        "aws_s3_bucket_server_side_encryption_configuration",
        name,
        [["bucket", attributeOf(bucket, "id")]],
        [
          block("rule", [], [], [
            block("apply_server_side_encryption_by_default", [], [
              ["sse_algorithm", str(encryption === "SSE-KMS" ? "aws:kms" : "AES256")],
            ]),
          ]),
        ],
      ),
    );
  }

  const storageClass = text(node, "storageClass", "Standard");
  if (storageClass !== "Standard") {
    blocks.push(
      resource(
        "aws_s3_bucket_lifecycle_configuration",
        name,
        [["bucket", attributeOf(bucket, "id")]],
        [
          block(
            "rule",
            [],
            [
              ["id", str("storage-class")],
              ["status", str("Enabled")],
            ],
            [
              block("filter", [], []),
              block("transition", [], [
                ["days", num(30)],
                ["storage_class", str(storageClass.toUpperCase().replaceAll("-", "_"))],
              ]),
            ],
          ),
        ],
      ),
    );
  }

  return {
    ...base,
    warnings,
    blocks,
    outputs: [
      output(`${name}_bucket`, [
        ["value", attributeOf(bucket, "bucket")],
        ["description", str(`Bucket de ${node.name}`)],
      ]),
    ],
    main: bucket,
  };
};

// -------------------------------------------------------------- ElastiCache

const elasticache: Emitter = ({ node, name, network }) => {
  const base = empty();
  const group = securityGroup(name, `Cache ${node.name}`, network);
  const nodes = Math.max(1, integer(node, "nodes", 1));
  const multiAz = flag(node, "multiAz") && nodes > 1;

  const subnets = resource("aws_elasticache_subnet_group", name, [
    ["name", interpolated(`\${var.project}-${hyphen(name)}`)],
    ["subnet_ids", network.privateSubnetIds],
  ]);

  const replication = resource("aws_elasticache_replication_group", name, [
    ["replication_group_id", interpolated(`\${var.project}-${hyphen(name)}`)],
    ["description", str(`Cache ${node.name}`)],
    ["engine", str("redis")],
    ["node_type", str(text(node, "nodeType", "cache.t3.micro"))],
    ["num_cache_clusters", num(nodes)],
    ["automatic_failover_enabled", bool(multiAz)],
    ["multi_az_enabled", bool(multiAz)],
    ["port", num(6379)],
    ["subnet_group_name", attributeOf(subnets, "name")],
    ["security_group_ids", list([attributeOf(group, "id")])],
    ["at_rest_encryption_enabled", bool(true)],
    ["transit_encryption_enabled", bool(true)],
    ["tags", tags(hyphen(name))],
  ]);

  return {
    ...base,
    blocks: [group, egressAll(name, group), subnets, replication],
    outputs: [
      output(`${name}_endpoint`, [
        ["value", attributeOf(replication, "primary_endpoint_address")],
        ["description", str(`Endpoint de ${node.name}`)],
      ]),
    ],
    securityGroup: group,
    listenPort: 6379,
    main: replication,
  };
};

/** Os tipos que o §74 pede como primeiros componentes. */
export const AWS_EMITTERS: Record<string, Emitter> = {
  "aws.alb": alb,
  "aws.ecs": ecs,
  "aws.rds": rds,
  "aws.s3": s3,
  "aws.elasticache": elasticache,
};

/** Variáveis compartilhadas por todos os alvos AWS. */
export function sharedVariables(): { variables: TofuBlock[]; tfvars: [string, string][] } {
  return {
    variables: [
      variable("region", [
        ["type", ref("string")],
        ["description", str("Regiao da AWS")],
        ["default", str("us-east-1")],
      ]),
      variable("project", [
        ["type", ref("string")],
        ["description", str("Prefixo dos nomes dos recursos")],
      ]),
      variable("environment", [
        ["type", ref("string")],
        ["description", str("Ambiente da arquitetura")],
      ]),
      variable("vpc_cidr", [
        ["type", ref("string")],
        ["description", str("Bloco CIDR da VPC")],
        ["default", str("10.20.0.0/16")],
      ]),
      variable("container_image", [
        ["type", ref("string")],
        ["description", str("Imagem publicada para os servicos de compute")],
        ["default", str("public.ecr.aws/nginx/nginx:stable")],
      ]),
      variable("container_port", [
        ["type", ref("number")],
        ["description", str("Porta em que a aplicacao escuta")],
        ["default", num(80)],
      ]),
      variable("certificate_arn", [
        ["type", ref("string")],
        ["description", str("Certificado do listener HTTPS, quando houver")],
        ["default", ref("null")],
      ]),
    ],
    tfvars: [],
  };
}
