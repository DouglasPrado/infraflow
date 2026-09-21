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
 * O §74 pediu VPC, ALB, ECS, RDS, S3 e Redis; o catálogo cresceu e a tradução
 * acompanhou. Tipo sem emissor **não** é traduzido por aproximação — vira aviso
 * com a alternativa que o registry já conhece (§29). Inventar equivalência
 * silenciosa é exatamente o risco de IaC incorreta do §85.
 *
 * O mesmo vale dentro de um recurso: o que o canvas não declara sai como aviso
 * e não como valor inventado. Regra de WAF sem critério, assinatura de tópico
 * sem destino e registro de DNS sem alvo não viram HCL — viram texto dizendo o
 * que falta.
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


// ----------------------------------------------------- DynamoDB, SNS, Kinesis

const dynamodb: Emitter = ({ node, name }) => {
  const base = empty();
  const provisioned = text(node, "billingMode", "On-demand") === "Provisioned";

  const table = resource(
    "aws_dynamodb_table",
    name,
    [
      ["name", interpolated(`\${var.project}-\${var.environment}-${hyphen(name)}`)],
      ["billing_mode", str(provisioned ? "PROVISIONED" : "PAY_PER_REQUEST")],
      ...(provisioned
        ? ([
            ["read_capacity", num(integer(node, "readCapacity", 5))],
            ["write_capacity", num(integer(node, "writeCapacity", 5))],
          ] as [string, ReturnType<typeof num>][])
        : []),
      ["hash_key", str("id")],
      ...(flag(node, "streams")
        ? ([
            ["stream_enabled", bool(true)],
            ["stream_view_type", str("NEW_AND_OLD_IMAGES")],
          ] as [string, ReturnType<typeof bool>][])
        : []),
      ["tags", tags(hyphen(name))],
    ],
    [
      block("attribute", [], [
        ["name", str("id")],
        ["type", str("S")],
      ]),
      block("point_in_time_recovery", [], [["enabled", bool(flag(node, "pointInTimeRecovery", true))]]),
    ],
  );

  const warnings: CompileWarning[] = [];
  if (flag(node, "globalTables")) {
    warnings.push({
      code: "requires-input",
      nodeId: node.id,
      message: `A tabela "${node.name}" pede tabelas globais, que exigem as regiões de réplica.`,
      hint: "O canvas não declara região de réplica; adicione `replica` ao recurso antes do apply.",
    });
  }

  return {
    ...base,
    warnings,
    blocks: [table],
    outputs: [output(`${name}_table`, [
          ["value", attributeOf(table, "name")],
          ["description", str(`Tabela ${node.name}`)],
        ])],
    main: table,
  };
};

const sns: Emitter = ({ node, name }) => {
  const base = empty();
  const fifo = flag(node, "fifo");

  // A AWS exige o sufixo `.fifo` no nome do tópico ordenado.
  const topic = resource("aws_sns_topic", name, [
    [
      "name",
      interpolated(`\${var.project}-\${var.environment}-${hyphen(name)}${fifo ? ".fifo" : ""}`),
    ],
    ["fifo_topic", bool(fifo)],
    ...(fifo ? ([["content_based_deduplication", bool(true)]] as [string, ReturnType<typeof bool>][]) : []),
    ...(flag(node, "encryption", true)
      ? ([["kms_master_key_id", str("alias/aws/sns")]] as [string, ReturnType<typeof str>][])
      : []),
    ["tags", tags(hyphen(name))],
  ]);

  const warnings: CompileWarning[] = [];
  const subscriptions = integer(node, "subscriptions", 0);
  if (subscriptions > 0) {
    warnings.push({
      code: "requires-input",
      nodeId: node.id,
      message: `O tópico "${node.name}" declara ${subscriptions} assinaturas, mas nenhuma tem destino no canvas.`,
      hint: "Assinatura precisa de endpoint (fila, função, e-mail). Ligue o tópico a um destino ou declare depois do apply.",
    });
  }

  return {
    ...base,
    warnings,
    blocks: [topic],
    outputs: [output(`${name}_topic_arn`, [
          ["value", attributeOf(topic, "arn")],
          ["description", str(`Tópico ${node.name}`)],
        ])],
    main: topic,
  };
};

