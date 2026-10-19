/** Own aggregate counter. No request logs or persistent visitor/event records. */
export const SOURCES = [
  "direct",
  "google",
  "yandex",
  "bing",
  "telegram",
  "whatsapp",
  "social",
  "other",
] as const;
type Source = typeof SOURCES[number];
type Day = { views: number; browsers: number; sources: Record<Source, number> };
type Totals = { views: number };
const ORIGIN = "https://nohrikha.com";
const TOKEN_TTL = 90_000;
const WINDOW_MS = 60_000;
const WINDOW_REQUESTS = 180;
const MAX_TOKENS = 1024;
const NO_STORE = { "Cache-Control": "no-store" };

export function dayAt(now: number): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function emptyDay(): Day {
  return {
    views: 0,
    browsers: 0,
    sources: Object.fromEntries(
      SOURCES.map((source) => [source, 0]),
    ) as Day["sources"],
  };
}

function shiftedDay(day: string, offset: number): string {
  return new Date(Date.parse(day + "T12:00:00Z") + offset * 86_400_000)
    .toISOString().slice(0, 10);
}

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-")
    .replaceAll("/", "_").replace(/=+$/, "");
}

function decode(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(
    atob(text.replaceAll("-", "+").replaceAll("_", "/")),
    (char) => char.charCodeAt(0),
  );
}

