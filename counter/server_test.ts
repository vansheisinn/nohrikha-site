import { createCounter, dayAt, SOURCES } from "./server.ts";

const origin = "https://nohrikha.com";
const secret = "only-for-local-tests-not-a-production-key";
type Handler = (request: Request) => Promise<Response>;
function assert(
  condition: unknown,
  message = "assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}
async function response(
  handler: Handler,
  path: string,
  body?: unknown,
  extra: HeadersInit = {},
) {
  return await handler(
    new Request("https://counter.test" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        origin,
        ...(body === undefined ? {} : { "content-type": "text/plain" }),
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}
async function token(handler: Handler): Promise<string> {
  const challenge = await response(handler, "/challenge");
  assert(challenge.status === 200);
  return (await challenge.json()).token;
}
function closeKv(kv: Deno.Kv) {
  try {
    kv.close();
  } catch (error) {
    if (!(error instanceof Deno.errors.BadResource)) throw error;
  }
}
function numbersOnly(value: unknown) {
  if (typeof value === "object" && value) {
    for (const child of Object.values(value)) numbersOnly(child);
  } else {
    assert(
      typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
    );
  }
}
async function withCounter(
  test: (
    handler: Handler,
    kv: Deno.Kv,
    clock: { time: number },
  ) => Promise<void>,
  maxDailyViews?: number,
) {
  const kv = await Deno.openKv(":memory:");
  const clock = { time: Date.parse("2026-10-19T12:00:00Z") };
  try {
    const handler = await createCounter(kv, secret, {
      now: () => clock.time,
      maxDailyViews,
    });
    await test(handler, kv, clock);
  } finally {
    closeKv(kv);
  }
}

Deno.test("daily browsers, views, first-visit sources, numbers-only persistence and public stats", async () => {
  await withCounter(async (handler, kv) => {
    for (const first of [true, false, false]) {
      const result = await response(handler, "/collect", {
        token: await token(handler),
        first,
        source: first ? "telegram" : "direct",
      });
      assert(result.status === 200 && (await result.json()).accepted);
    }
    const result = await response(handler, "/stats");
    assert(result.headers.get("access-control-allow-origin") === origin);
    assert(result.headers.get("cache-control") === "public, max-age=30");
    const stats = await result.json();
    assert(
      stats.totalViews === 3 && stats.today.views === 3 &&
        stats.today.browsers === 1,
    );
    assert(
      stats.sources.telegram === 1 && stats.sources.direct === 0 &&
        stats.days.length === 7,
    );
    let entries = 0;
    for await (const entry of kv.list({ prefix: [] })) {
      entries++;
      assert(["daily", "totals"].includes(String(entry.key[0])));
      numbersOnly(entry.value);
    }
    assert(entries === 2);
    const unauthenticated = await handler(
      new Request("https://counter.test/stats"),
    );
    assert(
      unauthenticated.status === 200,
      "owner explicitly allowed public statistics",
    );
  });
});

Deno.test("concurrent replay of one token increments only once on an instance", async () => {
  await withCounter(async (handler) => {
    const body = {
      token: await token(handler),
      first: true,
      source: "whatsapp",
    };
    const responses = await Promise.all(
      Array.from({ length: 12 }, () => response(handler, "/collect", body)),
    );
    const results = await Promise.all(responses.map((r) => r.json()));
    assert(results.filter((r) => r.accepted).length === 1);
    assert(results.filter((r) => r.duplicate).length === 11);
    const stats = await (await response(handler, "/stats")).json();
    assert(
      stats.totalViews === 1 && stats.today.browsers === 1 &&
        stats.sources.whatsapp === 1,
    );
  });
});

Deno.test("independent simultaneous writes do not lose accepted views", async () => {
  await withCounter(async (handler, kv) => {
    const tokens = await Promise.all(
      Array.from({ length: 20 }, () => token(handler)),
    );
    const responses = await Promise.all(
      tokens.map((token) =>
        response(handler, "/collect", { token, first: false, source: "direct" })
      ),
    );
    let accepted = 0;
    for (const result of responses) {
      assert([200, 503].includes(result.status));
      const body = await result.json();
      if (body.accepted) accepted++;
    }
    assert(accepted > 0);
    const total = await kv.get<{ views: number }>(["totals"]);
    const day = await kv.get<{ views: number; browsers: number }>([
      "daily",
      "2026-10-19",
    ]);
    assert(
      total.value?.views === accepted && day.value?.views === accepted &&
        day.value?.browsers === 0,
    );
  });
});

Deno.test("Moscow midnight, expiring/tampered tokens and new daily aggregate", async () => {
  await withCounter(async (handler, _kv, clock) => {
    clock.time = Date.parse("2026-10-19T20:59:59Z");
    assert(dayAt(clock.time) === "2026-10-19");
    const previous = await token(handler);
    const first = await response(handler, "/collect", {
      token: previous,
      first: true,
      source: "google",
    });
    assert(first.status === 200);
    await first.json();
    clock.time += 2000;
    assert(dayAt(clock.time) === "2026-10-20");
    const late = await response(handler, "/collect", {
      token: previous,
      first: true,
      source: "google",
    });
    assert(late.status === 400);
    await late.json();
    const expired = await token(handler);
    clock.time += 91_000;
    const old = await response(handler, "/collect", {
      token: expired,
      first: true,
      source: "google",
    });
    assert(old.status === 400);
    await old.json();
    const fresh = await token(handler);
    const tampered = await response(handler, "/collect", {
      token: fresh.slice(0, -2) + "XX",
      first: true,
      source: "direct",
    });
    assert(tampered.status === 400);
    await tampered.json();
    const current = await response(handler, "/collect", {
      token: fresh,
      first: true,
      source: "yandex",
    });
    assert(current.status === 200);
    await current.json();
    const stats = await (await response(handler, "/stats")).json();
    assert(
      stats.day === "2026-10-20" && stats.today.browsers === 1 &&
        stats.totalViews === 2,
    );
    assert(stats.sources.google === 1 && stats.sources.yandex === 1);
  });
});

Deno.test("reject unexpected data, oversized streams, wrong origin and methods", async () => {
  await withCounter(async (handler) => {
    const valid = {
      token: await token(handler),
      first: true,
      source: "direct",
    };
    for (
      const body of [
        { ...valid, ip: "192.0.2.1" },
        { ...valid, source: "person@example.test" },
        { ...valid, first: 1 },
        [],
        null,
      ]
    ) {
      const result = await response(handler, "/collect", body);
      assert(result.status === 400);
      await result.json();
    }
    const badOrigin = await response(handler, "/collect", valid, {
      origin: "https://nohrikha.com.attacker.test",
    });
    assert(badOrigin.status === 403);
    await badOrigin.json();
    const noOrigin = await handler(
      new Request("https://counter.test/challenge"),
    );
    assert(noOrigin.status === 403);
    await noOrigin.json();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(513));
        controller.close();
      },
    });
    const large = await handler(
      new Request("https://counter.test/collect", {
        method: "POST",
        headers: { origin, "content-type": "text/plain" },
        body: stream,
      }),
    );
    assert(large.status === 400);
    await large.json();
    const get = await response(handler, "/collect");
    assert(get.status === 405);
    await get.json();
    const stats = await (await response(handler, "/stats")).json();
    assert(stats.totalViews === 0);
  });
});

