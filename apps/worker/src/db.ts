import { createDb } from "@infraflow/db";
import { env } from "./env.ts";

/** Instância do worker. A API tem a sua — são processos distintos (§51). */
export const db = createDb(env.databaseUrl);
