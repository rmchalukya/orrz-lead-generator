// Runs `prisma migrate deploy` after resolving DATABASE_URL from the
// INIT_COMMON_MASTER_* vars (the Prisma CLI reads DATABASE_URL from the env, so it
// must be set before the CLI starts). Used by the `start:worker` deploy command.
import "../core/env.js";
import { execSync } from "node:child_process";

if (!process.env.DATABASE_URL) {
  console.error(
    "[migrate] No DATABASE_URL and INIT_COMMON_MASTER_* incomplete — cannot migrate.",
  );
  process.exit(1);
}

execSync("prisma migrate deploy", { stdio: "inherit", env: process.env });
