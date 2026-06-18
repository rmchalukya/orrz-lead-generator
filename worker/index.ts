// Background worker: drains the pg-boss queue and runs the pipeline. Deploy as one
// long-running process (Render/Railway free worker). See PLAN.md §3.
import { getBoss } from "../core/queue.js";
import { registerWorkers } from "../core/pipeline.js";

async function main() {
  const boss = await getBoss();
  await registerWorkers(boss);
  console.log("[worker] pipeline workers registered, draining queue…");
}

main().catch((err) => {
  console.error("[worker] fatal", err);
  process.exit(1);
});