const kinesis: Emitter = ({ node, name }) => {
  const base = empty();

  const stream = resource(
    "aws_kinesis_stream",
    name,
    [
      ["name", interpolated(`\${var.project}-\${var.environment}-${hyphen(name)}`)],
      ["shard_count", num(integer(node, "shards", 1))],
      ["retention_period", num(integer(node, "retentionHours", 24))],
      ...(flag(node, "encryption", true)
        ? ([
            ["encryption_type", str("KMS")],
            ["kms_key_id", str("alias/aws/kinesis")],
          ] as [string, ReturnType<typeof str>][])
        : []),
      ["tags", tags(hyphen(name))],
    ],
    [block("stream_mode_details", [], [["stream_mode", str("PROVISIONED")]])],
  );

  return {
    ...base,
    blocks: [stream],
    outputs: [output(`${name}_stream`, [
          ["value", attributeOf(stream, "name")],
          ["description", str(`Fluxo ${node.name}`)],
        ])],
    main: stream,
  };
};

const eventbridge: Emitter = ({ node, name }) => {
  const base = empty();
  const blocks: TofuBlock[] = [];

  /**
   * O barramento `default` já existe na conta: criá-lo falharia o apply. Só o
   * customizado vira recurso.
   */
  const custom = text(node, "busType", "custom") === "custom";
  const bus = custom
    ? resource("aws_cloudwatch_event_bus", name, [
        ["name", interpolated(`\${var.project}-\${var.environment}-${hyphen(name)}`)],
        ["tags", tags(hyphen(name))],
      ])
    : undefined;
  if (bus) blocks.push(bus);

  if (flag(node, "archive") && bus) {
    blocks.push(
      resource("aws_cloudwatch_event_archive", name, [
        ["name", interpolated(`\${var.project}-${hyphen(name)}`)],
        ["event_source_arn", attributeOf(bus, "arn")],
      ]),
    );
  }

  const warnings: CompileWarning[] = [];
  if (!custom) {
    warnings.push({
      code: "assumption",
      nodeId: node.id,
      message: `O barramento "${node.name}" usa o \`default\`, que já existe na conta.`,
      hint: "Nenhum recurso foi emitido para ele: o padrão não se cria nem se destrói.",
    });
  }
  if (integer(node, "rules", 0) > 0) {
    warnings.push({
      code: "requires-input",
      nodeId: node.id,
      message: `"${node.name}" declara regras, mas o canvas não descreve o padrão de evento nem o destino.`,
      hint: "Regra do EventBridge exige `event_pattern` e `target`; declare-os depois do apply.",
    });
  }

  return {
    ...base,
    warnings,
    blocks,
    outputs: bus ? [output(`${name}_bus`, [
          ["value", attributeOf(bus, "name")],
          ["description", str(`Barramento ${node.name}`)],
        ])] : [],
    ...(bus ? { main: bus } : {}),
  };
};

const secretsmanager: Emitter = ({ node, name }) => {
  const base = empty();
  const rotation = flag(node, "automaticRotation");

  const secret = resource("aws_secretsmanager_secret", name, [
    ["name", interpolated(`\${var.project}/\${var.environment}/${hyphen(name)}`)],
    ["description", str(`Segredo ${node.name}`)],
    ["recovery_window_in_days", num(7)],
    ["tags", tags(hyphen(name))],
  ]);

  const warnings: CompileWarning[] = [];
  const secrets = integer(node, "secrets", 1);
  if (secrets > 1) {
    warnings.push({
      code: "assumption",
      nodeId: node.id,
      message: `"${node.name}" declara ${secrets} segredos; foi emitido um.`,
      hint: "Cada segredo tem nome e conteúdo próprios, que o canvas não descreve. Use `for_each` no arquivo gerado para os demais.",
    });
  }
  if (rotation) {
    warnings.push({
      code: "requires-input",
      nodeId: node.id,
      message: `A rotação automática de "${node.name}" precisa de uma função Lambda que faça a rotação.`,
      hint: "Sem `rotation_lambda_arn` o recurso não foi emitido; declare-o antes do apply.",
    });
  }

  return {
    ...base,
    warnings,
    blocks: [secret],
    outputs: [output(`${name}_secret_arn`, [
          ["value", attributeOf(secret, "arn")],
          ["description", str(`Segredo ${node.name}`)],
        ])],
    main: secret,
  };
};


// ------------------------------------------------ Aurora, OpenSearch, EFS

/** Aurora publica o endpoint numa porta que depende do engine escolhido. */
const AURORA_ENGINES: Record<string, { engine: string; port: number; family: string }> = {
  "Aurora PostgreSQL": { engine: "aurora-postgresql", port: 5432, family: "aurora-postgresql16" },
  "Aurora MySQL": { engine: "aurora-mysql", port: 3306, family: "aurora-mysql8.0" },
};

