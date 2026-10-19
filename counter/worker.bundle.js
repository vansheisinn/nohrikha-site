// core.ts
var SOURCES = [
  "direct",
  "google",
  "yandex",
  "bing",
  "telegram",
  "whatsapp",
  "social",
  "other"
];
var ORIGIN = "https://nohrikha.com";
var TOKEN_TTL = 9e4;
var WINDOW_MS = 6e4;
var WINDOW_REQUESTS = 180;
var MAX_TOKENS = 1024;
var NO_STORE = { "Cache-Control": "no-store" };
var dayFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Moscow",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});
function dayAt(now) {
  return dayFormat.format(now);
}
function emptyDay() {
  return {
    views: 0,
    browsers: 0,
    sources: Object.fromEntries(
      SOURCES.map((source) => [source, 0])
    )
  };
}
function shiftedDay(day, offset) {
  return new Date(Date.parse(day + "T12:00:00Z") + offset * 864e5).toISOString().slice(0, 10);
}
function encode(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function decode(text) {
  return Uint8Array.from(
    atob(text.replaceAll("-", "+").replaceAll("_", "/")),
    (char) => char.charCodeAt(0)
  );
}
async function createCounter(store, secret, options = {}) {
  if (new TextEncoder().encode(secret).byteLength < 32) {
    throw new Error("COUNTER_SIGNING_KEY must contain at least 32 bytes");
  }
  const now = options.now ?? Date.now;
  const maxDailyViews = options.maxDailyViews ?? 5e3;
  if (!Number.isSafeInteger(maxDailyViews) || maxDailyViews < 1 || maxDailyViews > 1e5) {
    throw new Error("MAX_DAILY_VIEWS must be an integer from 1 to 100000");
  }
  const signer = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  const usedTokens = /* @__PURE__ */ new Map();
  let windowStart = now();
  let windowRequests = 0;
  let cachedStats;
  let pendingStats;
  function budget() {
    if (now() - windowStart >= WINDOW_MS) {
      windowStart = now();
      windowRequests = 0;
    }
    return ++windowRequests <= WINDOW_REQUESTS;
  }
  function json(data, status = 200, cache = NO_STORE) {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": ORIGIN,
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow",
        ...cache
      }
    });
  }
  async function challenge() {
    const time = now();
    const day = dayAt(time);
    const payload = encode(new TextEncoder().encode(
      JSON.stringify([day, time + TOKEN_TTL, crypto.randomUUID()])
    ));
    const signature = encode(
      new Uint8Array(
        await crypto.subtle.sign(
          "HMAC",
          signer,
          new TextEncoder().encode(payload)
        )
      )
    );
    return json({ day, token: payload + "." + signature });
  }
  async function verify(token) {
    if (!/^[A-Za-z0-9_-]{50,200}\.[A-Za-z0-9_-]{43}$/.test(token)) return false;
    const [payload, signature] = token.split(".");
    if (!await crypto.subtle.verify(
      "HMAC",
      signer,
      decode(signature),
      new TextEncoder().encode(payload)
    )) return false;
    const [day, expires, nonce] = JSON.parse(
      new TextDecoder().decode(decode(payload))
    );
    return day === dayAt(now()) && Number.isSafeInteger(expires) && expires > now() && expires <= now() + TOKEN_TTL && typeof nonce === "string";
  }
  async function readBody(request) {
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "text/plain") {
      throw new Error("Use text/plain JSON");
    }
    if (Number(request.headers.get("content-length") ?? 0) > 512 || !request.body) {
      throw new Error("Body too large or missing");
    }
    const reader = request.body.getReader();
    const chunks = [];
    let length = 0;
    let expired = false;
    const timeout = setTimeout(() => {
      expired = true;
      void reader.cancel().catch(() => {
      });
    }, 2e3);
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 512) {
          await reader.cancel();
          throw new Error("Body too large");
        }
        chunks.push(value);
      }
    } finally {
      clearTimeout(timeout);
      reader.releaseLock();
    }
    if (expired) throw new Error("Body timeout");
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  async function collect(request) {
    let body;
    try {
      const value = await readBody(request);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return json({ error: "invalid request" }, 400);
      }
      const fields = value;
      if (Object.keys(fields).sort().join(",") !== "first,source,token" || typeof fields.token !== "string" || typeof fields.first !== "boolean" || typeof fields.source !== "string" || !SOURCES.includes(fields.source) || !await verify(fields.token)) return json({ error: "invalid request" }, 400);
      body = {
        token: fields.token,
        first: fields.first,
        source: fields.source
      };
    } catch {
      return json({ error: "invalid request" }, 400);
    }
    const time = now();
    for (const [token, until] of usedTokens) {
      if (until <= time) usedTokens.delete(token);
    }
    if (usedTokens.has(body.token)) {
      return json({ accepted: false, duplicate: true });
    }
    if (usedTokens.size >= MAX_TOKENS) return json({ error: "busy" }, 429);
    usedTokens.set(body.token, time + TOKEN_TTL);
    const day = dayAt(time);
    const accepted = await store.increment(day, body.first, body.source, maxDailyViews);
    return accepted ? json({ accepted: true }) : json({ error: "daily limit" }, 429);
  }
  async function stats() {
    const day = dayAt(now());
    if (cachedStats && cachedStats.day === day && cachedStats.until > now()) {
      return cachedStats.value;
    }
    if (pendingStats) return pendingStats;
    pendingStats = (async () => {
      const from = shiftedDay(day, -29);
      const days = /* @__PURE__ */ new Map();
      for (let offset = -29; offset <= 0; offset++) {
        days.set(shiftedDay(day, offset), emptyDay());
      }
      for (const entry of await store.recent(from, day)) {
        days.set(entry.date, entry);
      }
      const sources = emptyDay().sources;
      for (const value2 of days.values()) {
        for (const source of SOURCES) sources[source] += value2.sources[source];
      }
      const total = await store.total();
      const value = {
        day,
        today: days.get(day),
        totalViews: total,
        days: [...days].slice(-7).map(([date, count]) => ({
          date,
          views: count.views,
          browsers: count.browsers
        })),
        sources,
        capped: (days.get(day)?.views ?? 0) >= maxDailyViews
      };
      cachedStats = { day, until: now() + 3e4, value };
      return value;
    })();
    try {
      return await pendingStats;
    } finally {
      pendingStats = void 0;
    }
  }
  return async function handler(request) {
    const url = new URL(request.url);
    if (url.search) return json({ error: "unknown route" }, 404);
    if (request.method === "OPTIONS") {
      if (request.headers.get("origin") !== ORIGIN || url.pathname !== "/collect") {
        return json({ error: "origin" }, 403);
      }
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": ORIGIN,
          "Access-Control-Allow-Methods": "POST",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "3600",
          ...NO_STORE
        }
      });
    }
    if (request.method === "GET" && url.pathname === "/stats") {
      try {
        return json(await stats(), 200, {
          "Cache-Control": "public, max-age=30"
        });
      } catch {
        return json({ error: "temporarily unavailable" }, 503);
      }
    }
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true });
    }
    if (request.headers.get("origin") !== ORIGIN) {
      return json({ error: "origin" }, 403);
    }
    if (url.pathname !== "/challenge" && url.pathname !== "/collect") {
      return json({ error: "unknown route" }, 404);
    }
    if (!budget()) return json({ error: "rate limit" }, 429);
    try {
      if (request.method === "GET" && url.pathname === "/challenge") {
        return await challenge();
      }
      if (request.method === "POST" && url.pathname === "/collect") {
        return await collect(request);
      }
      return json({ error: "method" }, 405);
    } catch {
      return json({ error: "temporarily unavailable" }, 503);
    }
  };
}

