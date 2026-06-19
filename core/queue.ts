import "./env.js"; // resolve DATABASE_URL before reading it below
import PgBoss from "pg-boss";

// pg-boss runs on the same Postgres as the app — no Redis. See PLAN.md §3.
let boss: PgBoss | null = null;

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  const connectionString =
    process.env.PGBOSS_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required for pg-boss");
  boss = new PgBoss({ connectionString });
  await boss.start();
  // pg-boss v10 requires queues to exist before send/work. Idempotent.
  for (const name of Object.values(JOBS)) await boss.createQueue(name);
  return boss;
}

// Job names — one per pipeline step. See PLAN.md §5.
export const JOBS = {
  discover: "discover",
  analyze: "analyze",
  score: "score",
  personalize: "personalize",
  buildSequence: "build-sequence",
  sendTouch: "send-touch",
  captureReply: "capture-reply",
} as const;

export type JobName = (typeof JOBS)[keyof typeof JOBS];
