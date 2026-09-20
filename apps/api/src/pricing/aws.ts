import { GetProductsCommand, PricingClient } from "@aws-sdk/client-pricing";
import { getCatalogItem, monthlyCostFor } from "@infraflow/registry";
import { isResourceNode, type ArchitectureDocument } from "@infraflow/schema";
import { isPriceable, planFor, type SkuQuery } from "./skus.ts";

/**
 * Preço de tabela da AWS (PRD §40).
 *
 * Substitui o palpite do registry pelo que a Price List API responde para a
 * configuração desenhada. É uma **terceira leitura**, distinta das do §85:
 * `Estimated` é palpite do catálogo, `Priced` é tabela pública da AWS. Nenhuma
 * das duas é `Observed` — nem a AWS sabe o que você vai consumir.
 *
 * A consulta usa a credencial do projeto, nunca a da máquina (§52).
 */

export interface AwsCredential {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

export type CostSource = "priced" | "estimated";

export interface PricePart {
  label: string;
  monthlyUsd: number;
  /** `usagetype` do SKU que deu este número — é a prova de onde veio. */
  sku: string;
  unitUsd: number;
}

export interface NodePrice {
  nodeId: string;
  name: string;
  type: string;
  monthlyUsd: number;
  source: CostSource;
  /** Composição do valor, quando veio de tabela. */
  breakdown?: PricePart[];
  /** Por que caiu para estimativa. */
  reason?: string;
}

export interface ArchitecturePricing {
  region: string;
  currency: "USD";
  monthlyUsd: number;
  /** Soma só do que veio de tabela — o resto continua palpite. */
  pricedMonthlyUsd: number;
  nodes: NodePrice[];
  /** Quando a tabela foi consultada. */
  at: string;
}

/** A Price List API só atende em algumas regiões; a tabela cobre todas. */
const PRICING_ENDPOINT_REGION = "us-east-1";

/** Preço de tabela muda raramente; consultar a cada tela seria desperdício. */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const cache = new Map<string, { unitUsd: number | null; sku: string; at: number }>();

interface PriceListEntry {
  product?: { attributes?: { usagetype?: string } };
  terms?: {
    OnDemand?: Record<
      string,
      { priceDimensions?: Record<string, { pricePerUnit?: { USD?: string } }> }
    >;
  };
}

/** Preço unitário on-demand em USD, ou `null` quando o SKU não existe. */
async function unitPrice(
  client: PricingClient,
  query: SkuQuery,
): Promise<{ unitUsd: number | null; sku: string }> {
  const marker = query.usageTypeContains;
  const key = `${query.serviceCode}:${JSON.stringify(query.filters)}:${marker ?? ""}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { unitUsd: cached.unitUsd, sku: cached.sku };
  }

  const response = await client.send(
    new GetProductsCommand({
      ServiceCode: query.serviceCode,
      // Vários SKUs casam com o mesmo filtro; o desempate é abaixo.
      MaxResults: marker ? 100 : 1,
      Filters: Object.entries(query.filters).map(([Field, Value]) => ({
        Type: "TERM_MATCH",
        Field,
        Value,
      })),
    }),
  );

  /**
   * O SDK devolve o item ora como string, ora como um objeto indexado por
   * caractere cujo `toString()` é o JSON. `String()` cobre os dois — checar
   * por `typeof === "string"` descartava silenciosamente toda a tabela.
   */
  const list: unknown[] = (response.PriceList ?? []) as unknown[];
  const entries: PriceListEntry[] = list.map(
    (raw): PriceListEntry => JSON.parse(String(raw)) as PriceListEntry,
  );

  const excludes = query.usageTypeExcludes ?? [];
  const chosen = marker
    ? entries.find((entry: PriceListEntry) => {
        const usageType = entry.product?.attributes?.usagetype ?? "";
        return usageType.includes(marker) && !excludes.some((bad) => usageType.includes(bad));
      })
    : entries[0];

  let unitUsd: number | null = null;
  if (chosen) {
    // Só on-demand: Reserved e Savings Plans dependem de compromisso que o
    // canvas não declara.
    const terms = Object.values(chosen.terms?.OnDemand ?? {});
    const dimension = Object.values(terms[0]?.priceDimensions ?? {})[0];
    const price = Number(dimension?.pricePerUnit?.USD);
    if (Number.isFinite(price)) unitUsd = price;
  }

  const sku = chosen?.product?.attributes?.usagetype ?? "";
  cache.set(key, { unitUsd, sku, at: Date.now() });
  return { unitUsd, sku };
}

export async function priceArchitecture(
  document: ArchitectureDocument,
  credential: AwsCredential,
): Promise<ArchitecturePricing> {
  const client = new PricingClient({
    region: PRICING_ENDPOINT_REGION,
    credentials: {
      accessKeyId: credential.accessKeyId,
      secretAccessKey: credential.secretAccessKey,
    },
  });

  const nodes: NodePrice[] = [];

  for (const node of document.nodes) {
    if (!isResourceNode(node)) continue;
    const item = getCatalogItem(node.type);
    if (!item) continue;

    /** O palpite do registry, que continua valendo quando não há tabela. */
    const estimated: NodePrice = {
      nodeId: node.id,
      name: node.name,
      type: node.type,
      monthlyUsd: monthlyCostFor(item, node.properties),
      source: "estimated",
    };

    const plan = planFor(node.type, node.properties, credential.region);
    if (!isPriceable(plan)) {
      nodes.push({ ...estimated, reason: plan.reason });
      continue;
    }

    const breakdown: PricePart[] = [];
    let complete = true;

    for (const query of plan.queries) {
      const found = await unitPrice(client, query).catch(() => ({ unitUsd: null, sku: "" }));
      if (found.unitUsd === null) {
        complete = false;
        break;
      }
      breakdown.push({
        label: query.label,
        monthlyUsd: found.unitUsd * query.quantity,
        unitUsd: found.unitUsd,
        sku: found.sku,
      });
    }

    // Tabela incompleta vira estimativa inteira: metade de um preço não é preço.
    if (!complete) {
      nodes.push({
        ...estimated,
        reason: "A tabela da AWS não respondeu para esta configuração.",
      });
      continue;
    }

    nodes.push({
      nodeId: node.id,
      name: node.name,
      type: node.type,
      monthlyUsd: breakdown.reduce((sum, part) => sum + part.monthlyUsd, 0),
      source: "priced",
      breakdown,
    });
  }

  return {
    region: credential.region,
    currency: "USD",
    monthlyUsd: nodes.reduce((sum, node) => sum + node.monthlyUsd, 0),
    pricedMonthlyUsd: nodes
      .filter((node) => node.source === "priced")
      .reduce((sum, node) => sum + node.monthlyUsd, 0),
    nodes,
    at: new Date().toISOString(),
  };
}
