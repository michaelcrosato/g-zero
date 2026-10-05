import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, RIVAL_COUNT, RACER_COUNT, START_POSITION, MAGNET_MARGIN, TUNING, gridSlot, magneticAdvance, rankText, vec, add, sub, mul, dot, length } from '../src/core.js';
const track = new Circuit();
const near = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) < tolerance, `${a} differs from ${b}`);

test('the field contains 100 opponents and starts the player in position 100', () => {
  assert.equal(RIVAL_COUNT, 100); assert.equal(RACER_COUNT, 101); assert.equal(START_POSITION, 100);
});
test('the grid has 99 opponents ahead and one behind the player', () => {
  const player = gridSlot(START_POSITION, track);
  const rivals = Array.from({ length: RACER_COUNT }, (_, i) => i + 1).filter(i => i !== START_POSITION).map(i => gridSlot(i, track));
  assert.equal(rivals.filter(r => r.distance > player.distance).length, 99);
  assert.equal(rivals.filter(r => r.distance < player.distance).length, 1);
  assert.equal(new Set([...rivals, player].map(r => `${r.distance}/${r.lane}`)).size, 101);
});
test('invalid grid positions are rejected', () => {
  for (const n of [0, 102, 1.5, NaN]) assert.throws(() => gridSlot(n, track), RangeError);
});
test('magnetic lock does not move the player toward the center line', () => {
  for (const s of [10, 800, 2300, 5100]) for (const lane of [-40, -17, 0, 18, 40]) {
    const next = magneticAdvance(track, s, lane, vec());
    near(next.distance, s); near(next.lane, lane); assert.equal(next.edge, false);
  }
});
test('large upward and downward impulses cannot change the magnetic coordinates', () => {
  for (let i = 0; i < 24; i++) for (const lane of [-45, 0, 45]) for (const force of [-10000, 10000]) {
    const s = (i + 0.31) * track.length / 24, pose = track.magneticPose(s, lane);
    const next = magneticAdvance(track, s, lane, mul(pose.up, force));
    near(next.distance, s); near(next.lane, lane);
    near(dot(sub(next.pose.point, next.pose.surface), next.pose.up), TUNING.hoverHeight);
  }
});
test('both track edges contain the whole craft', () => {
  const limit = track.width / 2 - MAGNET_MARGIN;
  for (const side of [-1, 1]) {
    const pose = track.magneticPose(600, 0);
    const next = magneticAdvance(track, 600, 0, mul(pose.right, side * 10000));
    near(next.lane, side * limit); assert.equal(next.edge, true);
  }
});
test('unwrapped distance remains continuous at the closed-course seam', () => {
  const distance = track.length * 8 - 0.1, pose = track.magneticPose(distance, 0);
  const next = magneticAdvance(track, distance, 0, mul(pose.tangent, 3));
  assert.ok(next.distance > track.length * 8); assert.ok(next.distance < track.length * 8 + 4);
  assert.ok(length(sub(next.pose.point, pose.point)) < 5);
});
test('every deck face has finite axes and a constant magnetic height', () => {
  for (let i = 0; i < track.count; i++) {
    const pose = track.magneticPose((i + 0.3) * track.step, (i % 2 ? 1 : -1) * 43);
    for (const v of [pose.point, pose.up, pose.right, pose.tangent, pose.sGradient, pose.laneGradient]) assert.ok([v.x, v.y, v.z].every(Number.isFinite));
    near(dot(sub(pose.point, pose.surface), pose.up), TUNING.hoverHeight);
  }
});
test('invalid magnetic input stops instead of propagating NaN', () => {
  assert.throws(() => magneticAdvance(track, 20, 0, vec(NaN, 0, 0)), /Invalid magnetic motion/);
});
test('three-digit rank text is correct for the whole field', () => {
  assert.equal(rankText(1), '001'); assert.equal(rankText(100), '100'); assert.equal(rankText(101), '101');
});
