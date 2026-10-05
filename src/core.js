/** Pure, dependency-free track geometry, race accounting and control math. */
export const TAU = Math.PI * 2;
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const lerp = (a, b, t) => a + (b - a) * t;
export const mod = (n, m) => ((n % m) + m) % m;
export const dampFactor = (rate, dt) => 1 - Math.exp(-rate * dt);
export const moveToward = (n, target, maxDelta) => n + clamp(target - n, -maxDelta, maxDelta);
export const wrapDelta = (a, b, length) => mod(a - b + length / 2, length) - length / 2;
export const vec = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const add = (a, b) => vec(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a, b) => vec(a.x - b.x, a.y - b.y, a.z - b.z);
export const mul = (v, s) => vec(v.x * s, v.y * s, v.z * s);
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a, b) => vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const length = v => Math.hypot(v.x, v.y, v.z);
export const normalize = v => mul(v, 1 / (length(v) || 1));
export const mixVec = (a, b, t) => add(a, mul(sub(b, a), t));
export const distanceSq = (a, b) => dot(sub(a, b), sub(a, b));
export const signedAngle = (a, b, up) => Math.atan2(dot(cross(a, b), up), clamp(dot(a, b), -1, 1));
export const formatTime = seconds => {
  if (!Number.isFinite(seconds)) return '--:--.--';
  const ticks = Math.max(0, Math.floor(seconds * 100 + 1e-6));
  return `${Math.floor(ticks / 6000).toString().padStart(2, '0')}:${Math.floor(ticks / 100 % 60).toString().padStart(2, '0')}.${(ticks % 100).toString().padStart(2, '0')}`;
};
export function seededRandom(seed = 783) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
}

export const SPEED_SCALE = 3;
export const TRACK_WIDTH = 108;
export const LANE_COUNT = 2;
// Keep the legacy key so existing magnetic-race lap records remain available.
export const STORAGE_KEY = 'ion-circuit-r181-magnetic-101-v1';
export const RIVAL_COUNT = 100;
export const RACER_COUNT = RIVAL_COUNT + 1;
export const START_POSITION = 100;
export const START_S = 10;
export const MAGNET_MARGIN = 7; // Keep the complete craft inside both track edges.
export const rankText = rank => String(rank).padStart(3, '0');

/** Two staggered columns. Position 100 has 99 opponents ahead and one behind. */
export function gridSlot(position, track) {
  if (!Number.isInteger(position) || position < 1 || position > RACER_COUNT) throw new RangeError('Invalid grid position.');
  const row = Math.floor((position - 1) / 2), column = (position - 1) % 2;
  return { distance: START_S + (Math.floor((START_POSITION - 1) / 2) - row) * 22 + (1 - column) * 4,
    lane: track.laneCenters[column] };
}

/** Project a displacement into deck coordinates. Normal impulses cannot cause flight.
 * The unwrapped distance keeps the same track section through crossings and lap seams.
 * No lane-centering or automatic yaw is applied here.
 */
export function magneticAdvance(track, distance, lane, displacement) {
  const old = track.magneticPose(distance, lane);
  const ds = dot(displacement, old.sGradient), dl = dot(displacement, old.laneGradient);
  if (![distance, lane, ds, dl].every(Number.isFinite)) throw new Error('Invalid magnetic motion.');
  const limit = track.width / 2 - MAGNET_MARGIN;
  const rawLane = lane + dl, nextLane = clamp(rawLane, -limit, limit);
  const nextDistance = distance + ds;
  return { distance: nextDistance, lane: nextLane, edge: rawLane !== nextLane,
    pose: track.magneticPose(nextDistance, nextLane) };
}

/** Keep square pixels and the camera aspect ratio at every window size. */
export function viewportSize(baseWidth, viewWidth, viewHeight) {
  if (![320, 480, 960].includes(baseWidth)) throw new RangeError('Unsupported pixel resolution.');
  const w = Math.max(1, viewWidth), h = Math.max(1, viewHeight), aspect = w / h;
  const baseHeight = Math.round(baseWidth * 9 / 16);
  const width = Math.max(baseWidth, Math.round(baseHeight * aspect));
  const height = Math.max(baseHeight, Math.round(baseWidth / aspect));
  return { width, height, aspect,
    hudWidth: Math.max(480, Math.round(270 * aspect)),
    hudHeight: Math.max(270, Math.round(480 / aspect)) };
}
export const speedKmh = speed => Math.max(0, Math.round(speed * 3.6)).toString().padStart(4, '0');

