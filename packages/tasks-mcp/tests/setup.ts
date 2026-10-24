import type { Db } from "@lekman/dashboard-schema/db";

import { PGlite } from "@electric-sql/pglite";
import * as schema from "@lekman/dashboard-schema/db/schema";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { join } from "node:path";

import type { Context } from "../src/tasks.ts";

/** A migrated in-memory database with two clients and a workstream each. */
export async function fixture(
  now = "2026-10-24T09:00:00Z",
): Promise<Context & { pg: PGlite }> {
  const pg = new PGlite();
  await migrate(drizzle(pg), {
    migrationsFolder: join(
      import.meta.dir,
      "../../dashboard-schema/migrations",
    ),
  });
  const db = drizzle(pg, { schema }) as unknown as Db;
  await db.insert(schema.client).values([
    {
      id: "acme",
      classification: "client-confidential",
      boundary: "acme",
      name: "Acme",
    },
    {
      id: "globex",
      classification: "internal",
      boundary: "globex",
      name: "Globex",
    },
  ]);
  await db.insert(schema.workstream).values([
    {
      id: "acme-delivery",
      classification: "client-confidential",
      boundary: "acme",
      clientId: "acme",
      title: "Delivery",
    },
    {
      id: "globex-ops",
      classification: "internal",
      boundary: "globex",
      clientId: "globex",
      title: "Operations",
    },
  ]);
  let clock = new Date(now);
  return {
    pg,
    db,
    timeZone: "Europe/London",
    now: () => clock,
    // Tests move the clock by assigning through this setter.
    set at(value: string) {
      clock = new Date(value);
    },
  } as Context & { pg: PGlite };
}
