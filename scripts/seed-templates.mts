// Seeds the website-sales email templates into the DB. Idempotent (upsert).
// The worker also seeds on boot; this script is for seeding manually. Run: npm run seed
import "dotenv/config";
import { prisma } from "../core/db.js";
import { seedTemplates } from "../core/seed.js";

async function main() {
  const n = await seedTemplates();
  await prisma.$disconnect();
  console.log(`done — ${n} templates`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