const aurora: Emitter = ({ node, name, network }) => {
  const base = empty();
  const spec = AURORA_ENGINES[text(node, "engine", "Aurora PostgreSQL")] ?? AURORA_ENGINES["Aurora PostgreSQL"]!;
  const group = securityGroup(name, `Cluster ${node.name}`, network);

  const subnets = resource("aws_db_subnet_group", name, [
    ["name", interpolated(`\${var.project}-${hyphen(name)}`)],
    ["subnet_ids", network.privateSubnetIds],
    ["tags", tags(hyphen(name))],
  ]);

  const password = variable(`${name}_password`, [
    ["type", ref("string")],
    ["description", str(`Senha do usuario mestre de ${node.name}`)],
    ["sensitive", bool(true)],
  ]);

  const cluster = resource("aws_rds_cluster", name, [
    ["cluster_identifier", interpolated(`\${var.project}-${hyphen(name)}`)],
    ["engine", str(spec.engine)],
    ["database_name", str("app")],
    ["master_username", str("infraflow")],
    ["master_password", ref(`var.${name}_password`)],
    ["db_subnet_group_name", attributeOf(subnets, "name")],
    ["vpc_security_group_ids", list([attributeOf(group, "id")])],
    ["backup_retention_period", num(integer(node, "backupRetentionDays", 7))],
    ["storage_encrypted", bool(true)],
    /**
     * Aurora cresce o armazenamento sozinho: `storageGb` do painel é o volume
     * esperado, usado na estimativa de custo, não um campo do cluster.
     */
    ["skip_final_snapshot", bool(true)],
    ["tags", tags(hyphen(name))],
  ]);

  const blocks: TofuBlock[] = [group, egressAll(name, group), subnets, cluster];

  /**
   * Uma escritora sempre; as leitoras vêm do painel. Multi-AZ no Aurora é
   * consequência de espalhar instâncias, não um campo — sem leitora, o cluster
   * vive numa zona só.
   */
  const readers = integer(node, "readers", 0);
  const instances = 1 + readers;
  for (let index = 0; index < instances; index += 1) {
    blocks.push(
      resource("aws_rds_cluster_instance", `${name}_${index}`, [
        ["identifier", interpolated(`\${var.project}-${hyphen(name)}-${index}`)],
        ["cluster_identifier", attributeOf(cluster, "id")],
        ["instance_class", str(text(node, "instanceClass", "db.r6g.large"))],
        ["engine", str(spec.engine)],
        ["tags", tags(`${hyphen(name)}-${index}`)],
      ]),
    );
  }

  const warnings: CompileWarning[] = [];
  if (flag(node, "multiAz", true) && readers === 0) {
    warnings.push({
      code: "assumption",
      nodeId: node.id,
      message: `"${node.name}" pede Multi-AZ, mas sem leitora o cluster tem uma instância só.`,
      hint: "No Aurora, a redundância entre zonas vem de ter instâncias em zonas diferentes: suba `readers` para pelo menos 1.",
    });
  }

  return {
    ...base,
    warnings,
    blocks,
    variables: [password],
    tfvars: [[`${name}_password`, '"troque-antes-do-apply"']],
    outputs: [
      output(`${name}_endpoint`, [
        ["value", attributeOf(cluster, "endpoint")],
        ["description", str(`Endpoint de escrita de ${node.name}`)],
      ]),
      output(`${name}_reader_endpoint`, [
        ["value", attributeOf(cluster, "reader_endpoint")],
        ["description", str(`Endpoint de leitura de ${node.name}`)],
      ]),
    ],
    securityGroup: group,
    listenPort: spec.port,
    main: cluster,
  };
};

const opensearch: Emitter = ({ node, name, network }) => {
  const base = empty();
  const group = securityGroup(name, `Busca ${node.name}`, network);
  const nodes = integer(node, "nodes", 1);
  const zoneAwareness = flag(node, "zoneAwareness", true) && nodes > 1;

  const domain = resource(
    "aws_opensearch_domain",
    name,
    [
      ["domain_name", interpolated(`\${var.project}-${hyphen(name)}`)],
      ["engine_version", str("OpenSearch_2.13")],
      ["tags", tags(hyphen(name))],
    ],
    [
      block(
        "cluster_config",
        [],
        [
          ["instance_type", str(text(node, "instanceType", "r6g.large.search"))],
          ["instance_count", num(nodes)],
          ["zone_awareness_enabled", bool(zoneAwareness)],
          ...(flag(node, "dedicatedMaster")
            ? ([
                ["dedicated_master_enabled", bool(true)],
                ["dedicated_master_type", str("r6g.large.search")],
                ["dedicated_master_count", num(3)],
              ] as [string, ReturnType<typeof num>][])
            : []),
        ],
        zoneAwareness
          ? [block("zone_awareness_config", [], [["availability_zone_count", num(2)]])]
          : [],
      ),
      block("ebs_options", [], [
        ["ebs_enabled", bool(true)],
        ["volume_size", num(integer(node, "storageGb", 10))],
        ["volume_type", str("gp3")],
      ]),
      block("encrypt_at_rest", [], [["enabled", bool(true)]]),
      block("node_to_node_encryption", [], [["enabled", bool(true)]]),
      block("domain_endpoint_options", [], [["enforce_https", bool(true)]]),
      block("vpc_options", [], [
        ["subnet_ids", network.privateSubnetIds],
        ["security_group_ids", list([attributeOf(group, "id")])],
      ]),
    ],
  );

  return {
    ...base,
    blocks: [group, egressAll(name, group), domain],
    outputs: [
      output(`${name}_endpoint`, [
        ["value", attributeOf(domain, "endpoint")],
        ["description", str(`Endpoint de ${node.name}`)],
      ]),
    ],
    securityGroup: group,
    listenPort: 443,
    main: domain,
  };
};

