import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.ts";

/**
 * Cliente do banco, compartilhado pela API e pelo worker.
 *
 * O §51 separa quem atende requisição de quem executa OpenTofu, mas os
 * dois gravam o mesmo estado: o resultado de uma execução precisa sobreviver ao
 * processo que a rodou. Um schema só e um cliente só evitam que as duas visões
 * do banco divirjam.
 *
 * No Prisma 7 a conexão passa por um driver adapter — a URL não vive mais no
 * schema (ver `prisma.config.ts`).
 */
export function createDb(connectionString: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      /**
       * Teto de conexões por processo.
       *
       * O padrão do pool cresce com o número de núcleos, e são vários
       * processos falando com o mesmo Postgres — API, worker e cada arquivo de
       * teste. Sem teto, a suíte inteira esbarra no `max_connections` e falha
       * por motivo que não tem nada a ver com o que está sendo testado.
       */
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    }),
  });
}

export type Db = PrismaClient;
