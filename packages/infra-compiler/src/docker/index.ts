import { getCatalogItem } from "@infraflow/registry";
import {
  isLoadGeneratorNode,
  isResourceNode,
  type ArchitectureDocument,
  type ResourceNode,
} from "@infraflow/schema";
import {
  attributeOf,
  block,
  bool,
  heredoc,
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
  type TofuFile,
} from "@infraflow/opentofu-generator";
import { uniqueIdentifiers } from "../names.ts";
import type { CompiledStack, CompileWarning, DockerRuntime } from "../types.ts";
import { SYNTHETIC_APP, nginxConf } from "./app.ts";
import { PROMETHEUS_PORT, collectorConfig, prometheusConfig } from "./observability.ts";

/**
 * Grafo → containers, para o laboratório efêmero (PRD §76).
 *
 * A topologia do canvas vira topologia de rede de verdade: a rede é exclusiva
 * do laboratório, os containers conversam por DNS interno e **só a porta de
 * entrada é publicada**. Nada além dela é alcançável de fora — é o isolamento
 * que o §52 exige, aplicado onde ele é verificável.
 *
 * O que o alvo AWS chama de serviço, aqui é container com a imagem oficial do
 * software equivalente. O que não tem equivalente vira aviso, como no §74.
 */

interface ContainerSpec {
  image: string;
  /** Porta em que o serviço escuta dentro da rede. */
  port: number;
  role: DockerRuntime["containers"][number]["role"];
  /** Como a aplicação exercita esta dependência (PRD §76). */
  probe: "tcp" | "redis" | "http";
  env?: (node: ResourceNode) => [string, string][];
  command?: (node: ResourceNode) => string[];
}

function text(node: ResourceNode, key: string, fallback = ""): string {
  const value = node.properties[key];
  return value === undefined ? fallback : String(value);
}

