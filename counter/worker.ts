import { createCounter, SOURCES } from "./core.ts";
import type { CounterStore, Day, Source } from "./core.ts";
import { schema } from "./schema.ts";

type Row = { date: string; views: number; browsers: number } & Record<Source, number>;
export interface Env {
  DB: D1Database;
  COUNTER_SIGNING_KEY: string;
  MAX_DAILY_VIEWS?: string;
}

export function d1Store(db: D1Database): CounterStore {
  // All SQL names come from our fixed source list. Visitor values are bound.
  const columns = SOURCES.join(", ");
  const increments = SOURCES.map((name) => `${name} = daily.${name} + excluded.${name}`).join(", ");
  const incrementSql = `INSERT INTO daily (date, views, browsers, ${columns})
    VALUES (?, 1, ?, ${SOURCES.map(() => "?").join(", ")})
    ON CONFLICT(date) DO UPDATE SET views = daily.views + 1,
    browsers = daily.browsers + excluded.browsers, ${increments}
    WHERE daily.views < ?`;
  return {
    async increment(day, first, source, limit) {
      // D1 executes the UPSERT and totals trigger in one SQLite transaction.
      // The WHERE condition enforces one shared cap across isolates/regions.
      const result = await db.prepare(incrementSql).bind(day, first ? 1 : 0,
        ...SOURCES.map((name) => first && name === source ? 1 : 0), limit).run();
      if (!result.success) throw new Error("storage unavailable");
      return result.meta.changes > 0;
    },
    async recent(from, to) {
      const result = await db.prepare(
        `SELECT date, views, browsers, ${columns} FROM daily WHERE date >= ? AND date <= ? ORDER BY date`,
      ).bind(from, to).all<Row>();
      if (!result.success) throw new Error("storage unavailable");
      return result.results.map((row): Day & { date: string } => ({
        date: row.date, views: row.views, browsers: row.browsers,
        sources: Object.fromEntries(SOURCES.map((name) => [name, row[name]])) as Day["sources"],
      }));
    },
    async total() {
      const row = await db.prepare("SELECT views FROM totals WHERE id = 1").first<{ views: number }>();
      if (!row || !Number.isSafeInteger(row.views)) throw new Error("storage unavailable");
      return row.views;
    },
  };
}

let current: { db: D1Database; secret: string; limit: string | undefined; app: ReturnType<typeof createCounter> } | undefined;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      if (!env.DB || !env.COUNTER_SIGNING_KEY || new TextEncoder().encode(env.COUNTER_SIGNING_KEY).byteLength < 32) throw new Error("not configured");
      if (!current || current.db !== env.DB || current.secret !== env.COUNTER_SIGNING_KEY || current.limit !== env.MAX_DAILY_VIEWS) {
        const app = (async () => {
          // Safe for a new database and repeated cold starts. The same batch is
          // atomic; IF NOT EXISTS / INSERT OR IGNORE never reset existing counts.
          await env.DB.batch(schema.split('-- statement-break').map(sql => env.DB.prepare(sql)));
          return await createCounter(d1Store(env.DB), env.COUNTER_SIGNING_KEY, {
            maxDailyViews: Number(env.MAX_DAILY_VIEWS ?? "5000"),
          });
        })();
        current = { db: env.DB, secret: env.COUNTER_SIGNING_KEY, limit: env.MAX_DAILY_VIEWS, app };
      }
      return await (await current.app)(request);
    } catch {
      current = undefined;
      return new Response('{"error":"temporarily unavailable"}', { status: 503, headers: {
        "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "https://nohrikha.com", "X-Robots-Tag": "noindex, nofollow",
      } });
    }
  },
};
