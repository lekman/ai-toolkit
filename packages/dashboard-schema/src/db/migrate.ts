/**
 * Apply the migrations to the database in DATABASE_URL.
 *
 *   DATABASE_URL=postgres://dashboard:<password>@127.0.0.1:5440/dashboard bun src/db/migrate.ts
 *
 * Safe to run repeatedly: Drizzle records what it has applied and skips it.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { join } from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "error: set DATABASE_URL, for example postgres://dashboard:<password>@127.0.0.1:5440/dashboard",
  );
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  await migrate(drizzle(sql), {
    migrationsFolder: join(import.meta.dir, "../../migrations"),
  });
  const [row] =
    await sql`SELECT count(*)::int AS applied FROM drizzle.__drizzle_migrations`;
  console.log(`migrations applied: ${row?.applied ?? 0}`);
} finally {
  await sql.end();
}