// schema.ts
var schema = `-- Aggregates only: one row per Moscow date, numeric counts, no visitor records.
CREATE TABLE IF NOT EXISTS totals (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  views INTEGER NOT NULL DEFAULT 0 CHECK (views >= 0)
);
-- statement-break
INSERT OR IGNORE INTO totals (id, views) VALUES (1, 0);
-- statement-break
CREATE TABLE IF NOT EXISTS daily (
  date TEXT PRIMARY KEY NOT NULL,
  views INTEGER NOT NULL DEFAULT 0 CHECK (views >= 0),
  browsers INTEGER NOT NULL DEFAULT 0 CHECK (browsers >= 0 AND browsers <= views),
  direct INTEGER NOT NULL DEFAULT 0 CHECK (direct >= 0),
  google INTEGER NOT NULL DEFAULT 0 CHECK (google >= 0),
  yandex INTEGER NOT NULL DEFAULT 0 CHECK (yandex >= 0),
  bing INTEGER NOT NULL DEFAULT 0 CHECK (bing >= 0),
  telegram INTEGER NOT NULL DEFAULT 0 CHECK (telegram >= 0),
  whatsapp INTEGER NOT NULL DEFAULT 0 CHECK (whatsapp >= 0),
  social INTEGER NOT NULL DEFAULT 0 CHECK (social >= 0),
  other INTEGER NOT NULL DEFAULT 0 CHECK (other >= 0),
  CHECK (browsers = direct + google + yandex + bing + telegram + whatsapp + social + other)
);
-- statement-break
CREATE TRIGGER IF NOT EXISTS daily_insert AFTER INSERT ON daily
BEGIN
  UPDATE totals SET views = views + NEW.views WHERE id = 1;
END;
-- statement-break
CREATE TRIGGER IF NOT EXISTS daily_update AFTER UPDATE OF views ON daily
BEGIN
  UPDATE totals SET views = views + NEW.views - OLD.views WHERE id = 1;
END;
`;