const efs: Emitter = ({ node, name, network }) => {
  const base = empty();
  const group = securityGroup(name, `Arquivos ${node.name}`, network);
  const throughputMode = text(node, "throughputMode", "elastic");
  const provisioned = throughputMode === "provisioned";

  const filesystem = resource(
    "aws_efs_file_system",
    name,
    [
      ["creation_token", interpolated(`\${var.project}-${hyphen(name)}`)],
      ["performance_mode", str(text(node, "performanceMode", "generalPurpose"))],
      ["throughput_mode", str(throughputMode)],
      ...(provisioned
        ? ([["provisioned_throughput_in_mibps", num(integer(node, "provisionedMibps", 1))]] as [
            string,
            ReturnType<typeof num>,
          ][])
        : []),
      ["encrypted", bool(flag(node, "encrypted", true))],
      ["tags", tags(hyphen(name))],
    ],
    flag(node, "lifecycleToIa", true)
      ? [block("lifecycle_policy", [], [["transition_to_ia", str("AFTER_30_DAYS")]])]
      : [],
  );

  /**
   * O destino de montagem é por sub-rede: sem ele o sistema de arquivos existe
   * e nenhuma tarefa alcança. Uma zona, um destino — igual à VPC.
   */
  const mounts = network.privateSubnetIds.items.map((subnet, index) =>
    resource("aws_efs_mount_target", `${name}_${index}`, [
      ["file_system_id", attributeOf(filesystem, "id")],
      ["subnet_id", subnet],
      ["security_groups", list([attributeOf(group, "id")])],
    ]),
  );

  const warnings: CompileWarning[] = [];
  if (provisioned && integer(node, "provisionedMibps", 0) <= 0) {
    warnings.push({
      code: "requires-input",
      nodeId: node.id,
      message: `"${node.name}" está em throughput provisionado com 0 MiB/s.`,
      hint: "Informe o throughput provisionado ou troque para `elastic`; a AWS recusa provisionado sem valor.",
    });
  }

  return {
    ...base,
    warnings,
    blocks: [group, egressAll(name, group), filesystem, ...mounts],
    outputs: [
      output(`${name}_file_system_id`, [
        ["value", attributeOf(filesystem, "id")],
        ["description", str(`Sistema de arquivos ${node.name}`)],
      ]),
    ],
    securityGroup: group,
    // NFS: é a porta que o cliente abre contra o destino de montagem.
    listenPort: 2049,
    main: filesystem,
  };
};


// --------------------------------------- API Gateway, Route 53, NAT, WAF

const apigateway: Emitter = ({ node, name }) => {
  const base = empty();
  const rest = text(node, "apiType", "HTTP") === "REST";
  const warnings: CompileWarning[] = [];

  /**
   * Só o HTTP API é emitido. O REST API do §74 exige recurso, método e
   * integração por rota — coisas que o canvas não descreve, e inventá-las
   * produziria uma API que não corresponde a nada.
   */
  if (rest) {
    return {
      ...base,
      blocks: [],
      warnings: [
        {
          code: "unsupported-resource",
          nodeId: node.id,
          message: `"${node.name}" é um REST API, que precisa de rota, método e integração declarados.`,
          hint: "Troque para o tipo HTTP, que o compiler emite com rota coringa, ou declare o REST API à mão.",
        },
      ],
    };
  }

  const api = resource(
    "aws_apigatewayv2_api",
    name,
    [
      ["name", interpolated(`\${var.project}-${hyphen(name)}`)],
      ["protocol_type", str("HTTP")],
      ["tags", tags(hyphen(name))],
    ],
    [
      block("cors_configuration", [], [
        ["allow_origins", list([str("*")])],
        ["allow_methods", list([str("GET"), str("POST"), str("PUT"), str("DELETE"), str("OPTIONS")])],
        ["allow_headers", list([str("*")])],
      ]),
    ],
  );

  const stage = resource(
    "aws_apigatewayv2_stage",
    name,
    [
      ["api_id", attributeOf(api, "id")],
      ["name", str("$default")],
      ["auto_deploy", bool(true)],
      ["tags", tags(hyphen(name))],
    ],
    [
      block("default_route_settings", [], [
        ["throttling_rate_limit", num(integer(node, "throttleRps", 10000))],
        ["throttling_burst_limit", num(integer(node, "burstLimit", 5000))],
      ]),
    ],
  );

  if (text(node, "authorizer", "none") !== "none") {
    warnings.push({
      code: "requires-input",
      nodeId: node.id,
      message: `O authorizer de "${node.name}" precisa de emissor e audiência, que o canvas não declara.`,
      hint: "Declare `aws_apigatewayv2_authorizer` com o seu provedor antes do apply.",
    });
  }
  if (flag(node, "caching")) {
    warnings.push({
      code: "assumption",
      nodeId: node.id,
      message: `Cache de resposta foi pedido em "${node.name}", mas o HTTP API não tem cache gerenciado.`,
      hint: "Cache de resposta existe no REST API; à frente do HTTP API, quem cacheia é o CloudFront.",
    });
  }

  return {
    ...base,
    warnings,
    blocks: [api, stage],
    outputs: [
      output(`${name}_endpoint`, [
        ["value", attributeOf(stage, "invoke_url")],
        ["description", str(`Endereco publico de ${node.name}`)],
      ]),
    ],
    main: api,
  };
};