/** Manual yaw has no track position, centerline, or curvature input. */
export function manualYaw(steer, speed) {
  return steer * TUNING.yawRate * (.45 + clamp(speed / (100 * SPEED_SCALE), 0, 1) * .55);
}

// World units are meters. All control points are original, not an F-Zero course.
export const CONTROL_POINTS = [
  [0, 36, 0], [0, 36, -310], [-135, 50, -560], [-420, 100, -690],
  [-745, 147, -620], [-925, 180, -370], [-905, 219, -50],
  [-710, 180, 190], [-420, 110, 180], [-280, 72, 380],
  [-485, 88, 600], [-790, 131, 595], [-930, 72, 830],
  [-710, 43, 1050], [-330, 36, 1060], [-45, 36, 855],
  [68, 36, 530], [10, 36, 225]
].map(([x, y, z]) => vec(x, y, z));

export function catmull(points, t) {
  const count = points.length;
  const p = mod(t, 1) * count;
  const i = Math.floor(p), u = p - i;
  const a = points[mod(i - 1, count)], b = points[i % count];
  const c = points[(i + 1) % count], d = points[(i + 2) % count];
  const u2 = u * u, u3 = u2 * u;
  const out = {};
  for (const axis of ['x', 'y', 'z']) {
    out[axis] = 0.5 * (2 * b[axis] + (-a[axis] + c[axis]) * u +
      (2 * a[axis] - 5 * b[axis] + 4 * c[axis] - d[axis]) * u2 +
      (-a[axis] + 3 * b[axis] - 3 * c[axis] + d[axis]) * u3);
  }
  return out;
}