// worker.ts
function d1Store(db) {
  const columns = SOURCES.join(", ");
  const increments = SOURCES.map((name) => `${name} = daily.${name} + excluded.${name}`).join(", ");
  const incrementSql = `INSERT INTO daily (date, views, browsers, ${columns})
    VALUES (?, 1, ?, ${SOURCES.map(() => "?").join(", ")})
    ON CONFLICT(date) DO UPDATE SET views = daily.views + 1,
    browsers = daily.browsers + excluded.browsers, ${increments}
    WHERE daily.views < ?`;
  return {
    async increment(day, first, source, limit) {
      const result = await db.prepare(incrementSql).bind(
        day,
        first ? 1 : 0,
        ...SOURCES.map((name) => first && name === source ? 1 : 0),
        limit
      ).run();
      if (!result.success) throw new Error("storage unavailable");
      return result.meta.changes > 0;
    },
    async recent(from, to) {
      const result = await db.prepare(
        `SELECT date, views, browsers, ${columns} FROM daily WHERE date >= ? AND date <= ? ORDER BY date`
      ).bind(from, to).all();
      if (!result.success) throw new Error("storage unavailable");
      return result.results.map((row) => ({
        date: row.date,
        views: row.views,
        browsers: row.browsers,
        sources: Object.fromEntries(SOURCES.map((name) => [name, row[name]]))
      }));
    },
    async total() {
      const row = await db.prepare("SELECT views FROM totals WHERE id = 1").first();
      if (!row || !Number.isSafeInteger(row.views)) throw new Error("storage unavailable");
      return row.views;
    }
  };
}
var current;
var worker_default = {
  async fetch(request, env) {
    try {
      if (!env.DB || !env.COUNTER_SIGNING_KEY || new TextEncoder().encode(env.COUNTER_SIGNING_KEY).byteLength < 32) throw new Error("not configured");
      if (!current || current.db !== env.DB || current.secret !== env.COUNTER_SIGNING_KEY || current.limit !== env.MAX_DAILY_VIEWS) {
        const app = (async () => {
          await env.DB.batch(schema.split("-- statement-break").map((sql) => env.DB.prepare(sql)));
          return await createCounter(d1Store(env.DB), env.COUNTER_SIGNING_KEY, {
            maxDailyViews: Number(env.MAX_DAILY_VIEWS ?? "5000")
          });
        })();
        current = { db: env.DB, secret: env.COUNTER_SIGNING_KEY, limit: env.MAX_DAILY_VIEWS, app };
      }
      return await (await current.app)(request);
    } catch {
      current = void 0;
      return new Response('{"error":"temporarily unavailable"}', { status: 503, headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "https://nohrikha.com",
        "X-Robots-Tag": "noindex, nofollow"
      } });
    }
  }
};
export {
  d1Store,
  worker_default as default
};
