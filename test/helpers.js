import crypto from "node:crypto";
import { newDb } from "pg-mem";
import { migrate } from "../src/server/db.js";

export async function testPool() {
  const memory = newDb({ autoCreateForeignKeyIndices: true, noAstCoverageCheck: true });
  memory.public.registerFunction({ name: "now", returns: "timestamptz", implementation: () => new Date() });
  memory.public.registerFunction({ name: "gen_random_uuid", returns: "uuid", implementation: () => crypto.randomUUID() });
  const adapter = memory.adapters.createPg();
  const pool = new adapter.Pool();
  await migrate(pool);
  return pool;
}
