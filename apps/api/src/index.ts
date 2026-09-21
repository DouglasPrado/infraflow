import { buildApp } from "./app.ts";
import { env } from "./env.ts";

const app = await buildApp();

try {
  await app.listen({ port: env.port, host: env.host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