const route53: Emitter = ({ node, name }) => {
  const base = empty();

  const domain = variable(`${name}_domain`, [
    ["type", ref("string")],
    ["description", str(`Dominio da zona ${node.name}`)],
  ]);

  const zone = resource("aws_route53_zone", name, [
    ["name", ref(`var.${name}_domain`)],
    ["comment", str(`Zona ${node.name}`)],
    ["tags", tags(hyphen(name))],
  ]);

  const warnings: CompileWarning[] = [
    {
      code: "assumption",
      nodeId: node.id,
      message: `A zona "${node.name}" nasce vazia: os registros não vêm do canvas.`,
      hint: "O canvas declara quantos registros existem, não para onde apontam. Adicione `aws_route53_record` depois do apply.",
    },
  ];

  if (flag(node, "healthCheck")) {
    warnings.push({
      code: "requires-input",
      nodeId: node.id,
      message: `O health check de "${node.name}" precisa do endereço a monitorar.`,
      hint: "Declare `aws_route53_health_check` apontando para o endpoint que deve ser vigiado.",
    });
  }

  return {
    ...base,
    warnings,
    blocks: [zone],
    variables: [domain],
    tfvars: [[`${name}_domain`, '"exemplo.com"']],
    outputs: [
      output(`${name}_name_servers`, [
        ["value", attributeOf(zone, "name_servers")],
        ["description", str(`Servidores de nome de ${node.name}`)],
      ]),
    ],
    main: zone,
  };
};

const natgateway: Emitter = ({ node, name, network }) => {
  const base = empty();
  const requested = integer(node, "azs", 1);
  /**
   * A VPC tem duas zonas: pedir mais gateways que sub-redes públicas emitiria
   * recurso sem onde morar.
   */
  const azs = Math.min(requested, network.publicSubnetIds.items.length);
  const blocks: TofuBlock[] = [];
  const outputs: TofuBlock[] = [];

  for (let index = 0; index < azs; index += 1) {
    const ip = resource("aws_eip", `${name}_${index}`, [
      ["domain", str("vpc")],
      ["tags", tags(`${hyphen(name)}-${index}`)],
    ]);

    const gateway = resource("aws_nat_gateway", `${name}_${index}`, [
      ["allocation_id", attributeOf(ip, "id")],
      ["subnet_id", network.publicSubnetIds.items[index]!],
      ["connectivity_type", str(text(node, "connectivityType", "public"))],
      ["tags", tags(`${hyphen(name)}-${index}`)],
      ["depends_on", ref("[aws_internet_gateway.main]")],
    ]);

    blocks.push(ip, gateway);
    outputs.push(
      output(`${name}_${index}_ip`, [
        ["value", attributeOf(ip, "public_ip")],
        ["description", str(`Endereco de saida ${index} de ${node.name}`)],
      ]),
    );
  }

  const warnings: CompileWarning[] = [];
  if (requested > azs) {
    warnings.push({
      code: "assumption",
      nodeId: node.id,
      message: `"${node.name}" pede ${requested} zonas, e a VPC tem ${azs} sub-redes públicas.`,
      hint: `Foram emitidos ${azs} gateways. Mais zonas exigem mais sub-redes públicas na VPC.`,
    });
  }
  warnings.push({
    code: "assumption",
    nodeId: node.id,
    message: `O NAT de "${node.name}" foi emitido, mas nenhuma tabela de rotas aponta para ele.`,
    hint: "A VPC do §74 coloca a aplicação em sub-rede pública com IP próprio; a rota privada via NAT é escolha de quem for aplicar.",
  });

  return { ...base, warnings, blocks, outputs, ...(blocks[1] ? { main: blocks[1] } : {}) };
};