function integer(node: ResourceNode, key: string, fallback: number): number {
  const value = node.properties[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** "2GB" → 2048 MiB, para o teto de memória do Redis. */
function megabytes(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return /mb/i.test(value) ? Math.round(parsed) : Math.round(parsed * 1024);
}

const POSTGRES: ContainerSpec = {
  image: "postgres:17-alpine",
  port: 5432,
  role: "database",
  probe: "tcp",
  env: () => [
    ["POSTGRES_USER", "infraflow"],
    ["POSTGRES_DB", "infraflow"],
  ],
  command: (node) => [
    "postgres",
    "-c",
    `max_connections=${integer(node, "maxConnections", 200)}`,
  ],
};

const MYSQL: ContainerSpec = {
  image: "mysql:8.4",
  port: 3306,
  role: "database",
  probe: "tcp",
  env: () => [["MYSQL_DATABASE", "infraflow"]],
  command: (node) => ["--max-connections", String(integer(node, "maxConnections", 200))],
};

const REDIS: ContainerSpec = {
  image: "redis:8-alpine",
  port: 6379,
  role: "cache",
  probe: "redis",
  command: (node) => [
    "redis-server",
    "--maxmemory",
    `${megabytes(text(node, "memory", "2GB"), 2048)}mb`,
    "--maxmemory-policy",
    text(node, "evictionPolicy", "allkeys-lru"),
    "--appendonly",
    node.properties.persistence === true ? "yes" : "no",
  ],
};

const APP: ContainerSpec = { image: "node:22-alpine", port: 8080, role: "app", probe: "http" };
const PROXY: ContainerSpec = { image: "nginx:1.29-alpine", port: 80, role: "proxy", probe: "http" };

const MINIO: ContainerSpec = {
  // A imagem oficial vive no quay.io; o repositório do Docker Hub recusa pull.
  image: "quay.io/minio/minio:latest",
  port: 9000,
  role: "storage",
  probe: "http",
  command: () => ["server", "/data"],
};

const SPECS: Record<string, ContainerSpec> = {
  "aws.ecs": APP,
  "aws.ec2": APP,
  "aws.lambda": APP,
  "opensource.docker": APP,
  "opensource.kubernetes": APP,

  "aws.alb": PROXY,
  "aws.nlb": PROXY,
  "aws.cloudfront": PROXY,
  "opensource.nginx": PROXY,
  "opensource.traefik": PROXY,

  "opensource.postgresql": POSTGRES,
  "opensource.mysql": MYSQL,

  "opensource.redis": REDIS,
  "aws.elasticache": REDIS,

  "aws.s3": MINIO,
  "opensource.minio": MINIO,

  "opensource.rabbitmq": { image: "rabbitmq:4-alpine", port: 5672, role: "queue", probe: "tcp" },
  "opensource.nats": { image: "nats:2-alpine", port: 4222, role: "queue", probe: "tcp" },
};

/** O RDS vira o banco que o engine escolhido indica. */
function specFor(node: ResourceNode): ContainerSpec | undefined {
  if (node.type !== "aws.rds") return SPECS[node.type];
  return /mysql|maria/i.test(text(node, "engine", "PostgreSQL 16")) ? MYSQL : POSTGRES;
}

export interface DockerCompileOptions {
  /** Identificador da execução — prefixa tudo que é efêmero (PRD §53). */
  slug: string;
}

export function compileDocker(
  document: ArchitectureDocument,
  options: DockerCompileOptions,
): CompiledStack {
  const prefix = `infraflow-${options.slug}`.toLowerCase();
  const resources = document.nodes.filter(isResourceNode);
  const names = uniqueIdentifiers(resources.map((node) => ({ id: node.id, name: node.name })));

  const warnings: CompileWarning[] = [];
  const planned = new Map<string, { node: ResourceNode; name: string; spec: ContainerSpec }>();

  for (const node of resources) {
    const spec = specFor(node);
    const name = names.get(node.id);
    if (!name) continue;

    if (!spec) {
      warnings.push({
        code: "unsupported-resource",
        nodeId: node.id,
        message: `${getCatalogItem(node.type)?.title ?? node.type} "${node.name}" não tem imagem equivalente no laboratório.`,
        hint: "O laboratório cobre compute, rede, banco, cache, armazenamento e fila.",
      });
      continue;
    }

    planned.set(node.id, { node, name, spec });
  }

  const containerName = (name: string) => `${prefix}-${name.replaceAll("_", "-")}`;

  const outgoing = new Map<string, string[]>();
  for (const edge of document.edges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }

  const network = resource("docker_network", "lab", [
    ["name", str(prefix)],
    ["attachable", bool(true)],
  ]);

  // --- porta de entrada: o primeiro recurso que o Load Generator alcança ---
  const origins = document.nodes.filter(isLoadGeneratorNode).map((node) => node.id);
  const entryId = origins
    .flatMap((origin) => outgoing.get(origin) ?? [])
    .find((id) => planned.has(id));

  if (!entryId) {
    warnings.push({
      code: "requires-input",
      message: "Nenhum recurso recebe a carga: o laboratório não teria porta de entrada.",
      hint: "Conecte o Load Generator ao ponto de entrada da arquitetura.",
    });
  }

  const blocks: TofuBlock[] = [network];
  const images = new Map<string, TofuBlock>();
  const runtimeContainers: DockerRuntime["containers"] = [];

  for (const [nodeId, entry] of planned) {
    const { node, name, spec } = entry;

    if (!images.has(spec.image)) {
      const imageBlock = resource("docker_image", `image_${images.size + 1}`, [
        ["name", str(spec.image)],
        // Imagem baixada uma vez serve todos os laboratórios da máquina.
        ["keep_locally", bool(true)],
      ]);
      images.set(spec.image, imageBlock);
      blocks.push(imageBlock);
    }
    const image = images.get(spec.image)!;

    // Dependências declaradas no canvas, para a aplicação exercitar.
    const deps = (outgoing.get(nodeId) ?? []).flatMap((targetId) => {
      const target = planned.get(targetId);
      if (!target) return [];
      return [
        {
          name: target.name,
          kind: target.spec.probe,
          host: containerName(target.name),
          port: target.spec.port,
        },
      ];
    });

    const env: [string, string][] = [
      ["SERVICE", node.name],
      ...(spec.env?.(node) ?? []),
    ];

    if (spec.role === "app") {
      env.push(["PORT", String(spec.port)], ["DEPS", JSON.stringify(deps)]);
    }
    if (spec.role === "database") {
      env.push(
        spec === MYSQL ? ["MYSQL_ROOT_PASSWORD", "${var.lab_password}"] : ["POSTGRES_PASSWORD", "${var.lab_password}"],
      );
    }
    if (spec.role === "storage") {
      env.push(["MINIO_ROOT_USER", "infraflow"], ["MINIO_ROOT_PASSWORD", "${var.lab_password}"]);
    }

    const uploads: TofuBlock[] = [];
    if (spec.role === "app") {
      uploads.push(
        block("upload", [], [
          ["file", str("/app/server.js")],
          ["content", heredoc("APP", SYNTHETIC_APP)],
        ]),
      );
    }
    if (spec.role === "proxy") {
      uploads.push(
        block("upload", [], [
          ["file", str("/etc/nginx/nginx.conf")],
          [
            "content",
            heredoc(
              "NGINX",
              nginxConf(
                deps
                  .filter((dep) => dep.kind === "http")
                  .map((dep) => ({ host: dep.host, port: dep.port })),
              ),
            ),
          ],
        ]),
      );
    }

    const command = spec.role === "app" ? ["node", "/app/server.js"] : spec.command?.(node);

    const container = resource(
      "docker_container",
      name,
      [
        ["name", str(containerName(name))],
        ["image", attributeOf(image, "image_id")],
        ...(command ? ([["command", list(command.map((part) => str(part)))]] as [string, ReturnType<typeof list>][]) : []),
        [
          "env",
          list(env.map(([key, value]) => (value.includes("${") ? interpolated(`${key}=${value}`) : str(`${key}=${value}`)))),
        ],
        ["restart", str("unless-stopped")],
        ["must_run", bool(true)],
        // Identifica o node do canvas para a observabilidade do §78.
        ["labels", list([])],
      ],
      [
        block("networks_advanced", [], [["name", attributeOf(network, "name")]]),
        block("labels", [], [
          ["label", str("infraflow.node")],
          ["value", str(node.id)],
        ]),
        block("labels", [], [
          ["label", str("infraflow.lab")],
          ["value", str(options.slug)],
        ]),
        ...uploads,
        ...(nodeId === entryId
          ? [
              block("ports", [], [
                ["internal", num(spec.port)],
                ["external", ref("var.entry_port")],
                ["ip", str("127.0.0.1")],
              ]),
            ]
          : []),
      ],
    );

    // `labels` é bloco repetido, não atributo: o atributo vazio acima só
    // existiria para confundir.
    container.attributes = container.attributes.filter(([key]) => key !== "labels");

    blocks.push(container);
    runtimeContainers.push({
      nodeId,
      name: containerName(name),
      image: spec.image,
      role: spec.role,
      port: spec.port,
    });
  }

  // --- observabilidade do §36: docker stats → OpenTelemetry → Prometheus ---
  const otelImage = resource("docker_image", "observability_collector", [
    ["name", str("otel/opentelemetry-collector-contrib:0.144.0")],
    ["keep_locally", bool(true)],
  ]);

  const collector = resource(
    "docker_container",
    "observability_collector",
    [
      ["name", str(`${prefix}-otel`)],
      ["image", attributeOf(otelImage, "image_id")],
      ["command", list([str("--config"), str("/etc/otelcol/config.yaml")])],
      // Ler o socket do Docker exige root dentro do container.
      ["user", str("0:0")],
      ["restart", str("unless-stopped")],
      ["must_run", bool(true)],
    ],
    [
      block("networks_advanced", [], [["name", attributeOf(network, "name")]]),
      block("volumes", [], [
        ["host_path", str("/var/run/docker.sock")],
        ["container_path", str("/var/run/docker.sock")],
        ["read_only", bool(true)],
      ]),
      block("upload", [], [
        ["file", str("/etc/otelcol/config.yaml")],
        ["content", heredoc("OTEL", collectorConfig(options.slug))],
      ]),
    ],
  );

  const prometheusImage = resource("docker_image", "observability_prometheus", [
    ["name", str("prom/prometheus:v3.7.3")],
    ["keep_locally", bool(true)],
  ]);

  const prometheus = resource(
    "docker_container",
    "observability_prometheus",
    [
      ["name", str(`${prefix}-prometheus`)],
      ["image", attributeOf(prometheusImage, "image_id")],
      [
        "command",
        list([
          str("--config.file=/etc/prometheus/prometheus.yml"),
          // Sem caminho explícito a imagem tenta gravar num diretório relativo
          // que não existe e o processo morre no arranque.
          str("--storage.tsdb.path=/prometheus"),
          // O laboratório é efêmero: a série não precisa sobreviver a ele.
          str("--storage.tsdb.retention.time=1h"),
        ]),
      ],
      ["restart", str("unless-stopped")],
      ["must_run", bool(true)],
    ],
    [
      block("networks_advanced", [], [["name", attributeOf(network, "name")]]),
      block("upload", [], [
        ["file", str("/etc/prometheus/prometheus.yml")],
        ["content", heredoc("PROM", prometheusConfig(`${prefix}-otel`))],
      ]),
      // Publicada só em 127.0.0.1: é o worker que consulta, ninguém mais.
      block("ports", [], [
        ["internal", num(PROMETHEUS_PORT)],
        ["external", ref("var.observability_port")],
        ["ip", str("127.0.0.1")],
      ]),
    ],
  );

  blocks.push(otelImage, collector, prometheusImage, prometheus);

  const providers: TofuFile = {
    name: "providers.tf",
    header: [
      "Laboratório efêmero gerado pelo InfraFlow (PRD §76).",
      "Rede exclusiva, containers descartáveis, só a porta de entrada publicada.",
    ],
    blocks: [
      block(
        "terraform",
        [],
        [["required_version", str(">= 1.6")]],
        [
          block("required_providers", [], [
            [
              "docker",
              obj([
                ["source", str("kreuzwerker/docker")],
                ["version", str("~> 3.0")],
              ]),
            ],
          ]),
        ],
      ),
      block("provider", ["docker"], []),
    ],
  };

  const variables: TofuFile = {
    name: "variables.tf",
    blocks: [
      variable("entry_port", [
        ["type", ref("number")],
        ["description", str("Porta publicada em 127.0.0.1 para o teste de carga")],
        ["default", num(18080)],
      ]),
      variable("observability_port", [
        ["type", ref("number")],
        ["description", str("Porta do Prometheus do laboratorio, em 127.0.0.1")],
        ["default", num(19090)],
      ]),
      variable("lab_password", [
        ["type", ref("string")],
        ["description", str("Senha dos servicos do laboratorio, efemera")],
        ["sensitive", bool(true)],
        ["default", str("infraflow-lab")],
      ]),
    ],
  };

  const entry = entryId ? planned.get(entryId) : undefined;
  const outputs: TofuFile = {
    name: "outputs.tf",
    blocks: [
      output("network", [["value", attributeOf(network, "name")]]),
      output("observability_url", [
        ["value", interpolated("http://127.0.0.1:${var.observability_port}")],
        ["description", str("Prometheus do laboratorio (PRD §78)")],
      ]),
      ...(entry
        ? [
            output("entry_url", [
              ["value", interpolated("http://127.0.0.1:${var.entry_port}")],
              ["description", str("Endereco que recebe a carga")],
            ]),
          ]
        : []),
    ],
  };

  const runtime: DockerRuntime = {
    network: prefix,
    containers: runtimeContainers,
    observability: { collector: `${prefix}-otel`, prometheus: `${prefix}-prometheus` },
    ...(entryId && entry ? { entry: { nodeId: entryId, port: entry.spec.port } } : {}),
  };

  return {
    target: "docker",
    files: [providers, { name: "main.tf", blocks }, variables, outputs],
    compiledNodeIds: [...planned.keys()],
    warnings,
    docker: runtime,
  };
}
