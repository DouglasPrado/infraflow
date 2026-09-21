/**
 * Gera os ícones de serviço em `public/icons/` a partir de dois pacotes.
 *
 * - AWS: `aws-icons` (MIT) empacota os Architecture Icons oficiais da AWS.
 * - Open source: `simple-icons` (CC0), monocromático — a cor de marca é
 *   aplicada aqui, a partir do metadado do próprio pacote.
 *
 * Os SVGs resultantes são versionados, então a aplicação não depende destes
 * pacotes em runtime. Rode `pnpm icons` depois de mexer no mapa abaixo.
 */
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const WEB = path.join(import.meta.dirname, "..");
const OUT = path.join(WEB, "public", "icons");

/** Tipo do registry → ícone de origem. */
const MAP = {
  "aws.ec2": { pack: "aws", file: "AmazonEC2" },
  "aws.ecs": { pack: "aws", file: "AmazonElasticContainerService" },
  "aws.lambda": { pack: "aws", file: "AWSLambda" },
  "aws.s3": { pack: "aws", file: "AmazonSimpleStorageService" },
  "aws.rds": { pack: "aws", file: "AmazonRDS" },
  "aws.elasticache": { pack: "aws", file: "AmazonElastiCache" },
  "aws.alb": { pack: "aws", file: "ElasticLoadBalancing" },
  "aws.nlb": { pack: "aws", file: "ElasticLoadBalancing" },
  "aws.cloudfront": { pack: "aws", file: "AmazonCloudFront" },
  "aws.sqs": { pack: "aws", file: "AmazonSimpleQueueService" },
  "aws.cloudwatch": { pack: "aws", file: "AmazonCloudWatch" },

  "opensource.docker": { pack: "simple", file: "docker" },
  "opensource.kubernetes": { pack: "simple", file: "kubernetes" },
  "opensource.minio": { pack: "simple", file: "minio" },
  "opensource.postgresql": { pack: "simple", file: "postgresql" },
  "opensource.mysql": { pack: "simple", file: "mysql" },
  "opensource.redis": { pack: "simple", file: "redis" },
  "opensource.traefik": { pack: "simple", file: "traefikproxy" },
  "opensource.nginx": { pack: "simple", file: "nginx" },
  "opensource.rabbitmq": { pack: "simple", file: "rabbitmq" },
  "opensource.nats": { pack: "simple", file: "natsdotio" },
  "opensource.kafka": { pack: "simple", file: "apachekafka" },
  "opensource.prometheus": { pack: "simple", file: "prometheus" },
  "opensource.grafana": { pack: "simple", file: "grafana" },
  "opensource.opentelemetry": { pack: "simple", file: "opentelemetry" },
};

/**
 * Estes pacotes não exportam `./package.json`, então `require.resolve` não
 * serve. O symlink do pnpm em `node_modules` resolve direto.
 */
async function packageRoot(name) {
  for (const base of [WEB, path.join(WEB, "..", "..")]) {
    const candidate = path.join(base, "node_modules", name);
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error(`Pacote não encontrado em node_modules: ${name}`);
}

/** O `simple-icons` guarda a cor de marca no metadado, fora do SVG. */
async function brandColors(root) {
  const raw = await readFile(path.join(root, "data", "simple-icons.json"), "utf8");
  const data = JSON.parse(raw);
  const list = Array.isArray(data) ? data : data.icons;

  const bySlug = new Map();
  for (const icon of list) {
    const slug = icon.slug ?? icon.title.toLowerCase().replace(/[^a-z0-9]/g, "");
    bySlug.set(slug, `#${icon.hex}`);
  }
  return bySlug;
}

const awsRoot = await packageRoot("aws-icons");
const simpleRoot = await packageRoot("simple-icons");
const colors = await brandColors(simpleRoot);

const awsDir = path.join(awsRoot, "icons", "architecture-service");
const awsFiles = new Set(await readdir(awsDir));

await mkdir(OUT, { recursive: true });

let written = 0;
const missing = [];

for (const [type, source] of Object.entries(MAP)) {
  const slug = type.replace(".", "-");
  let svg;

  if (source.pack === "aws") {
    const file = `${source.file}.svg`;
    if (!awsFiles.has(file)) {
      missing.push(`${type} → aws/${file}`);
      continue;
    }
    svg = await readFile(path.join(awsDir, file), "utf8");
  } else {
    const file = path.join(simpleRoot, "icons", `${source.file}.svg`);
    try {
      svg = await readFile(file, "utf8");
    } catch {
      missing.push(`${type} → simple-icons/${source.file}.svg`);
      continue;
    }

    const color = colors.get(source.file);
    if (!color) {
      missing.push(`${type} → cor de marca de ${source.file}`);
      continue;
    }
    // Monocromático por padrão; pinta com a cor da marca.
    svg = svg.replace("<svg ", `<svg fill="${color}" `);
  }

  await writeFile(path.join(OUT, `${slug}.svg`), svg.trim() + "\n");
  written += 1;
}

if (missing.length > 0) {
  console.error("Não encontrado:\n  " + missing.join("\n  "));
  process.exit(1);
}

console.log(`${written} ícones gerados em public/icons/`);