const waf: Emitter = ({ node, name }) => {
  const base = empty();
  const managed = integer(node, "managedRuleGroups", 0);
  const rateLimit = integer(node, "rateLimitRpm", 0);

  /** Os grupos gerenciados mais usados, na ordem em que a AWS os recomenda. */
  const MANAGED = ["AWSManagedRulesCommonRuleSet", "AWSManagedRulesKnownBadInputsRuleSet", "AWSManagedRulesAmazonIpReputationList"];
  const children: TofuBlock[] = [
    block("default_action", [], [], [block("allow", [], [])]),
    block("visibility_config", [], [
      ["cloudwatch_metrics_enabled", bool(true)],
      ["metric_name", interpolated(`\${var.project}-${hyphen(name)}`)],
      ["sampled_requests_enabled", bool(true)],
    ]),
  ];

  MANAGED.slice(0, managed).forEach((rule, index) => {
    children.push(
      block(
        "rule",
        [],
        [
          ["name", str(rule)],
          ["priority", num(index + 1)],
        ],
        [
          block("override_action", [], [], [block("none", [], [])]),
          block("statement", [], [], [
            block("managed_rule_group_statement", [], [
              ["name", str(rule)],
              ["vendor_name", str("AWS")],
            ]),
          ]),
          block("visibility_config", [], [
            ["cloudwatch_metrics_enabled", bool(true)],
            ["metric_name", str(rule)],
            ["sampled_requests_enabled", bool(true)],
          ]),
        ],
      ),
    );
  });

  if (rateLimit > 0) {
    children.push(
      block(
        "rule",
        [],
        [
          ["name", str("rate-limit")],
          ["priority", num(MANAGED.slice(0, managed).length + 1)],
        ],
        [
          block("action", [], [], [block("block", [], [])]),
          block("statement", [], [], [
            block("rate_based_statement", [], [
              ["limit", num(rateLimit)],
              ["aggregate_key_type", str("IP")],
            ]),
          ]),
          block("visibility_config", [], [
            ["cloudwatch_metrics_enabled", bool(true)],
            ["metric_name", str("rate-limit")],
            ["sampled_requests_enabled", bool(true)],
          ]),
        ],
      ),
    );
  }

  const acl = resource(
    "aws_wafv2_web_acl",
    name,
    [
      ["name", interpolated(`\${var.project}-${hyphen(name)}`)],
      ["scope", str(text(node, "scope", "REGIONAL"))],
      ["tags", tags(hyphen(name))],
    ],
    children,
  );

  const warnings: CompileWarning[] = [];
  if (managed > MANAGED.length) {
    warnings.push({
      code: "assumption",
      nodeId: node.id,
      message: `"${node.name}" pede ${managed} grupos gerenciados; o compiler conhece ${MANAGED.length}.`,
      hint: `Foram emitidos ${MANAGED.length}. Os demais precisam do nome do grupo, que o canvas não declara.`,
    });
  }
  if (integer(node, "customRules", 0) > 0) {
    warnings.push({
      code: "requires-input",
      nodeId: node.id,
      message: `As regras próprias de "${node.name}" não têm critério declarado no canvas.`,
      hint: "Regra do WAF precisa de `statement`. Declare-as no arquivo gerado antes do apply.",
    });
  }
  warnings.push({
    code: "assumption",
    nodeId: node.id,
    message: `O Web ACL de "${node.name}" foi emitido sem associação.`,
    hint: "Ligue-o ao balanceador ou à distribuição com `aws_wafv2_web_acl_association`.",
  });

  return {
    ...base,
    warnings,
    blocks: [acl],
    outputs: [
      output(`${name}_web_acl_arn`, [
        ["value", attributeOf(acl, "arn")],
        ["description", str(`Web ACL ${node.name}`)],
      ]),
    ],
    main: acl,
  };
};


// ------------------------------------------------------------ EKS, Fargate

/** Política de confiança de um serviço da AWS, no formato que o IAM espera. */
const assumeRole = (service: string) =>
  ref(
    [
      "jsonencode({",
      '  Version = "2012-10-17"',
      "  Statement = [{",
      '    Effect    = "Allow"',
      '    Action    = "sts:AssumeRole"',
      `    Principal = { Service = "${service}" }`,
      "  }]",
      "})",
    ].join("\n"),
  );

