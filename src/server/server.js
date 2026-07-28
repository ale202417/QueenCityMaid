import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { runDueAutomations } from "./automation.js";
import { createSmsSender, sendDueNotifications } from "./communications.js";
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
const smsSender = createSmsSender();
const server = createApp({
  pool,
  staticDir: existsSync(distDir) ? distDir : undefined,
  smsSender
}).listen(port, host, () => {
  console.log(`Queen City Maid API listening on http://${host}:${port}`);
});
const notificationTimer = setInterval(() => {
  sendDueNotifications(pool, smsSender).catch((error) => {
    console.error("Notification worker failed", error);
  });
}, 60_000);
notificationTimer.unref();
async function runAutomationWorker() {
  try {
    await runDueAutomations(pool);
  } catch (error) {
    console.error("Daily automation worker failed", error);
  }
}
if (process.env.AUTOMATION_WORKER_ENABLED !== "false") {
  void runAutomationWorker();
}
const automationTimer = setInterval(() => {
  if (process.env.AUTOMATION_WORKER_ENABLED !== "false") {
    void runAutomationWorker();
  }
}, 5 * 60_000);
automationTimer.unref();

async function shutdown() {
  clearInterval(notificationTimer);
  clearInterval(automationTimer);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
