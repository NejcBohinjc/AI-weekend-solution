import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// One connection pool per server instance, shared by everything in it (pages, actions, routes, middleware
// and, in dev, hot reloads), so a request never opens a connection when an idle one exists.
const globalForDb = globalThis as unknown as { sql?: ReturnType<typeof postgres> };
const sql =
  globalForDb.sql ??
  postgres(process.env.DATABASE_URL!, {
    // Small: Supabase's pooler (Supavisor, transaction mode) multiplexes these onto a few real connections,
    // and every function instance has its own pool.
    max: 5,
    // The transaction pooler does not support prepared statements.
    prepare: false,
    // Serverless instances are frozen between requests: drop idle connections before the pooler does,
    // instead of finding a dead one on the next request. A cold connection costs one TLS + auth handshake.
    idle_timeout: 20,
    connect_timeout: 10,
  });
globalForDb.sql = sql;

export const db = drizzle(sql, { schema });

/** Closes the pool, so scripts and tests can exit. */
export function closeDb(): Promise<void> {
  return sql.end();
}
