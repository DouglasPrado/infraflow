import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.ts";
import { env } from "./env.ts";

/**
 * No Prisma 7 a conexão passa por um driver adapter — a URL não vive mais no
 * schema (ver `prisma.config.ts`).
 */
const adapter = new PrismaPg({ connectionString: env.databaseUrl });

export const db = new PrismaClient({ adapter });

export type Db = typeof db;
