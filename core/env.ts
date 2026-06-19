// Resolves DATABASE_URL from individual INIT_COMMON_MASTER_* variables when a full
// DATABASE_URL isn't provided. Prisma and pg-boss need a connection string, so we
// assemble one. Imported FIRST by db.ts / queue.ts / worker so the URL exists before
// Prisma client or pg-boss are constructed.
//
// Recognised vars (DATABASE_URL takes precedence if set):
//   INIT_COMMON_MASTER_HOST       e.g. tramway.proxy.rlwy.net  (or postgres.railway.internal)
//   INIT_COMMON_MASTER_PORT       e.g. 42337 for the public proxy, 5432 for the internal host
//   INIT_COMMON_MASTER_USER       e.g. postgres
//   INIT_COMMON_MASTER_PASSWORD
//   INIT_COMMON_MASTER_DATABASE   e.g. railway
//   INIT_COMMON_MASTER_PARAMS     optional query string, e.g. ?connection_limit=5&pool_timeout=20
function buildFromInitVars(): string | undefined {
  const host = process.env.INIT_COMMON_MASTER_HOST;
  const user = process.env.INIT_COMMON_MASTER_USER;
  const password = process.env.INIT_COMMON_MASTER_PASSWORD;
  const database = process.env.INIT_COMMON_MASTER_DATABASE;
  if (!host || !user || !password || !database) return undefined;

  const port = process.env.INIT_COMMON_MASTER_PORT ?? "5432";
  const params = process.env.INIT_COMMON_MASTER_PARAMS ?? "";
  const u = encodeURIComponent(user);
  const p = encodeURIComponent(password);
  return `postgresql://${u}:${p}@${host}:${port}/${database}${params}`;
}

if (!process.env.DATABASE_URL) {
  const url = buildFromInitVars();
  if (url) process.env.DATABASE_URL = url;
}

export {};
