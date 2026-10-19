import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createCounter, dayAt, SOURCES } from '../core.ts';
import { d1Store } from '../worker.ts';
import { schema } from '../schema.ts';

const origin = 'https://nohrikha.com';
const secret = 'only-for-local-tests-not-a-production-key';
const bundle = await build({ entryPoints: [new URL('../worker.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', target: 'es2022' });
assert.equal(await readFile(new URL('../worker.bundle.js', import.meta.url), 'utf8'), bundle.outputFiles[0].text,
  'Regenerate the dashboard artifact with npm run bundle');

async function runtime(initialize = true) {
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2025-10-01', d1Databases: ['DB'],
    bindings: { COUNTER_SIGNING_KEY: secret, MAX_DAILY_VIEWS: '5000' },
  }));
  const db = await mf.getD1Database('DB');
  if (initialize) await db.batch(schema.split('-- statement-break').map(sql => db.prepare(sql)));
  return { mf, db };
}
async function withCounter(fn, limit = 5000) {
  const { mf, db } = await runtime();
  const clock = { time: Date.parse('2026-10-19T12:00:00Z') };
  const store = d1Store(db);
  const handler = await createCounter(store, secret, { now: () => clock.time, maxDailyViews: limit });
  try { await fn({ handler, db, store, clock, mf }); }
  finally { await mf.dispose(); }
}
function response(handler, path, body = undefined, extra = {}) {
  return handler(new Request('https://counter.test' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin, ...(body === undefined ? {} : { 'content-type': 'text/plain' }), ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}
async function token(handler) {
  const result = await response(handler, '/challenge');
  assert.equal(result.status, 200);
  return (await result.json()).token;
}
async function collect(handler, first = true, source = 'telegram') {
  const result = await response(handler, '/collect', { token: await token(handler), first, source });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).accepted, true);
}

test('D1 keeps only aggregate numbers; daily browsers, views and first-visit sources', async () => {
  await withCounter(async ({ handler, db }) => {
    for (const first of [true, false, false]) await collect(handler, first, first ? 'telegram' : 'direct');
    const result = await response(handler, '/stats');
    const stats = await result.json();
    assert.equal(stats.totalViews, 3);
    assert.equal(stats.today.views, 3);
    assert.equal(stats.today.browsers, 1);
    assert.equal(stats.sources.telegram, 1);
    assert.equal(stats.sources.direct, 0);
    assert.equal(stats.days.length, 7);
    const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('daily','totals') ORDER BY name").all();
    assert.deepEqual(tables.results.map(r => r.name), ['daily', 'totals']);
    for (const table of ['daily', 'totals']) {
      const rows = await db.prepare('SELECT * FROM ' + table).all();
      assert.equal(rows.results.length, 1);
      for (const row of rows.results) for (const [key, value] of Object.entries(row)) {
        if (key === 'date') assert.match(value, /^\d{4}-\d{2}-\d{2}$/);
        else assert.ok(Number.isSafeInteger(value) && value >= 0);
      }
    }
    assert.equal(result.headers.get('cache-control'), 'public, max-age=30');
    assert.equal((await handler(new Request('https://counter.test/stats'))).status, 200);
    await db.batch(schema.split('-- statement-break').map(sql => db.prepare(sql)));
    assert.equal((await db.prepare('SELECT views FROM totals').first()).views, 3, 'repeated schema setup must never reset counts');
  });
});

test('one signed token cannot increment twice concurrently on one instance', async () => {
  await withCounter(async ({ handler, db }) => {
    const body = { token: await token(handler), first: true, source: 'whatsapp' };
    const results = await Promise.all(Array.from({ length: 12 }, async () => (await response(handler, '/collect', body)).json()));
    assert.equal(results.filter(r => r.accepted).length, 1);
    assert.equal(results.filter(r => r.duplicate).length, 11);
    assert.equal((await db.prepare('SELECT views FROM totals').first()).views, 1);
  });
});

test('concurrent SQL upserts preserve all accepted counts and the total trigger', async () => {
  await withCounter(async ({ handler, db }) => {
    const tokens = await Promise.all(Array.from({ length: 30 }, () => token(handler)));
    const results = await Promise.all(tokens.map(async token => (await response(handler, '/collect', { token, first: false, source: 'direct' })).json()));
    assert.equal(results.filter(r => r.accepted).length, 30);
    const daily = await db.prepare('SELECT views,browsers FROM daily').first();
    assert.deepEqual(daily, { views: 30, browsers: 0 });
    assert.equal((await db.prepare('SELECT views FROM totals').first()).views, 30);
  });
});

test('server Moscow date, midnight, expired and tampered signatures', async () => {
  await withCounter(async ({ handler, clock }) => {
    clock.time = Date.parse('2026-10-19T20:59:59Z');
    assert.equal(dayAt(clock.time), '2026-10-19');
    await collect(handler, true, 'google');
    const old = await token(handler);
    clock.time += 2000;
    assert.equal(dayAt(clock.time), '2026-10-20');
    assert.equal((await response(handler, '/collect', { token: old, first: true, source: 'google' })).status, 400);
    const expired = await token(handler);
    clock.time += 91_000;
    assert.equal((await response(handler, '/collect', { token: expired, first: true, source: 'google' })).status, 400);
    const fresh = await token(handler);
    const bad = fresh[0] === 'A' ? 'B' + fresh.slice(1) : 'A' + fresh.slice(1);
    assert.equal((await response(handler, '/collect', { token: bad, first: true, source: 'google' })).status, 400);
    await collect(handler, true, 'yandex');
    const stats = await (await response(handler, '/stats')).json();
    assert.equal(stats.totalViews, 2);
    assert.equal(stats.today.browsers, 1);
    assert.equal(stats.sources.google, 1);
    assert.equal(stats.sources.yandex, 1);
  });
});

