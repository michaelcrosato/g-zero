import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  Circuit, LapTracker, TUNING, CONTROL_POINTS, add, sub, mul, dot, cross,
  length, normalize, distanceSq, signedAngle, mod, wrapDelta,
  clamp, moveToward, dampFactor, formatTime, seededRandom
} from '../src/core.js';

const circuit = new Circuit();
const near = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected} within ${tolerance}`);

test('dependencies are pinned to the exact requested versions', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.engineVersions.three, '0.181.0');
  assert.equal(pkg.engineVersions['@dimforge/rapier3d-compat'], '0.19.3');
});
test('course is approximately 5.66 km, with genuine elevation change', () => {
  assert.ok(circuit.length > 5600 && circuit.length < 5700);
  const ys = circuit.positions.map(p => p.y);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 180);
  assert.ok(circuit.frames.some(f => Math.abs(f.bank) > .3));
});
test('invalid circuit inputs are rejected', () => {
  assert.throws(() => new Circuit({ width: 0 }), TypeError);
  assert.throws(() => new Circuit({ segments: 12 }), TypeError);
  assert.throws(() => new Circuit({ points: CONTROL_POINTS.slice(0, 3) }), TypeError);
});
test('course sampling wraps exactly at the seam', () => {
  const a = circuit.sample(0), b = circuit.sample(circuit.length);
  near(distanceSq(a.position, b.position), 0);
  near(dot(a.tangent, b.tangent), 1);
  near(dot(a.up, b.up), 1);
  near(distanceSq(circuit.sample(-.01).position, circuit.sample(circuit.length - .01).position), 0);
});
test('arc-length samples have near-uniform spacing', () => {
  for (let i = 0; i < circuit.count; i++) {
    const ds = length(sub(circuit.positions[i], circuit.positions[(i + 1) % circuit.count]));
    near(ds, circuit.step, .004);
  }
});
test('all track frames are finite, orthonormal and upward-facing', () => {
  for (const f of circuit.frames) {
    for (const v of [f.position, f.right, f.up, f.tangent]) assert.ok([v.x, v.y, v.z].every(Number.isFinite));
    for (const v of [f.right, f.up, f.tangent]) near(length(v), 1);
    near(dot(f.right, f.up), 0); near(dot(f.right, f.tangent), 0); near(dot(f.tangent, f.up), 0);
    assert.ok(f.up.y > .84);
    near(dot(cross(f.right, f.tangent), f.up), 1);
  }
});
test('adjacent surface frames, including seam, do not flip', () => {
  for (let i = 0; i < circuit.count; i++) {
    const f = circuit.frames[i], next = circuit.frames[(i + 1) % circuit.count];
    assert.ok(dot(f.up, next.up) > .995);
    assert.ok(dot(f.tangent, next.tangent) > .98);
  }
});
test('interpolated frame basis remains orthonormal', () => {
  for (let i = 0; i < 230; i++) {
    const f = circuit.sample((i + .417) * circuit.length / 230);
    near(length(f.right), 1); near(length(f.up), 1); near(length(f.tangent), 1);
    near(dot(f.right, f.up), 0); near(dot(f.right, f.tangent), 0);
  }
});
test('surface geometry has the expected sizes and no out-of-range indices', () => {
  const { vertices, indices } = circuit.surfaceVertices();
  assert.equal(vertices.length, (circuit.count + 1) * 6);
  assert.equal(indices.length, circuit.count * 6);
  assert.ok([...vertices].every(Number.isFinite));
  assert.ok([...indices].every(i => i < vertices.length / 3));
  for (let i = 0; i < 6; i++) near(vertices[i], vertices[vertices.length - 6 + i], 1e-6);
});
test('wide surface triangles are upward-facing, nonfolded and nondegenerate', () => {
  const { vertices, indices } = circuit.surfaceVertices();
  const point = i => ({ x: vertices[i * 3], y: vertices[i * 3 + 1], z: vertices[i * 3 + 2] });
  for (let i = 0; i < indices.length; i += 3) {
    const a = point(indices[i]), b = point(indices[i + 1]), c = point(indices[i + 2]);
    const n = cross(sub(b, a), sub(c, a));
    assert.ok(length(n) > 100);
    // A wider banked ribbon has more local pitch at its inner edge.
    // Compare to the center frame only to detect folded or reversed triangles.
    assert.ok(dot(normalize(n), circuit.frames[Math.floor(i / 6)].up) > .90);
  }
});
test('nearest-point projection tracks lane and height in 3D', () => {
  for (let i = 0; i < 50; i++) {
    const f = circuit.sample(i * circuit.length / 50);
    const p = add(add(f.position, mul(f.right, 11)), mul(f.up, 3.4));
    const found = circuit.nearest(p, f.index);
    near(found.offset, 11, .15); near(found.height, 3.4, .12);
    assert.ok(Math.abs(wrapDelta(found.s, f.s, circuit.length)) < 1.4);
  }
});
test('nearest-point fallback recovers from a stale section hint', () => {
  const f = circuit.sample(circuit.length * .6);
  const result = circuit.nearest(add(f.position, mul(f.up, 3.4)), 0);
  assert.ok(Math.abs(wrapDelta(result.s, f.s, circuit.length)) < .8);
});
test('non-neighboring road regions have clearance greater than the road width', () => {
  for (let i = 0; i < circuit.count; i += 11) for (let j = i + 66; j < circuit.count; j += 11) {
    if (circuit.count - j + i < 66) continue;
    assert.ok(length(sub(circuit.positions[i], circuit.positions[j])) > circuit.width * 1.3);
  }
});
test('boost and recharge detection matches physical strip bounds', () => {
  for (const strip of [...circuit.pads, circuit.recharge]) {
    assert.ok(circuit.containsStrip(strip.s, strip.lane, strip));
    assert.ok(!circuit.containsStrip(strip.s, strip.lane + strip.width, strip));
    assert.ok(!circuit.containsStrip(strip.s + strip.length, strip.lane, strip));
  }
  const seamStrip = { s: 1, length: 20, lane: 0, width: 10 };
  assert.ok(circuit.containsStrip(circuit.length - 3, 0, seamStrip));
});
test('a forward race counts exactly three laps and records split times', () => {
  const tracker = new LapTracker(1000, 10, 3);
  for (let distance = 20; distance <= 3000; distance += 10) tracker.update(mod(distance, 1000), (distance - 10) / 100);
  assert.equal(tracker.laps, 3); assert.equal(tracker.finished, true);
  near(tracker.lapTimes[0], 9.9); near(tracker.lapTimes[1], 10); near(tracker.lapTimes[2], 10);
});
test('back-and-forth movement across the finish cannot manufacture laps', () => {
  const tracker = new LapTracker(1000, 10, 3);
  for (let i = 0; i < 60; i++) { tracker.update(995, i); tracker.update(10, i + .5); }
  assert.equal(tracker.laps, 0); assert.equal(tracker.gates, 0);
});
test('reverse driving never awards a lap', () => {
  const tracker = new LapTracker(1000, 10);
  for (let distance = 0; distance > -3200; distance -= 10) tracker.update(mod(distance, 1000), -distance / 100);
  assert.equal(tracker.laps, 0); assert.ok(tracker.distance < 0);
});
test('large teleport jumps do not award checkpoint progress', () => {
  const tracker = new LapTracker(1000, 10);
  tracker.update(700, 1); assert.equal(tracker.distance, 10); assert.equal(tracker.laps, 0);
});
test('completed race is immutable under later position updates', () => {
  const tracker = new LapTracker(1000, 10, 1);
  for (let i = 20; i <= 1000; i += 10) tracker.update(mod(i, 1000), i / 100);
  const snapshot = JSON.stringify(tracker);
  for (let i = 0; i < 20; i++) tracker.update(i * 20, 30);
  assert.equal(JSON.stringify(tracker), snapshot);
});
test('race lap splits include an explicit recovery penalty', () => {
  const tracker = new LapTracker(1000, 10, 1);
  for (let i = 20; i <= 1000; i += 10) tracker.update(mod(i, 1000), (i - 10) / 100 + (i >= 500 ? 3 : 0));
  near(tracker.lapTimes[0], 12.9);
});
test('steering sign matches left/right in a right-handed 3D world', () => {
  const forward = { x: 0, y: 0, z: -1 }, left = { x: -1, y: 0, z: 0 }, right = { x: 1, y: 0, z: 0 }, up = { x: 0, y: 1, z: 0 };
  near(signedAngle(forward, left, up), Math.PI / 2);
  near(signedAngle(forward, right, up), -Math.PI / 2);
});
test('fixed-step acceleration reaches but cannot overshoot target speed', () => {
  let velocity = 0;
  for (let i = 0; i < 1000; i++) velocity = moveToward(velocity, TUNING.topSpeed, TUNING.acceleration * TUNING.fixedStep);
  near(velocity, 516);
  for (let i = 0; i < 1000; i++) velocity = moveToward(velocity, 0, TUNING.braking * TUNING.fixedStep);
  near(velocity, 0);
});
test('exponential damping has equivalent 30 Hz and 120 Hz response', () => {
  const integrate = fps => { let value = 0; for (let i = 0; i < fps; i++) value += (1 - value) * dampFactor(5, 1 / fps); return value; };
  near(integrate(30), integrate(120));
});
test('modular distance handles both directions across the seam', () => {
  near(wrapDelta(5, 995, 1000), 10); near(wrapDelta(995, 5, 1000), -10);
  near(mod(-2, 10), 8); near(mod(12, 10), 2);
});
test('race clock formatting handles boundaries and missing records', () => {
  assert.equal(formatTime(0), '00:00.00'); assert.equal(formatTime(61.234), '01:01.23');
  assert.equal(formatTime(59.999), '00:59.99'); assert.equal(formatTime(Infinity), '--:--.--');
  assert.equal(formatTime(-1), '00:00.00');
});
test('procedural random art is deterministic', () => {
  const a = seededRandom(42), b = seededRandom(42);
  for (let i = 0; i < 100; i++) { const n = a(); near(n, b()); assert.ok(n >= 0 && n < 1); }
});
test('generated HTML has no unresolved local module imports or source placeholders', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(!html.includes('INLINE_SCRIPT')); assert.ok(!html.includes('INLINE_STYLE'));
  assert.ok(!/^import\s.*from ['"]\.\//m.test(html));
  assert.ok(html.includes('THREE.JS R181'));
  assert.ok(html.includes('RAPIER 0.19.3'));
});