export async function createCounter(
  kv: Deno.Kv,
  secret: string,
  options: { now?: () => number; maxDailyViews?: number } = {},
) {
  if (new TextEncoder().encode(secret).byteLength < 32) {
    throw new Error("COUNTER_SIGNING_KEY must contain at least 32 bytes");
  }
  const now = options.now ?? Date.now;
  const maxDailyViews = options.maxDailyViews ?? 5000;
  if (
    !Number.isSafeInteger(maxDailyViews) || maxDailyViews < 1 ||
    maxDailyViews > 100_000
  ) {
    throw new Error("MAX_DAILY_VIEWS must be an integer from 1 to 100000");
  }
  const signer = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const usedTokens = new Map<string, number>(); // Bounded, volatile, never written to KV.
  let windowStart = now();
  let windowRequests = 0;
  let cachedStats: { day: string; until: number; value: unknown } | undefined;
  let pendingStats: Promise<unknown> | undefined;

  function budget(): boolean {
    if (now() - windowStart >= WINDOW_MS) {
      windowStart = now();
      windowRequests = 0;
    }
    return ++windowRequests <= WINDOW_REQUESTS;
  }

  function json(data: unknown, status = 200, cache = NO_STORE): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": ORIGIN,
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow",
        ...cache,
      },
    });
  }

  async function challenge(): Promise<Response> {
    const time = now();
    const day = dayAt(time);
    const payload = encode(new TextEncoder().encode(
      JSON.stringify([day, time + TOKEN_TTL, crypto.randomUUID()]),
    ));
    const signature = encode(
      new Uint8Array(
        await crypto.subtle.sign(
          "HMAC",
          signer,
          new TextEncoder().encode(payload),
        ),
      ),
    );
    return json({ day, token: payload + "." + signature });
  }

  async function verify(token: string): Promise<boolean> {
    if (!/^[A-Za-z0-9_-]{50,200}\.[A-Za-z0-9_-]{43}$/.test(token)) return false;
    const [payload, signature] = token.split(".");
    if (
      !await crypto.subtle.verify(
        "HMAC",
        signer,
        decode(signature),
        new TextEncoder().encode(payload),
      )
    ) return false;
    const [day, expires, nonce] = JSON.parse(
      new TextDecoder().decode(decode(payload)),
    );
    return day === dayAt(now()) && Number.isSafeInteger(expires) &&
      expires > now() && expires <= now() + TOKEN_TTL &&
      typeof nonce === "string";
  }

  async function readBody(request: Request): Promise<unknown> {
    if (
      request.headers.get("content-type")?.split(";")[0].trim() !== "text/plain"
    ) {
      throw new Error("Use text/plain JSON");
    }
    if (
      Number(request.headers.get("content-length") ?? 0) > 512 || !request.body
    ) {
      throw new Error("Body too large or missing");
    }
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    let expired = false;
    const timeout = setTimeout(() => {
      expired = true;
      void reader.cancel().catch(() => {});
    }, 2000);
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

  async function collect(request: Request): Promise<Response> {
    let body: { token: string; first: boolean; source: Source };
    try {
      const value = await readBody(request);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return json({ error: "invalid request" }, 400);
      }
      const fields = value as Record<string, unknown>;
      if (
        Object.keys(fields).sort().join(",") !== "first,source,token" ||
        typeof fields.token !== "string" || typeof fields.first !== "boolean" ||
        typeof fields.source !== "string" ||
        !SOURCES.includes(fields.source as Source) ||
        !await verify(fields.token)
      ) return json({ error: "invalid request" }, 400);
      body = {
        token: fields.token,
        first: fields.first,
        source: fields.source as Source,
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
    // Reserve before awaiting storage. Keep the reservation even if the commit's
    // result is uncertain. Multiple instances/restarts can still permit replay.
    usedTokens.set(body.token, time + TOKEN_TTL);
    const day = dayAt(time);
    for (let attempt = 0; attempt < 8; attempt++) {
      const [entry, totalEntry] = await kv.getMany<[Day, Totals]>([
        ["daily", day],
        ["totals"],
      ], { consistency: "strong" });
      const current = entry.value ?? emptyDay();
      const total = totalEntry.value ?? { views: 0 };
      if (current.views >= maxDailyViews) {
        return json({ error: "daily limit" }, 429);
      }
      if (!Number.isSafeInteger(total.views + 1)) {
        return json({ error: "limit" }, 429);
      }
      const next: Day = {
        views: current.views + 1,
        browsers: current.browsers + (body.first ? 1 : 0),
        sources: { ...current.sources },
      };
      if (body.first) next.sources[body.source as Source]++;
      const result = await kv.atomic().check(entry, totalEntry)
        .set(entry.key, next).set(totalEntry.key, { views: total.views + 1 })
        .commit();
      if (result.ok) return json({ accepted: true });
      await new Promise((resolve) =>
        setTimeout(resolve, 2 + Math.random() * 8)
      );
    }
    return json({ error: "busy" }, 503);
  }

  async function stats(): Promise<unknown> {
    const day = dayAt(now());
    if (cachedStats && cachedStats.day === day && cachedStats.until > now()) {
      return cachedStats.value;
    }
    if (pendingStats) return pendingStats;
    pendingStats = (async () => {
      const from = shiftedDay(day, -29);
      const days = new Map<string, Day>();
      for (let offset = -29; offset <= 0; offset++) {
        days.set(shiftedDay(day, offset), emptyDay());
      }
      for await (
        const entry of kv.list<Day>({ prefix: ["daily"] }, {
          reverse: true,
          limit: 30,
        })
      ) {
        const date = String(entry.key[1]);
        if (date >= from && date <= day) days.set(date, entry.value);
      }
      const sources = emptyDay().sources;
      for (const value of days.values()) {
        for (const source of SOURCES) sources[source] += value.sources[source];
      }
      const total = await kv.get<Totals>(["totals"], { consistency: "strong" });
      const value = {
        day,
        today: days.get(day),
        totalViews: total.value?.views ?? 0,
        days: [...days].slice(-7).map(([date, count]) => ({
          date,
          views: count.views,
          browsers: count.browsers,
        })),
        sources,
        capped: (days.get(day)?.views ?? 0) >= maxDailyViews,
      };
      cachedStats = { day, until: now() + 30_000, value };
      return value;
    })();
    try {
      return await pendingStats;
    } finally {
      pendingStats = undefined;
    }
  }

  return async function handler(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.search) return json({ error: "unknown route" }, 404);
    if (request.method === "OPTIONS") {
      if (
        request.headers.get("origin") !== ORIGIN || url.pathname !== "/collect"
      ) {
        return json({ error: "origin" }, 403);
      }
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": ORIGIN,
          "Access-Control-Allow-Methods": "POST",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "3600",
          ...NO_STORE,
        },
      });
    }
    if (request.method === "GET" && url.pathname === "/stats") {
      try {
        return json(await stats(), 200, {
          "Cache-Control": "public, max-age=30",
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

if (import.meta.main) {
  const secret = Deno.env.get("COUNTER_SIGNING_KEY") ?? "";
  const maxDailyViews = Number(Deno.env.get("MAX_DAILY_VIEWS") ?? "5000");
  // Deploy supplies the assigned database; local runs may use an explicit path.
  const kv = await Deno.openKv(Deno.env.get("COUNTER_KV_PATH"));
  const handler = await createCounter(kv, secret, { maxDailyViews });
  Deno.serve({ port: Number(Deno.env.get("PORT") ?? "8000") }, handler);
}