export class Circuit {
  constructor({ segments = 1100, width = TRACK_WIDTH, points = CONTROL_POINTS } = {}) {
    if (!Number.isInteger(segments) || segments < 32 || width <= 0 || points.length < 4) {
      throw new TypeError('Circuit needs at least 32 segments, a positive width, and four points.');
    }
    this.count = segments;
    this.width = width;
    this.lanes = LANE_COUNT;
    this.laneWidth = width / LANE_COUNT;
    this.laneCenters = [-width / 4, width / 4];
    const dense = [], distances = [0], resolution = segments * 10;
    for (let i = 0; i <= resolution; i++) {
      dense.push(catmull(points, i / resolution));
      if (i) distances.push(distances[i - 1] + length(sub(dense[i], dense[i - 1])));
    }
    this.length = distances.at(-1);
    this.step = this.length / segments;
    this.positions = [];
    let cursor = 0;
    for (let i = 0; i < segments; i++) {
      const s = i * this.step;
      while (cursor < resolution - 1 && distances[cursor + 1] < s) cursor++;
      const f = (s - distances[cursor]) / (distances[cursor + 1] - distances[cursor]);
      this.positions.push(mixVec(dense[cursor], dense[cursor + 1], f));
    }
    this.frames = this.positions.map((position, i) => {
      const before = this.positions[mod(i - 2, segments)];
      const after = this.positions[(i + 2) % segments];
      const tangent = normalize(sub(after, before));
      const baseRight = normalize(cross(tangent, vec(0, 1, 0)));
      const baseUp = normalize(cross(baseRight, tangent));
      const tBefore = normalize(sub(position, before));
      const tAfter = normalize(sub(after, position));
      const curvature = signedAngle(tBefore, tAfter, baseUp) / (this.step * 2);
      const bank = clamp(-curvature * 90, -0.46, 0.46);
      const right = add(mul(baseRight, Math.cos(bank)), mul(baseUp, -Math.sin(bank)));
      const up = normalize(cross(right, tangent));
      return { position, tangent, right, up, bank, curvature, s: i * this.step, index: i };
    });
    // Catmull-Rom is C1, not C2: curvature changes at its knots. Smooth banking
    // around the closed loop so a curvature jump cannot twist the wide deck abruptly.
    const rawBanks = this.frames.map(f => f.bank);
    this.frames.forEach((frame, i) => {
      let sum = 0, weightSum = 0;
      for (let offset = -36; offset <= 36; offset++) {
        const weight = Math.exp(-.5 * Math.pow(offset / 12, 2));
        sum += rawBanks[mod(i + offset, segments)] * weight; weightSum += weight;
      }
      frame.bank = sum / weightSum;
      const baseRight = normalize(cross(frame.tangent, vec(0, 1, 0)));
      const baseUp = normalize(cross(baseRight, frame.tangent));
      frame.right = add(mul(baseRight, Math.cos(frame.bank)), mul(baseUp, -Math.sin(frame.bank)));
      frame.up = normalize(cross(frame.right, frame.tangent));
    });
    this.deckFaces = this.frames.map((f, i) => {
      const n = this.frames[(i + 1) % segments], half = width / 2;
      const a = add(f.position, mul(f.right, -half)), b = add(f.position, mul(f.right, half));
      const c = add(n.position, mul(n.right, -half)), d = add(n.position, mul(n.right, half));
      const face = (origin, along, across) => {
        const sAxis = mul(along, 1 / this.step), laneAxis = mul(across, 1 / width);
        const aa = dot(sAxis, sAxis), ab = dot(sAxis, laneAxis), bb = dot(laneAxis, laneAxis);
        const determinant = aa * bb - ab * ab;
        if (determinant < 1e-10) throw new Error('The track has a degenerate deck triangle.');
        const up = normalize(cross(laneAxis, sAxis)), tangent = normalize(sAxis), right = normalize(cross(tangent, up));
        return { origin, along, across, up, right, tangent,
          sGradient: mul(sub(mul(sAxis, bb), mul(laneAxis, ab)), 1 / determinant),
          laneGradient: mul(sub(mul(laneAxis, aa), mul(sAxis, ab)), 1 / determinant) };
      };
      return [face(a, sub(c, a), sub(b, a)), face(sub(add(b, c), d), sub(d, b), sub(d, c))];
    });
    this.pads = [0.085, 0.27, 0.49, 0.76].map((fraction, i) => ({
      s: fraction * this.length, lane: this.laneCenters[i % LANE_COUNT], length: 46, width: width * (15 / 54)
    }));
    this.recharge = { s: this.length * 0.93, lane: -width * (17 / 54), length: 105, width: width * (14 / 54) };
  }
  sample(s) {
    const distance = mod(s, this.length), f = distance / this.step;
    const index = Math.floor(f) % this.count, alpha = f - Math.floor(f);
    const a = this.frames[index], b = this.frames[(index + 1) % this.count];
    const tangent = normalize(mixVec(a.tangent, b.tangent, alpha));
    const right = normalize(mixVec(a.right, b.right, alpha));
    const up = normalize(cross(right, tangent));
    return { position: mixVec(a.position, b.position, alpha), tangent,
      right: normalize(cross(tangent, up)), up, bank: lerp(a.bank, b.bank, alpha),
      curvature: lerp(a.curvature, b.curvature, alpha), s: distance, index };
  }
  magneticPose(s, lane = 0, height = TUNING.hoverHeight) {
    const distance = mod(s, this.length), progress = distance / this.step;
    const index = Math.min(this.count - 1, Math.floor(progress)), u = progress - index;
    const offset = clamp(lane, -this.width / 2, this.width / 2), v = offset / this.width + .5;
    const triangle = this.deckFaces[index][u + v <= 1 ? 0 : 1];
    const surface = add(triangle.origin, add(mul(triangle.along, u), mul(triangle.across, v)));
    const a = this.frames[index], b = this.frames[(index + 1) % this.count];
    return { position: mixVec(a.position, b.position, u), surface, point: add(surface, mul(triangle.up, height)),
      up: triangle.up, right: triangle.right, tangent: triangle.tangent,
      sGradient: triangle.sGradient, laneGradient: triangle.laneGradient,
      bank: lerp(a.bank, b.bank, u), curvature: lerp(a.curvature, b.curvature, u),
      s: distance, index, offset, height };
  }
  nearest(position, hint = null) {
    let best = { distanceSq: Infinity, index: 0, alpha: 0 };
    const inspect = i => {
      i = mod(i, this.count);
      const a = this.positions[i], b = this.positions[(i + 1) % this.count];
      const segment = sub(b, a);
      const alpha = clamp(dot(sub(position, a), segment) / dot(segment, segment), 0, 1);
      const d = distanceSq(position, mixVec(a, b, alpha));
      if (d < best.distanceSq) best = { distanceSq: d, index: i, alpha };
    };
    if (hint !== null) for (let i = hint - 26; i <= hint + 26; i++) inspect(i);
    if (hint === null || best.distanceSq > 125 * 125) {
      best.distanceSq = Infinity;
      // Full fallback is rare (initialization or recovery), and preserves 3D layer identity.
      for (let i = 0; i < this.count; i++) inspect(i);
    }
    const frame = this.sample((best.index + best.alpha) * this.step);
    const offset = sub(position, frame.position);
    return { ...frame, offset: dot(offset, frame.right), height: dot(offset, frame.up), distanceSq: best.distanceSq };
  }
  surfaceVertices(extraWidth = 0, height = 0) {
    const vertices = new Float32Array((this.count + 1) * 6);
    const indices = new Uint32Array(this.count * 6);
    for (let i = 0; i <= this.count; i++) {
      const f = this.frames[i % this.count];
      for (let j = 0; j < 2; j++) {
        const p = add(add(f.position, mul(f.right, (j ? 1 : -1) * (this.width / 2 + extraWidth))), mul(f.up, height));
        vertices.set([p.x, p.y, p.z], i * 6 + j * 3);
      }
      if (i < this.count) {
        const a = i * 2;
        indices.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
      }
    }
    return { vertices, indices };
  }
  containsStrip(s, lane, strip) {
    return Math.abs(wrapDelta(s, strip.s, this.length)) <= strip.length / 2 && Math.abs(lane - strip.lane) <= strip.width / 2;
  }
}

