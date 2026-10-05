import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compile, checksum, sha256 } from '../scripts/build.mjs';
const read = name => readFile(new URL('../' + name, import.meta.url), 'utf8');
const compiled = await compile();
function block(id) {
  const match = compiled.html.match(new RegExp('<script id="' + id + '"[^>]*>([\\s\\S]*?)<\\/script>'));
  assert.ok(match, 'Missing ' + id); return match[1].trim();
}
test('the checked-in HTML exactly matches a fresh source build', async () => assert.equal(await read('index.html'), compiled.html));
test('a second build has the same build ID and SHA-256', async () => {
  const second = await compile(); assert.equal(second.html, compiled.html); assert.deepEqual(second.build, compiled.build);
});
test('the boot screen and game view use the g-zero name', () => {
  const config = JSON.parse(block('gb-config')), view = JSON.parse(block('gb-game-view'));
  assert.equal(config.id, 'g-zero'); assert.equal(config.name, 'g-zero'); assert.equal(config.version, '0.5.1');
  assert.match(compiled.html, /<title>g-zero — Magnetic Grand Prix<\/title>/);
  assert.match(compiled.html, /id="gb-game-version">g-zero 0\.5\.1<\/dd>/);
  assert.match(view.html, /g-<span>zero<\/span>/); assert.ok(!view.html.includes('ION CIRCUIT'));
});
test('the game is complete offline HTML and contains no packager', () => {
  const config = JSON.parse(block('gb-config'));
  assert.equal(config.mode, 'offline'); assert.equal(config.packaged, true);
  assert.ok(!compiled.html.includes('id="gb-package"')); assert.ok(!compiled.html.includes('id="gb-packager-code"'));
  assert.ok(!/<script\b[^>]*\bsrc\s*=/i.test(compiled.html)); assert.ok(!/<link\b[^>]*rel=["']stylesheet/i.test(compiled.html));
  assert.match(compiled.html, /connect-src 'none'/);
});
test('all five payload versions, checksums, and UTF-8 byte lengths match', () => {
  for (const [id, payload] of Object.entries(compiled.runtime)) {
    assert.equal(payload.checksum, checksum(payload.source));
    assert.equal(payload.bytes, Buffer.byteLength(payload.source));
    assert.deepEqual(JSON.parse(block('gb-payload-' + id)), payload);
  }
  assert.ok(compiled.runtime.rapier.source.includes('AGFzbQ'));
});
test('the game view integrity value matches the serialized view', () => {
  assert.equal(JSON.parse(block('gb-config')).viewChecksum, checksum(block('gb-game-view')));
});
test('the build manifest matches the exact deliverable bytes', async () => {
  const info = JSON.parse(await read('build-info.json'));
  assert.equal(info.sha256, sha256(compiled.html)); assert.equal(info.bytes, Buffer.byteLength(compiled.html));
});
test('licenses for the game and both engines remain embedded', () => {
  const licenses = JSON.parse(block('gb-licenses'));
  assert.match(licenses.game, /MIT License/); assert.match(licenses.three, /MIT License/); assert.match(licenses.rapier, /Apache License/);
});
test('emergency error handling is active before any engine payload', () => {
  assert.ok(compiled.html.indexOf('id="gb-emergency-code"') < compiled.html.indexOf('id="gb-core-code"'));
  assert.ok(compiled.html.indexOf('id="gb-core-code"') < compiled.html.indexOf('id="gb-payload-three-core"'));
  assert.ok(compiled.html.indexOf('id="gb-hooks-code"') > compiled.html.indexOf('id="gb-payload-game"'));
});
test('the source contains the new debug name and preserves the legacy test alias', async () => {
  const game = await read('src/game.js'); assert.match(game, /window\.GZERO = api/); assert.match(game, /window\.ION = api/);
});
