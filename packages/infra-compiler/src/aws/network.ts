import {
  attributeOf,
  block,
  bool,
  data,
  interpolated,
  list,
  obj,
  ref,
  resource,
  str,
  type TofuBlock,
  type TofuValue,
} from "@infraflow/opentofu-generator";

/**
 * A VPC que o §74 lista como primeiro componente.
 *
 * Não vem de node nenhum: é o chão onde ALB, ECS, RDS e ElastiCache se apoiam.
 * Sem ela o compiler não teria sub-rede para entregar e nada validaria.
 *
 * Duas zonas, duas sub-redes públicas e duas privadas. **Sem NAT Gateway**: a
 * aplicação roda em sub-rede pública com IP público (padrão comum de Fargate
 * sem NAT) e dado fica no privado. É a decisão que mantém o laboratório barato
 * sem deixar banco exposto — e sai registrada como `assumption` no resultado.
 */
export interface NetworkRefs {
  blocks: TofuBlock[];
  vpcId: ReturnType<typeof attributeOf>;
  publicSubnetIds: ReturnType<typeof list>;
  privateSubnetIds: ReturnType<typeof list>;
}

const AZ_COUNT = 2;

export function networkBlocks(): NetworkRefs {
  const zones = data("aws_availability_zones", "available", [["state", str("available")]]);

  const vpc = resource("aws_vpc", "main", [
    ["cidr_block", ref("var.vpc_cidr")],
    ["enable_dns_support", bool(true)],
    ["enable_dns_hostnames", bool(true)],
    ["tags", obj([["Name", interpolated("${var.project}-vpc")]])],
  ]);

  const gateway = resource("aws_internet_gateway", "main", [
    ["vpc_id", attributeOf(vpc, "id")],
    ["tags", obj([["Name", interpolated("${var.project}-igw")]])],
  ]);

  const publicSubnets: TofuBlock[] = [];
  const privateSubnets: TofuBlock[] = [];

  for (let index = 0; index < AZ_COUNT; index += 1) {
    publicSubnets.push(
      resource("aws_subnet", `public_${index + 1}`, [
        ["vpc_id", attributeOf(vpc, "id")],
        ["cidr_block", ref(`cidrsubnet(var.vpc_cidr, 4, ${index})`)],
        ["availability_zone", ref(`data.aws_availability_zones.available.names[${index}]`)],
        ["map_public_ip_on_launch", bool(true)],
        ["tags", obj([["Name", interpolated(`\${var.project}-public-${index + 1}`)]])],
      ]),
    );

    privateSubnets.push(
      resource("aws_subnet", `private_${index + 1}`, [
        ["vpc_id", attributeOf(vpc, "id")],
        ["cidr_block", ref(`cidrsubnet(var.vpc_cidr, 4, ${index + AZ_COUNT})`)],
        ["availability_zone", ref(`data.aws_availability_zones.available.names[${index}]`)],
        ["tags", obj([["Name", interpolated(`\${var.project}-private-${index + 1}`)]])],
      ]),
    );
  }

  const publicRoutes = resource(
    "aws_route_table",
    "public",
    [
      ["vpc_id", attributeOf(vpc, "id")],
      ["tags", obj([["Name", interpolated("${var.project}-public")]])],
    ],
    [
      block("route", [], [
        ["cidr_block", str("0.0.0.0/0")],
        ["gateway_id", attributeOf(gateway, "id")],
      ]),
    ],
  );

  const associations = publicSubnets.map((subnet, index) =>
    resource("aws_route_table_association", `public_${index + 1}`, [
      ["subnet_id", attributeOf(subnet, "id")],
      ["route_table_id", attributeOf(publicRoutes, "id")],
    ]),
  );

  return {
    blocks: [zones, vpc, gateway, ...publicSubnets, ...privateSubnets, publicRoutes, ...associations],
    vpcId: attributeOf(vpc, "id"),
    publicSubnetIds: list(publicSubnets.map((subnet) => attributeOf(subnet, "id"))),
    privateSubnetIds: list(privateSubnets.map((subnet) => attributeOf(subnet, "id"))),
  };
}

/** Grupo de segurança vazio — as regras vêm das conexões do canvas. */
export function securityGroup(name: string, description: string, network: NetworkRefs): TofuBlock {
  return resource("aws_security_group", name, [
    ["name", interpolated(`\${var.project}-${name.replaceAll("_", "-")}`)],
    ["description", str(description)],
    ["vpc_id", network.vpcId],
    ["tags", obj([["Name", interpolated(`\${var.project}-${name.replaceAll("_", "-")}`)]])],
  ]);
}

/** Saída liberada: o recurso precisa alcançar registry, DNS e serviços da AWS. */
export function egressAll(name: string, group: TofuBlock): TofuBlock {
  return resource("aws_vpc_security_group_egress_rule", `${name}_all`, [
    ["security_group_id", attributeOf(group, "id")],
    ["cidr_ipv4", str("0.0.0.0/0")],
    ["ip_protocol", str("-1")],
    ["description", str("Saida liberada")],
  ]);
}

/**
 * Entrada vinda de outro grupo — a tradução de uma conexão do canvas.
 *
 * A porta é um valor, não um número: a porta da aplicação vem de variável, e
 * fixá-la aqui quebraria quem publica em outra.
 */
export function ingressFromGroup(
  name: string,
  target: TofuBlock,
  source: TofuBlock,
  port: TofuValue,
  description: string,
): TofuBlock {
  return resource("aws_vpc_security_group_ingress_rule", name, [
    ["security_group_id", attributeOf(target, "id")],
    ["referenced_security_group_id", attributeOf(source, "id")],
    ["from_port", port],
    ["to_port", port],
    ["ip_protocol", str("tcp")],
    ["description", str(description)],
  ]);
}

/** Entrada vinda da internet — só para quem é porta de entrada. */
export function ingressFromInternet(
  name: string,
  target: TofuBlock,
  port: TofuValue,
  description: string,
): TofuBlock {
  return resource("aws_vpc_security_group_ingress_rule", name, [
    ["security_group_id", attributeOf(target, "id")],
    ["cidr_ipv4", str("0.0.0.0/0")],
    ["from_port", port],
    ["to_port", port],
    ["ip_protocol", str("tcp")],
    ["description", str(description)],
  ]);
}