const eks: Emitter = ({ node, name, network }) => {
  const base = empty();
  const group = securityGroup(name, `Cluster ${node.name}`, network);

  const clusterRole = resource("aws_iam_role", `${name}_cluster`, [
    ["name", interpolated(`\${var.project}-${hyphen(name)}-cluster`)],
    ["assume_role_policy", assumeRole("eks.amazonaws.com")],
  ]);

  const nodeRole = resource("aws_iam_role", `${name}_node`, [
    ["name", interpolated(`\${var.project}-${hyphen(name)}-node`)],
    ["assume_role_policy", assumeRole("ec2.amazonaws.com")],
  ]);

  /** As políticas gerenciadas sem as quais o cluster não sobe nem registra node. */
  const attachments: TofuBlock[] = [
    ["AmazonEKSClusterPolicy", clusterRole, "cluster"],
    ["AmazonEKSWorkerNodePolicy", nodeRole, "node_worker"],
    ["AmazonEKS_CNI_Policy", nodeRole, "node_cni"],
    ["AmazonEC2ContainerRegistryReadOnly", nodeRole, "node_registry"],
  ].map(([policy, role, suffix]) =>
    resource("aws_iam_role_policy_attachment", `${name}_${suffix as string}`, [
      ["role", attributeOf(role as TofuBlock, "name")],
      ["policy_arn", str(`arn:aws:iam::aws:policy/${policy as string}`)],
    ]),
  );

  const cluster = resource(
    "aws_eks_cluster",
    name,
    [
      ["name", interpolated(`\${var.project}-${hyphen(name)}`)],
      ["role_arn", attributeOf(clusterRole, "arn")],
      ["version", str("1.31")],
      ["depends_on", ref(`[aws_iam_role_policy_attachment.${name}_cluster]`)],
      ["tags", tags(hyphen(name))],
    ],
    [
      block("vpc_config", [], [
        // O control plane alcança os nodes pelas sub-redes privadas.
        ["subnet_ids", network.privateSubnetIds],
        ["security_group_ids", list([attributeOf(group, "id")])],
        ["endpoint_private_access", bool(true)],
        ["endpoint_public_access", bool(true)],
      ]),
    ],
  );

  const autoScaling = flag(node, "autoScaling", true);
  const desired = integer(node, "nodes", 2);
  const max = autoScaling ? Math.max(desired, integer(node, "maxNodes", desired)) : desired;

  const nodeGroup = resource(
    "aws_eks_node_group",
    name,
    [
      ["cluster_name", attributeOf(cluster, "name")],
      ["node_group_name", interpolated(`\${var.project}-${hyphen(name)}`)],
      ["node_role_arn", attributeOf(nodeRole, "arn")],
      ["subnet_ids", network.privateSubnetIds],
      ["instance_types", list([str(text(node, "nodeInstanceType", "m6i.large"))])],
      [
        "depends_on",
        ref(
          `[aws_iam_role_policy_attachment.${name}_node_worker, aws_iam_role_policy_attachment.${name}_node_cni, aws_iam_role_policy_attachment.${name}_node_registry]`,
        ),
      ],
      ["tags", tags(hyphen(name))],
    ],
    [
      block("scaling_config", [], [
        ["desired_size", num(desired)],
        ["min_size", num(Math.min(desired, 1))],
        ["max_size", num(max)],
      ]),
    ],
  );

  const warnings: CompileWarning[] = [];
  if (flag(node, "fargateProfile")) {
    warnings.push({
      code: "requires-input",
      nodeId: node.id,
      message: `O perfil Fargate de "${node.name}" precisa dos namespaces que rodam sem node.`,
      hint: "Declare `aws_eks_fargate_profile` com o seletor de namespace antes do apply.",
    });
  }
  warnings.push({
    code: "assumption",
    nodeId: node.id,
    message: `O cluster "${node.name}" sobe vazio: nenhum workload do canvas vira Deployment.`,
    hint: "O §74 traduz infraestrutura, não manifesto de Kubernetes. Aplique os seus com kubectl ou Helm.",
  });

  return {
    ...base,
    warnings,
    blocks: [group, egressAll(name, group), clusterRole, nodeRole, ...attachments, cluster, nodeGroup],
    outputs: [
      output(`${name}_endpoint`, [
        ["value", attributeOf(cluster, "endpoint")],
        ["description", str(`Servidor de API de ${node.name}`)],
      ]),
    ],
    securityGroup: group,
    listenPort: 443,
    main: cluster,
  };
};

