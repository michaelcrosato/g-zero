import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { checksum, compile, sha256 } from '../scripts/build.mjs';

const hosted = await compile({ hosted: true });
const offline = await compile();
const hooksSource = await readFile(
  new URL('../boot/hooks.js', import.meta.url),
  'utf8',
);

function descriptor(html, id) {
  const match = html.match(
    new RegExp(
      '<script id="gb-payload-' + id + '"[^>]*>([\\s\\S]*?)<\\/script>',
    ),
  );
  assert.ok(match, 'Missing payload descriptor: ' + id);
  return JSON.parse(match[1]);
}

function loaderHarness({ build = hosted, fetchAsset, mutate } = {}) {
  const elements = new Map(
    Object.keys(build.runtime).map((id) => {
      const data = descriptor(build.html, id);
      if (mutate) mutate(id, data);
      return ['gb-payload-' + id, { textContent: JSON.stringify(data) }];
    }),
  );
  const cleanups = [];
  const requests = [];
  const boot = {
    config: build.build,
    data: { payloads: {} },
    error: (code, message, cause) =>
      Object.assign(new Error(message, { cause }), { code }),
    checksum,
    note() {},
    warn() {},
    guard() {},
    addCleanup(fn) {
      cleanups.push(fn);
    },
  };
  const sandbox = {
    window: { GameBoot: boot, AudioContext: () => {} },
    document: {
      getElementById: (id) => elements.get(id),
      createElement: () => ({ getContext: () => ({}) }),
      documentElement: {},
    },
    navigator: {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    WebAssembly,
    Blob,
    URL,
    AbortController,
    requestAnimationFrame() {},
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (fetchAsset) return fetchAsset(url, options);
      return { ok: true, text: async () => build.assets[url] };
    },
  };
  vm.runInNewContext(hooksSource, sandbox);
  return { boot, requests, cleanups };
}

test('hosted assets preserve the exact verified engine and game bytes', () => {
  assert.equal(Object.keys(hosted.assets).length, 5);
  for (const [id, payload] of Object.entries(hosted.runtime)) {
    const data = descriptor(hosted.html, id);
    assert.match(data.url, /^\/assets\/[a-z-]+-[a-f0-9]{16}\.mjs$/);
    assert.equal(data.source, undefined);
    assert.equal(hosted.assets[data.url], offline.runtime[id].source);
    assert.equal(checksum(hosted.assets[data.url]), data.checksum);
    assert.equal(Buffer.byteLength(hosted.assets[data.url]), data.bytes);
    assert.equal(
      hosted.build.assets[id].sha256,
      sha256(hosted.assets[data.url]),
    );
    assert.ok(data.url.includes(sha256(payload.source).slice(0, 16)));
  }
});

test('the hosted entry is small and permits only same-origin asset connections', () => {
  assert.equal(hosted.build.mode, 'hosted');
  assert.equal(hosted.build.packaged, false);
  assert.ok(hosted.build.bytes < 100_000);
  assert.ok(hosted.build.bytes < offline.build.bytes / 30);
  assert.match(hosted.html, /connect-src 'self'/);
  assert.match(offline.html, /connect-src 'none'/);
  assert.equal(hosted.build.buildId, offline.build.buildId);
});

test('hosted builds reproduce the same HTML, hashed URLs, and manifest', async () => {
  const again = await compile({ hosted: true });
  assert.equal(again.html, hosted.html);
  assert.deepEqual(again.build, hosted.build);
  assert.deepEqual(again.assets, hosted.assets);
});

test('the hosted boot loader fetches and validates all five assets', async () => {
  const { boot, requests, cleanups } = loaderHarness();
  boot.hooks.core();
  await boot.hooks.capabilities();
  assert.equal(requests.length, 5);
  assert.deepEqual(
    Object.keys(boot.data.payloads).sort(),
    Object.keys(hosted.runtime).sort(),
  );
  for (const { url, options } of requests) {
    assert.ok(hosted.assets[url]);
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.signal.aborted, false);
  }
  for (const fn of cleanups) fn();
  assert.ok(requests.every(({ options }) => options.signal.aborted));
});

test('the offline loader validates embedded payloads without network access', async () => {
  const { boot, requests } = loaderHarness({ build: offline });
  boot.hooks.core();
  await boot.hooks.capabilities();
  assert.equal(requests.length, 0);
  assert.equal(Object.keys(boot.data.payloads).length, 5);
});

test('a missing hosted engine stops startup with a useful network failure', async () => {
  const { boot } = loaderHarness({
    fetchAsset: async () => ({ ok: false, status: 404 }),
  });
  await assert.rejects(
    boot.hooks.capabilities(),
    (error) => error.code === 'PKG-NET' && error.message.includes('HTTP 404'),
  );
});

test('damaged hosted bytes cannot pass the startup checksum gate', async () => {
  const { boot } = loaderHarness({
    fetchAsset: async (url) => ({
      ok: true,
      text: async () => hosted.assets[url] + '\n// damaged',
    }),
  });
  await assert.rejects(
    boot.hooks.capabilities(),
    (error) => error.code === 'PKG-HASH',
  );
});

test('the hosted loader rejects external payload URLs before fetching them', async () => {
  const { boot, requests } = loaderHarness({
    mutate(id, data) {
      if (id === 'rapier') data.url = 'https://example.com/rapier.mjs';
    },
  });
  await assert.rejects(
    boot.hooks.capabilities(),
    (error) => error.code === 'PKG-URL',
  );
  assert.ok(requests.every(({ url }) => url.startsWith('/assets/')));
});
