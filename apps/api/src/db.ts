import { createDb } from "@infraflow/db";
import { env } from "./env.ts";

/** Instância da API. O worker cria a sua — são processos distintos (§51). */
export const db = createDb(env.databaseUrl);