const fargate: Emitter = ({ node, name, network }) => {
  const base = empty();
  const group = securityGroup(name, `Tarefa ${node.name}`, network);

  const cluster = resource("aws_ecs_cluster", name, [
    ["name", interpolated(`\${var.project}-${hyphen(name)}`)],
    ["tags", tags(hyphen(name))],
  ]);

  const logs = resource("aws_cloudwatch_log_group", name, [
    ["name", interpolated(`/fargate/\${var.project}-${hyphen(name)}`)],
    ["retention_in_days", num(14)],
  ]);

  const executionRole = resource("aws_iam_role", `${name}_execution`, [
    ["name", interpolated(`\${var.project}-${hyphen(name)}-execution`)],
    ["assume_role_policy", assumeRole("ecs-tasks.amazonaws.com")],
  ]);

  const rolePolicy = resource("aws_iam_role_policy_attachment", `${name}_execution`, [
    ["role", attributeOf(executionRole, "name")],
    ["policy_arn", str("arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy")],
  ]);

  const cpu = cpuUnits(text(node, "cpu", "1 vCPU"));
  const memory = memoryMib(text(node, "memory", "2GB"));

  const task = resource(
    "aws_ecs_task_definition",
    name,
    [
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
            "  logConfiguration = {",
            '    logDriver = "awslogs"',
            "    options = {",
            `      awslogs-group         = aws_cloudwatch_log_group.${name}.name`,
            "      awslogs-region        = var.region",
            '      awslogs-stream-prefix = "fargate"',
            "    }",
            "  }",
            "}])",
          ].join("\n"),
        ),
      ],
      ["tags", tags(hyphen(name))],
    ],
    [
      block("ephemeral_storage", [], [
        ["size_in_gib", num(Math.max(21, integer(node, "ephemeralStorageGb", 21)))],
      ]),
    ],
  );

  const spot = flag(node, "spot");
  const service = resource(
    "aws_ecs_service",
    name,
    [
      ["name", interpolated(`\${var.project}-${hyphen(name)}`)],
      ["cluster", attributeOf(cluster, "id")],
      ["task_definition", attributeOf(task, "arn")],
      ["desired_count", num(integer(node, "tasks", 1))],
      // Spot e Fargate não convivem com `launch_type`: a escolha vira estratégia.
      ...(spot
        ? ([] as [string, ReturnType<typeof str>][])
        : ([["launch_type", str("FARGATE")]] as [string, ReturnType<typeof str>][])),
      ["tags", tags(hyphen(name))],
    ],
    [
      block("network_configuration", [], [
        ["subnets", network.publicSubnetIds],
        ["security_groups", list([attributeOf(group, "id")])],
        // Sem NAT na VPC do §74, a tarefa precisa de IP para puxar a imagem.
        ["assign_public_ip", bool(true)],
      ]),
      ...(spot
        ? [
            block("capacity_provider_strategy", [], [
              ["capacity_provider", str("FARGATE_SPOT")],
              ["weight", num(1)],
            ]),
          ]
        : []),
    ],
  );

  const warnings: CompileWarning[] = [];
  if (integer(node, "ephemeralStorageGb", 21) < 21) {
    warnings.push({
      code: "assumption",
      nodeId: node.id,
      message: `O armazenamento efêmero de "${node.name}" foi elevado ao mínimo do Fargate.`,
      hint: "A AWS exige pelo menos 21 GiB; abaixo disso o apply falha.",
    });
  }
  if (spot) {
    warnings.push({
      code: "assumption",
      nodeId: node.id,
      message: `"${node.name}" roda em Fargate Spot, que a AWS pode interromper com dois minutos de aviso.`,
      hint: "Spot serve a trabalho que tolera interrupção. Para tarefa que não tolera, desligue a opção.",
    });
  }

  return {
    ...base,
    warnings,
    blocks: [group, egressAll(name, group), cluster, logs, executionRole, rolePolicy, task, service],
    outputs: [
      output(`${name}_cluster`, [
        ["value", attributeOf(cluster, "name")],
        ["description", str(`Cluster de ${node.name}`)],
      ]),
    ],
    securityGroup: group,
    listenPort: 8080,
    main: service,
  };
};

/** Os tipos que o §74 pede como primeiros componentes. */
export const AWS_EMITTERS: Record<string, Emitter> = {
  "aws.alb": alb,
  "aws.ecs": ecs,
  "aws.rds": rds,
  "aws.s3": s3,
  "aws.elasticache": elasticache,
  "aws.dynamodb": dynamodb,
  "aws.sns": sns,
  "aws.kinesis": kinesis,
  "aws.eventbridge": eventbridge,
  "aws.secretsmanager": secretsmanager,
  "aws.aurora": aurora,
  "aws.opensearch": opensearch,
  "aws.efs": efs,
  "aws.apigateway": apigateway,
  "aws.route53": route53,
  "aws.natgateway": natgateway,
  "aws.waf": waf,
  "aws.eks": eks,
  "aws.fargate": fargate,
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
