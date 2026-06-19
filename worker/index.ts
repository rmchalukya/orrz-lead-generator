// Background worker: drains the pg-boss queue and runs the pipeline. Deploy as one
// long-running process (Railway). See PLAN.md §3.
//
// The worker is a queue consumer, not a web app — but it also starts a minimal HTTP
// health endpoint so the platform has something to probe and its URL returns 200
// (instead of a confusing 502) when the process is alive.
import "../core/env.js"; // resolve DATABASE_URL from INIT_COMMON_MASTER_* if needed
import http from "node:http";
import { getBoss } from "../core/queue.js";
import { registerWorkers } from "../core/pipeline.js";
import { seedTemplates } from "../core/seed.js";

let dbConnected = false;

function startHealthServer() {
  const port = Number(process.env.PORT) || 8080;
  http
    .createServer((_req, res) => {
      res.writeHead(dbConnected ? 200 : 503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: dbConnected ? "ok" : "starting", role: "worker" }));
    })
    .listen(port, () => console.log(`[worker] health server on :${port}`));
}

async function main() {
  startHealthServer(); // up immediately, before the DB connects
  const boss = await getBoss();
  await registerWorkers(boss);
  const n = await seedTemplates();
  console.log(`[worker] seeded ${n} email templates`);
  dbConnected = true;
  console.log("[worker] pipeline workers registered, draining queue…");
}

main().catch((err) => {
  console.error("[worker] fatal", err);
  process.exit(1);
});
