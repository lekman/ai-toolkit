import type { Db } from "@lekman/dashboard-schema/db";

import * as schema from "@lekman/dashboard-schema/db/schema";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

/**
 * The database URL: DATABASE_URL when set, otherwise the Mac Mini's local
 * dashboard-db built from DASHBOARD_DB_PASSWORD (the deploy .env's name).
 */
export function databaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const password = env.DASHBOARD_DB_PASSWORD;
  if (!password) {
    throw new Error(
      "set DATABASE_URL, or DASHBOARD_DB_PASSWORD for the local dashboard-db",
    );
  }
  return `postgres://dashboard:${encodeURIComponent(password)}@127.0.0.1:5440/dashboard`;
}

/** A pooled connection, and a way to close it on shutdown. */
export function connect(url: string): { db: Db; close: () => Promise<void> } {
  const sql = postgres(url, { max: 5, onnotice: () => {} });
  return {
    db: drizzle(sql, { schema }) as unknown as Db,
    close: () => sql.end(),
  };
}