test('reject private/unexpected fields, large streams, forged Origin and wrong method', async () => {
  await withCounter(async ({ handler, db }) => {
    const valid = { token: await token(handler), first: true, source: 'direct' };
    for (const value of [{ ...valid, ip: '192.0.2.1' }, { ...valid, source: 'person@example.test' }, { ...valid, first: 1 }, [], null]) {
      assert.equal((await response(handler, '/collect', value)).status, 400);
    }
    assert.equal((await response(handler, '/collect', valid, { origin: origin + '.attacker.test' })).status, 403);
    assert.equal((await handler(new Request('https://counter.test/challenge'))).status, 403);
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(513)); controller.close(); } });
    const oversized = await handler(new Request('https://counter.test/collect', { method: 'POST', headers: { origin, 'content-type': 'text/plain' }, body: stream, duplex: 'half' }));
    assert.equal(oversized.status, 400);
    assert.equal((await response(handler, '/collect')).status, 405);
    assert.equal((await db.prepare('SELECT views FROM totals').first()).views, 0);
  });
});

test('daily cap is atomic across separate handlers and rate limits reject excess', async () => {
  await withCounter(async ({ handler, store, clock, db }) => {
    const second = await createCounter(store, secret, { now: () => clock.time, maxDailyViews: 3 });
    const handlers = Array.from({ length: 12 }, (_, i) => i % 2 ? second : handler);
    const tokens = await Promise.all(handlers.map(h => token(h)));
    const responses = await Promise.all(handlers.map((h, i) => response(h, '/collect', { token: tokens[i], first: true, source: 'other' })));
    assert.equal(responses.filter(r => r.status === 200).length, 3);
    assert.equal(responses.filter(r => r.status === 429).length, 9);
    assert.equal((await db.prepare('SELECT views FROM totals').first()).views, 3);
    const stats = await (await response(handler, '/stats')).json();
    assert.equal(stats.capped, true);
    let result;
    for (let i = 0; i < 180; i++) result = await response(handler, '/challenge');
    assert.equal(result.status, 429);
  }, 3);
});

test('seven calendar days, 30-day attribution and retained historical total', async () => {
  await withCounter(async ({ handler, db }) => {
    await db.prepare('INSERT INTO daily(date,views,browsers,telegram) VALUES(?,?,?,?)').bind('2026-08-01', 20, 9, 9).run();
    const stats = await (await response(handler, '/stats')).json();
    assert.equal(stats.totalViews, 20);
    assert.equal(stats.sources.telegram, 0);
    assert.equal(stats.days[0].date, '2026-10-13');
    assert.equal(stats.days[6].date, '2026-10-19');
  });
});

test('missing D1 schema fails safely, with no leaked storage errors', async () => {
  await withCounter(async ({ handler, db }) => {
    const body = { token: await token(handler), first: true, source: 'direct' };
    await db.prepare('DROP TABLE daily').run();
    for (const result of [await response(handler, '/collect', body), await response(handler, '/stats')]) {
      assert.equal(result.status, 503);
      assert.deepEqual(await result.json(), { error: 'temporarily unavailable' });
    }
  });
});

test('slow streaming body times out and weak signing keys cannot start collection', async () => {
  await withCounter(async ({ handler, store }) => {
    await assert.rejects(createCounter(store, 'short'), /at least 32 bytes/);
    let cancelled = false;
    const stream = new ReadableStream({ cancel() { cancelled = true; } });
    const result = await handler(new Request('https://counter.test/collect', { method: 'POST', headers: { origin, 'content-type': 'text/plain' }, body: stream, duplex: 'half' }));
    assert.equal(result.status, 400);
    assert.ok(cancelled);
  });
});

test('complete compiled Worker runs in workerd with real D1 and replay protection', async () => {
  const { mf, db } = await runtime(false);
  try {
    const health = await mf.dispatchFetch('https://counter.test/health');
    assert.deepEqual(await health.json(), { ok: true });
    const challenge = await mf.dispatchFetch('https://counter.test/challenge', { headers: { origin } });
    assert.equal(challenge.status, 200);
    const body = JSON.stringify({ token: (await challenge.json()).token, first: true, source: 'telegram' });
    for (const expected of [true, false]) {
      const result = await mf.dispatchFetch('https://counter.test/collect', { method: 'POST', headers: { origin, 'content-type': 'text/plain' }, body });
      assert.equal(result.status, 200);
      assert.equal((await result.json()).accepted, expected);
    }
    const result = await mf.dispatchFetch('https://counter.test/stats');
    assert.equal(result.headers.get('access-control-allow-origin'), origin);
    const stats = await result.json();
    assert.equal(stats.totalViews, 1);
    assert.equal(stats.today.browsers, 1);
    assert.equal(stats.sources.telegram, 1);
    assert.equal((await db.prepare('SELECT views FROM totals').first()).views, 1);
    const rejected = await mf.dispatchFetch('https://counter.test/collect', { method: 'POST', headers: { origin: 'https://attacker.test', 'content-type': 'text/plain' }, body });
    assert.equal(rejected.status, 403);
  } finally { await mf.dispose(); }
});
