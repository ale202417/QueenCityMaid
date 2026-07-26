import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { createHttpSmsSender, sendDueNotifications } from "./communications.js";
import { createMigrationPool, createPool, migrate } from "./db.js";

if (process.env.RUN_MIGRATIONS_ON_START !== "false") {
  const migrationPool = createMigrationPool();
  await migrate(migrationPool);
  await migrationPool.end();
}
const pool = createPool();

const port = Number(process.env.PORT || 4010);
const host = process.env.HOST || "127.0.0.1";
const distDir = fileURLToPath(new URL("../../dist/", import.meta.url));
const server = createApp({
  pool,
  staticDir: existsSync(distDir) ? distDir : undefined
}).listen(port, host, () => {
  console.log(`Queen City Maid API listening on http://${host}:${port}`);
});
const smsSender = createHttpSmsSender();
const notificationTimer = setInterval(() => {
  sendDueNotifications(pool, smsSender).catch((error) => {
    console.error("Notification worker failed", error);
  });
}, 60_000);
notificationTimer.unref();

async function shutdown() {
  clearInterval(notificationTimer);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