/** Sequential quarter-course checkpoints: oscillating across the finish cannot farm laps. */
export class LapTracker {
  constructor(courseLength, startS = 10, lapCount = 3) {
    if (!(courseLength > 0)) throw new TypeError('Positive course length required.');
    this.length = courseLength;
    this.lastS = mod(startS, courseLength);
    this.distance = startS;
    this.nextGate = (Math.floor(startS / (courseLength / 4)) + 1) * courseLength / 4;
    this.gates = Math.floor(startS / (courseLength / 4));
    this.laps = 0;
    this.lapCount = lapCount;
    this.lapTimes = [];
    this.lastLapTime = 0;
    this.finished = false;
  }
  update(s, raceTime) {
    if (this.finished) return false;
    const delta = wrapDelta(s, this.lastS, this.length);
    this.lastS = mod(s, this.length);
    // Reject implausibly large discontinuities instead of awarding skipped checkpoints.
    if (Math.abs(delta) > this.length * 0.08) return false;
    this.distance += delta;
    let completedLap = false;
    while (this.distance >= this.nextGate) {
      this.gates++;
      this.nextGate += this.length / 4;
      if (this.gates % 4 === 0) {
        this.laps++;
        this.lapTimes.push(raceTime - this.lastLapTime);
        this.lastLapTime = raceTime;
        completedLap = true;
        if (this.laps >= this.lapCount) { this.finished = true; break; }
      }
    }
    return completedLap;
  }
}

export const TUNING = Object.freeze({
  fixedStep: 1 / 240, maxSubsteps: 24, gravity: 38,
  hoverHeight: 3.4, spring: 420, springDamping: 40,
  springMin: -1440, springMax: 1890, surfaceFollowLimit: 2200,
  topSpeed: 172 * SPEED_SCALE, boostSpeed: 244 * SPEED_SCALE, acceleration: 72 * SPEED_SCALE,
  boostAcceleration: 122 * SPEED_SCALE, braking: 158 * SPEED_SCALE, coasting: 26 * SPEED_SCALE,
  lateralGrip: 13.5, airBrakeGrip: 5.4, yawRate: 3.2,
  boostDrain: 29, boostRecharge: 7, railEnergyCost: 9
});
