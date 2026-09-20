import { getCatalogItem } from "@infraflow/registry";
import { isResourceNode, type ArchitectureDocument } from "@infraflow/schema";
import {
  block,
  list,
  num,
  obj,
  ref,
  str,
  type TofuBlock,
  type TofuFile,
} from "@infraflow/opentofu-generator";
import { projectSlug, uniqueIdentifiers } from "../names.ts";
import type { CompiledStack, CompileWarning, EmittedFile } from "../types.ts";
import { ingressFromGroup, ingressFromInternet, networkBlocks } from "./network.ts";
import { AWS_EMITTERS, sharedVariables, type Emission } from "./resources.ts";

/**
 * Grafo → OpenTofu para AWS (PRD §74).
 *
 * A parte que só o canvas sabe fazer é a fiação: **a conexão do desenho vira
 * regra de grupo de segurança**. Um ALB ligado a um ECS abre a porta da
 * aplicação só para o balanceador; um ECS ligado a um RDS abre a 5432 só para
 * aquele serviço. Nada fica aberto porque "é mais fácil".
 */
export function compileAws(document: ArchitectureDocument): CompiledStack {
  const resources = document.nodes.filter(isResourceNode);
  const names = uniqueIdentifiers(resources.map((node) => ({ id: node.id, name: node.name })));
  const network = networkBlocks();

  const warnings: CompileWarning[] = [
    {
      code: "assumption",
      message: "A VPC sai sem NAT Gateway.",
      hint: "Compute fica em sub-rede pública com IP público; banco e cache ficam no privado.",
    },
  ];

  const emissions = new Map<string, Emission>();
  const compiledNodeIds: string[] = [];

  for (const node of resources) {
    const emitter = AWS_EMITTERS[node.type];
    const name = names.get(node.id);
    if (!name) continue;

    if (!emitter) {
      const alternative = getCatalogItem(node.type)?.alternative;
      warnings.push({
        code: "unsupported-resource",
        nodeId: node.id,
        message: `${getCatalogItem(node.type)?.title ?? node.type} "${node.name}" não tem equivalente no alvo AWS deste milestone.`,
        hint: alternative
          ? `Troque pelo equivalente do registry: ${getCatalogItem(alternative)?.title ?? alternative} (PRD §29).`
          : "O §74 cobre VPC, ALB, ECS, RDS, S3 e Redis.",
      });
      continue;
    }

    const emission = emitter({ node, name, network });
    emissions.set(node.id, emission);
    compiledNodeIds.push(node.id);
    warnings.push(...emission.warnings);
  }

  const wiring: TofuBlock[] = [];

  // --- porta de entrada: quem é público aceita a internet nas portas do listener
  for (const [nodeId, emission] of emissions) {
    const name = names.get(nodeId);
    if (!name || !emission.securityGroup) continue;

    for (const port of emission.publicPorts ?? []) {
      wiring.push(
        ingressFromInternet(
          `${name}_public_${port}`,
          emission.securityGroup,
          num(port),
          `Entrada publica na porta ${port}`,
        ),
      );
    }
  }

  // --- cada conexão do canvas vira uma regra
  for (const edge of document.edges) {
    const source = emissions.get(edge.source);
    const target = emissions.get(edge.target);
    const sourceName = names.get(edge.source);
    const targetName = names.get(edge.target);
    if (!source?.securityGroup || !target?.securityGroup || !sourceName || !targetName) continue;

    // Balanceador → serviço: o serviço se registra no grupo de destino e só
    // aceita conexão vinda do balanceador.
    if (source.targetGroup && target.main?.labels[0] === "aws_ecs_service") {
      target.main.blocks.push(
        block("load_balancer", [], [
          ["target_group_arn", ref(`${source.targetGroup.labels.join(".")}.arn`)],
          ["container_name", str(targetName.replaceAll("_", "-"))],
          ["container_port", ref("var.container_port")],
        ]),
      );
      if (source.listener) {
        target.main.attributes.push([
          "depends_on",
          list([ref(source.listener.labels.join("."))]),
        ]);
      }

      wiring.push(
        ingressFromGroup(
          `${targetName}_from_${sourceName}`,
          target.securityGroup,
          source.securityGroup,
          ref("var.container_port"),
          `Trafego vindo de ${sourceName}`,
        ),
      );
      continue;
    }

    if (target.listenPort === undefined) continue;

    wiring.push(
      ingressFromGroup(
        `${targetName}_from_${sourceName}`,
        target.securityGroup,
        source.securityGroup,
        num(target.listenPort),
        `Trafego vindo de ${sourceName}`,
      ),
    );
  }

  const shared = sharedVariables();
  const emitted = [...emissions.values()];

  const providers: TofuFile = {
    name: "providers.tf",
    header: [
      "Gerado pelo InfraFlow a partir do architecture.json (PRD §33, §74).",
      "Editar aqui significa divergir do canvas: mexa no desenho e recompile.",
    ],
    blocks: [
      block(
        "terraform",
        [],
        [["required_version", str(">= 1.6")]],
        [
          block("required_providers", [], [
            [
              "aws",
              obj([
                ["source", str("hashicorp/aws")],
                ["version", str("~> 6.0")],
              ]),
            ],
          ]),
        ],
      ),
      block(
        "provider",
        ["aws"],
        [["region", ref("var.region")]],
        [
          block("default_tags", [], [
            [
              "tags",
              obj([
                ["Project", ref("var.project")],
                ["Environment", ref("var.environment")],
                ["ManagedBy", str("InfraFlow")],
              ]),
            ],
          ]),
        ],
      ),
    ],
  };

  const main: TofuFile = {
    name: "main.tf",
    header: [`Arquitetura: ${document.name} (${document.environment}).`],
    blocks: [...network.blocks, ...emitted.flatMap((emission) => emission.blocks), ...wiring],
  };

  const variables: TofuFile = {
    name: "variables.tf",
    blocks: [...shared.variables, ...emitted.flatMap((emission) => emission.variables)],
  };

  const outputs: TofuFile = {
    name: "outputs.tf",
    blocks: emitted.flatMap((emission) => emission.outputs),
  };

  return {
    target: "aws",
    files: [providers, main, variables, outputs],
    compiledNodeIds,
    warnings,
  };
}

/** O `terraform.tfvars.example` do §34 — não é HCL de bloco, é chave/valor. */
export function awsTfvarsExample(document: ArchitectureDocument): EmittedFile {
  const project = document.name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);

  return {
    name: "terraform.tfvars.example",
    content: [
      "# Copie para terraform.tfvars e ajuste antes do apply.",
      "",
      `region      = "us-east-1"`,
      `project     = "${project}"`,
      `environment = "${document.environment}"`,
      `vpc_cidr    = "10.20.0.0/16"`,
      "",
      "# Imagem publicada da aplicacao. O padrao sobe um nginx que responde 200,",
      "# suficiente para plan e para o laboratorio; troque pela sua imagem.",
      `container_image = "public.ecr.aws/nginx/nginx:stable"`,
      `container_port  = 80`,
      "",
      "# Obrigatorio quando houver listener HTTPS.",
      `# certificate_arn = "arn:aws:acm:us-east-1:000000000000:certificate/..."`,
      "",
    ].join("\n"),
  };
}
