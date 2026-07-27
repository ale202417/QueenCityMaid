import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { newDb } from "pg-mem";
import { createApp } from "./app.js";
import { migrate } from "./db.js";
import { seed } from "./seed-data.js";

const memory = newDb({ autoCreateForeignKeyIndices: true, noAstCoverageCheck: true });
memory.public.registerFunction({ name: "now", returns: "timestamptz", implementation: () => new Date() });
memory.public.registerFunction({ name: "gen_random_uuid", returns: "uuid", implementation: () => crypto.randomUUID() });
const adapter = memory.adapters.createPg();
const pool = new adapter.Pool();

await migrate(pool);
await seed(pool, { password: "manager123!" });

const port = Number(process.env.PORT || 4010);
const distDir = fileURLToPath(new URL("../../dist/", import.meta.url));
const server = createApp({
  pool,
  secureCookies: false,
  staticDir: existsSync(distDir) ? distDir : undefined
}).listen(port, () => {
  console.log(`Development API listening on http://127.0.0.1:${port}`);
  console.log("Login: manager@queencitymaid.local / manager123!");
});

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