Deno.test("daily cap is atomic and visibly reported, collection is throttled", async () => {
  await withCounter(async (handler) => {
    const tokens = await Promise.all(
      Array.from({ length: 10 }, () => token(handler)),
    );
    const responses = await Promise.all(
      tokens.map((token) =>
        response(handler, "/collect", { token, first: true, source: "other" })
      ),
    );
    const statuses = responses.map((result) => result.status);
    for (const result of responses) await result.json();
    assert(statuses.filter((s) => s === 200).length === 3);
    assert(statuses.filter((s) => s === 429).length === 7);
    const stats = await (await response(handler, "/stats")).json();
    assert(stats.capped && stats.totalViews === 3);
    let status = 200;
    for (let i = 0; i < 180; i++) {
      const result = await response(handler, "/challenge");
      status = result.status;
      await result.json();
    }
    assert(status === 429);
  }, 3);
});

Deno.test("seven calendar days and 30-day sources exclude older traffic, total retains it", async () => {
  await withCounter(async (handler, kv) => {
    const sources = Object.fromEntries(
      SOURCES.map((key) => [key, key === "telegram" ? 9 : 0]),
    );
    await kv.set(["daily", "2026-08-01"], { views: 20, browsers: 9, sources });
    await kv.set(["totals"], { views: 20 });
    const stats = await (await response(handler, "/stats")).json();
    assert(
      stats.totalViews === 20 && stats.sources.telegram === 0 &&
        stats.today.views === 0,
    );
    assert(
      stats.days[0].date === "2026-10-13" &&
        stats.days[6].date === "2026-10-19",
    );
  });
});

Deno.test("unavailable KV fails safely without exposing errors", async () => {
  await withCounter(async (handler, kv) => {
    const body = { token: await token(handler), first: true, source: "direct" };
    kv.close();
    for (
      const result of [
        await response(handler, "/collect", body),
        await response(handler, "/stats"),
      ]
    ) {
      assert(result.status === 503);
      assert(await result.text() === '{"error":"temporarily unavailable"}');
    }
  });
});

Deno.test("daily cap is shared across independent server instances", async () => {
  await withCounter(async (first, kv, clock) => {
    const second = await createCounter(kv, secret, {
      now: () => clock.time,
      maxDailyViews: 3,
    });
    const handlers = [first, second, first, second, first, second];
    const tokens = await Promise.all(handlers.map((handler) => token(handler)));
    const responses = await Promise.all(
      handlers.map((handler, i) =>
        response(handler, "/collect", {
          token: tokens[i],
          first: true,
          source: "telegram",
        })
      ),
    );
    const statuses = responses.map((r) => r.status);
    for (const result of responses) await result.json();
    assert(
      statuses.filter((s) => s === 200).length === 3 &&
        statuses.filter((s) => s === 429).length === 3,
    );
  }, 3);
});

Deno.test("slow request body is cancelled instead of holding the server indefinitely", async () => {
  await withCounter(async (handler) => {
    let cancelled = false;
    const stream = new ReadableStream({
      cancel() {
        cancelled = true;
      },
    });
    const result = await handler(
      new Request("https://counter.test/collect", {
        method: "POST",
        headers: { origin, "content-type": "text/plain" },
        body: stream,
      }),
    );
    assert(result.status === 400 && cancelled);
    await result.json();
  });
});
