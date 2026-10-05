import { TAU, clamp, lerp, mod, dampFactor, moveToward, wrapDelta, vec, add, sub, mul, dot, cross, length, normalize, mixVec, distanceSq, signedAngle, formatTime, seededRandom, SPEED_SCALE, TRACK_WIDTH, LANE_COUNT, STORAGE_KEY, RIVAL_COUNT, RACER_COUNT, START_POSITION, START_S, MAGNET_MARGIN, rankText, gridSlot, magneticAdvance, viewportSize, speedKmh, manualYaw, CONTROL_POINTS, catmull, Circuit, LapTracker, TUNING } from './core.js';
import { createArt, createScenery, pixelText } from './assets.js';
import { createPixelPass } from './renderer.js';

export async function prepareGame(THREE, RAPIER, context) {
  const { renderer, boot } = context;
  if (!renderer || !boot) throw new Error('Boot must supply initialized systems.');
  if (String(THREE.REVISION) !== '181') throw new Error(`Expected Three.js r181; received r${THREE.REVISION}.`);
  // Rapier has already passed the B30 and B40 engine checks.
  // The npm package is pinned by the loader/build. Keep the underlying WASM
  // version available for diagnostics without assuming its numbering matches npm.
  const $ = id => document.getElementById(id);
  const screen = $('screen'), hud = $('hud'), ctx = hud.getContext('2d');
  if (!ctx) throw boot.error('CAP-2D', 'The HUD needs a 2D canvas context.');
  const media = query => typeof matchMedia === 'function' ? matchMedia(query) : { matches: false };
  const reducedMotion = media('(prefers-reduced-motion: reduce)').matches;
  const stored = (() => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch { return {}; } })();
  let bestLap = typeof stored.bestLap === 'number' && stored.bestLap > 0 ? stored.bestLap : Infinity;
  const settings = { assist: stored.assist === true, muted: stored.muted === true, pixels: [320, 480, 960].includes(stored.pixels) ? stored.pixels : 480 };
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...settings, bestLap: Number.isFinite(bestLap) ? bestLap : null })); } catch { /* Privacy mode may prohibit persistence. */ }
  }
  const params = new URLSearchParams(location.search);
  // The boot loader owns backend selection and device-loss reporting.
  const backendName = renderer.backend.isWebGPUBackend ? 'WEBGPU' : 'WEBGL2';
  $('backend-readout').textContent = backendName;
  renderer.domElement.id = 'world'; renderer.domElement.setAttribute('aria-label', 'Three-dimensional hover-racing circuit');
  screen.prepend(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(65, 16 / 9, .5, 7000);
  const pixelPass = createPixelPass(THREE, 480, 270);
  let hudWidth = 480, hudHeight = 270, hudBottom = 270;
  function resizeViewport() {
    const bounds = screen.getBoundingClientRect();
    const size = viewportSize(settings.pixels, bounds.width, bounds.height);
    renderer.setSize(size.width, size.height, false);
    pixelPass.resize(size.width, size.height);
    camera.aspect = size.aspect; camera.updateProjectionMatrix();
    hudWidth = size.hudWidth; hudHeight = size.hudHeight;
    hudBottom = hudHeight - (media('(pointer:coarse)').matches ? Math.ceil(90 * hudHeight / Math.max(1, bounds.height)) : 0);
    if (hud.width !== hudWidth || hud.height !== hudHeight) {
      hud.width = hudWidth; hud.height = hudHeight; ctx.imageSmoothingEnabled = false;
    }
    $('resolution-readout').textContent = `${size.width} × ${size.height}`;
    $('pixels').value = String(settings.pixels);
  }
  function setResolution(width) { settings.pixels = width; resizeViewport(); save(); }
  setResolution(settings.pixels);

  const track = new Circuit();
  const world = new RAPIER.World({ x: 0, y: -TUNING.gravity, z: 0 });
  world.timestep = TUNING.fixedStep;
  world.integrationParameters.numSolverIterations = 8;
  world.integrationParameters.maxCcdSubsteps = 6;
  const events = new RAPIER.EventQueue(true);
  const art = createArt(THREE);
  const scenery = createScenery(THREE, RAPIER, scene, world, track, art);
  const playerGrid = gridSlot(START_POSITION, track);
  const startFrame = track.magneticPose(playerGrid.distance, playerGrid.lane);
  const V = v => new THREE.Vector3(v.x, v.y, v.z);
  const positionAt = (frame, lane = 0, height = TUNING.hoverHeight) => V(track.magneticPose(frame.s, lane, height).point);
  const startPos = V(startFrame.point);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(startPos.x, startPos.y, startPos.z)
    .setCanSleep(false).setGravityScale(0).setCcdEnabled(true).lockRotations());
  const collider = world.createCollider(RAPIER.ColliderDesc.ball(1.75).setMass(1)
    .setFriction(.05).setRestitution(.25).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
  // Share immutable resources across all 101 racers.
  const shadowGeometry = new THREE.PlaneGeometry(8.8, 5.2);
  const shadowMaterial = new THREE.MeshBasicMaterial({ map: art.shadow, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide });
  const flameMaterial = new THREE.SpriteMaterial({ map: art.flame, transparent: true, opacity: .9, depthWrite: false });
  function createVehicle(index) {
    const material = new THREE.SpriteMaterial({ map: art.shipFrames[index][3], transparent: true, alphaTest: .1, depthWrite: false, fog: true });
    const ship = new THREE.Sprite(material); ship.scale.set(11.5, 8.625, 1); scene.add(ship);
    const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
    scene.add(shadow);
    const flames = [-1, 1].map(() => {
      const flame = new THREE.Sprite(flameMaterial);
      flame.scale.set(1.8, 4.5, 1); scene.add(flame); return flame;
    });
    return { ship, shadow, flames, index };
  }
  const player = createVehicle(0);
  const rivalNames = ['SOLAR WASP', 'ROSE VECTOR', 'BLUE COMET', 'MOSS GHOST', 'NOVA HEX'];
  const randomRacer = seededRandom(10100);
  const rivals = Array.from({ length: RIVAL_COUNT }, (_, i) => {
    const gridPosition = i < START_POSITION - 1 ? i + 1 : i + 2;
    const slot = gridSlot(gridPosition, track), f = track.magneticPose(slot.distance, slot.lane), p = V(f.point);
    const rb = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x, p.y, p.z));
    const col = world.createCollider(RAPIER.ColliderDesc.ball(2.4).setFriction(.02).setRestitution(.08), rb);
    return { ...createVehicle(1 + i % (art.shipFrames.length - 1)), name: `${rivalNames[i % rivalNames.length]} ${rankText(gridPosition)}`,
      gridPosition, startDistance: slot.distance, rb, col, distance: slot.distance, lane: slot.lane, baseLane: slot.lane,
      previousDistance: slot.distance, previousLane: slot.lane,
      speed: 0, targetSpeed: (134 + randomRacer() * 27) * SPEED_SCALE, acceleration: (52 + randomRacer() * 19) * SPEED_SCALE,
      gap: Infinity, finishTime: null, frame: f, pos: p, previous: p.clone() };
  });
  world.step(events); // Populate Rapier's broad phase before the first race step.
  body.setTranslation(startPos, true); body.setLinvel({ x: 0, y: 0, z: 0 }, true);

  let mode = 'menu', resumeMode = 'racing', frame = startFrame, safeS = START_S;
  let magneticDistance = playerGrid.distance, previousMagneticDistance = magneticDistance, previousLane = playerGrid.lane;
  let tracker = new LapTracker(track.length), raceTime = 0, penalty = 0, countdown = 3.25, menuTime = 0;
  let energy = 100, boostLocked = false, boosting = false, padTimer = 0, padCooldown = 0, damageCooldown = 0;
  let speed = 0, maxSpeed = 0, steering = 0, hoverContact = true, fallTime = 0, shake = 0, toast = '', toastUntil = 0;
  let lapFlash = 0, finishPosition = 0, totalWallHits = 0, raceRecoveries = 0;
  let heading = V(startFrame.tangent), previousPosition = startPos.clone(), currentPosition = startPos.clone();
  let cameraInitialized = false, lastFrame = performance.now(), accumulator = 0, lastHUDUpdate = 0;
  const lastSurfaceNormal = V(startFrame.up), previousViewPosition = startPos.clone();
  const cameraAim = new THREE.Vector3(), cameraUp = new THREE.Vector3(0, 1, 0);
  const keys = new Set(), touch = new Set();
  const disposers = [];
  function listen(targetObject, name, callback, options) {
    targetObject.addEventListener(name, callback, options);
    disposers.push(() => targetObject.removeEventListener(name, callback, options));
  }
  const active = key => keys.has(key) || touch.has(key);
  function say(message) { $('announcer').textContent = message; }
  function message(text, seconds = 2) { toast = text; toastUntil = raceTime + seconds; say(text); }
  function clearInput() { keys.clear(); touch.clear(); document.querySelectorAll('.held').forEach(el => el.classList.remove('held')); }
  class Synth {
    constructor() { this.context = null; this.lastNote = -1; this.step = 0; }
    async unlock() {
      try {
        if (!this.context) {
          const Audio = window.AudioContext || window.webkitAudioContext;
          if (!Audio) return;
          this.context = new Audio(); this.master = this.context.createGain(); this.master.gain.value = .12;
          this.master.connect(this.context.destination);
          this.engine = this.context.createOscillator(); this.engine.type = 'sawtooth';
          this.engineFilter = this.context.createBiquadFilter(); this.engineFilter.type = 'lowpass'; this.engineFilter.frequency.value = 500;
          this.engineGain = this.context.createGain(); this.engineGain.gain.value = 0;
          this.engine.connect(this.engineFilter); this.engineFilter.connect(this.engineGain); this.engineGain.connect(this.master); this.engine.start();
        }
        if (this.context.state === 'suspended') await this.context.resume();
      } catch (error) { boot.warn('AUD-OFF', error); /* Audio does not block the race. */ }
    }
    beep(frequency, duration = .1, level = .14, type = 'square') {
      if (!this.context || settings.muted) return;
      const now = this.context.currentTime, osc = this.context.createOscillator(), gain = this.context.createGain();
      osc.type = type; osc.frequency.value = frequency; gain.gain.setValueAtTime(level, now);
      gain.gain.exponentialRampToValueAtTime(.001, now + duration);
      osc.connect(gain); gain.connect(this.master); osc.start(now); osc.stop(now + duration + .02);
      osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    }
    update(velocity, boost, running, time) {
      if (!this.context) return;
      const now = this.context.currentTime;
      this.master.gain.setTargetAtTime(settings.muted ? 0 : .12, now, .03);
      this.engineGain.gain.setTargetAtTime(running ? .08 + velocity / 1500 : 0, now, .06);
      this.engine.frequency.setTargetAtTime(34 + velocity * .52 + (boost ? 38 : 0), now, .035);
      this.engineFilter.frequency.setTargetAtTime(180 + velocity * 3.1, now, .04);
      // Original, restrained 16-step arpeggio; not sampled game music.
      const beat = Math.floor(time / .19);
      if (running && beat !== this.lastNote) {
        this.lastNote = beat;
        const notes = [52, 59, 64, 67, 52, 59, 62, 67, 48, 55, 60, 64, 50, 57, 62, 66];
        const midi = notes[beat % notes.length]; this.beep(440 * Math.pow(2, (midi - 69) / 12), .13, .08, 'triangle');
      }
    }
  }
  const audio = new Synth();
  function refreshSettings() {
    $('assist').textContent = settings.assist ? 'LIGHT ASSIST' : 'FREE STEERING';
    $('assist').setAttribute('aria-pressed', String(settings.assist));
    $('sound').textContent = settings.muted ? 'SOUND OFF' : 'SOUND ON';
    $('sound').setAttribute('aria-pressed', String(!settings.muted));
    $('best-readout').textContent = formatTime(bestLap); save();
  }
  refreshSettings();
  $('track-width').textContent = `${track.width} M / ${track.lanes} LANES`;
  $('track-length').textContent = `${(track.length / 1000).toFixed(2)} KM`;
  $('elevation-readout').textContent = `${Math.round(Math.max(...track.positions.map(p => p.y)) - Math.min(...track.positions.map(p => p.y)))} M`;

  function resetPosition(s, initialSpeed = 0, lane = playerGrid.lane) {
    const f = track.magneticPose(s, clamp(lane, -track.width / 2 + MAGNET_MARGIN, track.width / 2 - MAGNET_MARGIN)), p = V(f.point);
    magneticDistance = s; previousMagneticDistance = s; previousLane = f.offset;
    body.setTranslation(p, true); body.setLinvel(V(f.tangent).multiplyScalar(initialSpeed), true); body.resetForces(true);
    heading.copy(V(f.tangent)); lastSurfaceNormal.copy(V(f.up)); currentPosition.copy(p); previousPosition.copy(p);
    frame = f; hoverContact = true; fallTime = 0; safeS = mod(s, track.length); cameraInitialized = false;
  }
  function startRace() {
    if (!running || boot.isOpen()) return;
    clearInput(); resetPosition(playerGrid.distance); tracker = new LapTracker(track.length, playerGrid.distance, 3);
    raceTime = 0; penalty = 0; countdown = 3.25; energy = 100; speed = 0; maxSpeed = 0;
    boostLocked = false; boosting = false; padTimer = 0; padCooldown = 0; damageCooldown = 0;
    toast = ''; lapFlash = 0; totalWallHits = 0; raceRecoveries = 0; steering = 0; finishPosition = 0; announcedCount = 4;
    for (let i = 0; i < rivals.length; i++) {
      const rival = rivals[i]; rival.distance = rival.startDistance; rival.speed = 0; rival.lane = rival.baseLane;
      rival.previousDistance = rival.distance; rival.previousLane = rival.lane; rival.finishTime = null;
      rival.frame = track.magneticPose(rival.distance, rival.lane); rival.pos.copy(V(rival.frame.point)); rival.previous.copy(rival.pos);
      rival.rb.setTranslation(rival.pos, true); rival.rb.setNextKinematicTranslation(rival.pos);
    }
    mode = 'countdown'; $('stage').dataset.mode = mode; $('manual').open = false; accumulator = 0; lastFrame = performance.now();
    $('menu').hidden = true; $('pause-panel').hidden = true; $('results').hidden = true;
    $('pause').disabled = false; $('pause').textContent = 'PAUSE'; $('assist').disabled = true; $('hud').hidden = false; $('game-state').textContent = 'GRID READY';
    screen.focus({ preventScroll: true }); audio.unlock(); say('Magnetic lock active. Starting position 100 of 101. Hold W or up arrow to accelerate.');
  }
  function togglePause() {
    if (mode === 'paused') {
      mode = resumeMode; $('stage').dataset.mode = mode; $('pause-panel').hidden = true; $('pause').textContent = 'PAUSE';
      lastFrame = performance.now(); accumulator = 0; screen.focus({ preventScroll: true });
    } else if (mode === 'racing' || mode === 'countdown') {
      resumeMode = mode; mode = 'paused'; $('stage').dataset.mode = mode; clearInput(); $('pause-panel').hidden = false;
      $('pause').textContent = 'RESUME'; $('resume').focus(); say('Race paused.');
    }
  }
  function returnToMenu() {
    clearInput(); mode = 'menu'; $('stage').dataset.mode = mode; $('menu').hidden = false; $('pause-panel').hidden = true; $('results').hidden = true;
    $('hud').hidden = true; $('pause').disabled = true; $('assist').disabled = false; $('pause').textContent = 'PAUSE';
    $('game-state').textContent = 'READY TO RACE'; cameraInitialized = false; $('start').focus();
  }
  function recover() {
    if (mode !== 'racing') return;
    const oldS = frame.s;
    // Realign in place. Magnetic lock removes the need for a fall recovery.
    resetPosition(magneticDistance, 55 * SPEED_SCALE, frame.offset);
    tracker.lastS = frame.s;
    penalty += 3; energy = Math.max(28, energy - 12); padTimer = 0; boosting = false; raceRecoveries++;
    damageCooldown = 1.3; message('REALIGNED / +3 SEC', 2.4); audio.beep(180, .2);
  }
  function finishRace() {
    mode = 'finished'; $('stage').dataset.mode = mode; clearInput(); boosting = false;
    finishPosition = 1 + rivals.filter(r => r.distance > tracker.distance).length;
    $('result-place').textContent = rankText(finishPosition);
    $('result-title').textContent = finishPosition === 1 ? 'CIRCUIT CONQUERED.' : 'FINISH LINE FOUND.';
    $('result-time').textContent = formatTime(raceTime + penalty);
    $('result-best').textContent = formatTime(Math.min(...tracker.lapTimes));
    $('result-speed').textContent = `${Math.round(maxSpeed * 3.6)} KM/H`;
    $('result-laps').replaceChildren(...tracker.lapTimes.map((time, i) => {
      const row = document.createElement('div'); const label = document.createElement('span'), value = document.createElement('strong');
      label.textContent = `LAP ${i + 1}`; value.textContent = formatTime(time); row.append(label, value); return row;
    }));
    $('result-notes').textContent = `${totalWallHits} impacts · ${raceRecoveries} realignments · Magnetic lock ON · ${settings.assist ? 'Light assist' : 'Free steering'}`;
    $('results').hidden = false; $('pause').disabled = true; $('assist').disabled = false; $('game-state').textContent = 'RACE COMPLETE';
    $('again').focus(); audio.beep(784, .25); say(`Race finished. Position ${finishPosition} of ${RACER_COUNT}. Time ${formatTime(raceTime + penalty)}.`);
  }
  listen($('start'), 'click', startRace); listen($('again'), 'click', startRace); listen($('restart'), 'click', startRace);
  listen($('pause'), 'click', togglePause); listen($('resume'), 'click', togglePause);
  listen($('to-menu'), 'click', returnToMenu); listen($('results-menu'), 'click', returnToMenu);
  listen($('assist'), 'click', () => { settings.assist = !settings.assist; refreshSettings(); });
  listen($('sound'), 'click', () => { settings.muted = !settings.muted; audio.unlock(); refreshSettings(); });
  listen($('pixels'), 'change', event => setResolution(Number(event.target.value)));
  listen($('help'), 'click', () => {
    if (mode === 'racing' || mode === 'countdown') togglePause();
    $('manual').open = !$('manual').open;
  });
  listen(window, 'resize', resizeViewport);
  if (window.visualViewport) listen(window.visualViewport, 'resize', resizeViewport);
  listen(document, 'fullscreenchange', resizeViewport);
  if (typeof ResizeObserver === 'function') {
    const resizeObserver = new ResizeObserver(resizeViewport);
    resizeObserver.observe(screen); disposers.push(() => resizeObserver.disconnect());
  }
  const controlKeys = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ShiftLeft','ShiftRight','Space'];
  listen(window, 'keydown', event => {
    if (!running || boot.isOpen()) return;
    if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) return;
    if (controlKeys.includes(event.code)) event.preventDefault();
    if (event.repeat) return;
    if (event.code === 'Enter' && event.target instanceof HTMLButtonElement) return;
    if (event.code === 'Enter' && (mode === 'menu' || mode === 'finished')) startRace();
    else if (event.code === 'Escape' || event.code === 'KeyP') togglePause();
    else if (event.code === 'KeyR') recover();
    else if (event.code === 'KeyM') { settings.muted = !settings.muted; audio.unlock(); refreshSettings(); }
    else keys.add(event.code);
  });
  listen(window, 'keyup', event => keys.delete(event.code));
  listen(window, 'blur', () => { clearInput(); if (mode === 'racing' || mode === 'countdown') togglePause(); });
  listen(document, 'visibilitychange', () => { if (document.hidden) { clearInput(); if (mode === 'racing' || mode === 'countdown') togglePause(); } });
  for (const button of document.querySelectorAll('[data-control]')) {
    listen(button, 'pointerdown', event => {
      event.preventDefault(); button.setPointerCapture(event.pointerId); touch.add(button.dataset.control); button.classList.add('held');
    });
    const release = () => { touch.delete(button.dataset.control); button.classList.remove('held'); };
    listen(button, 'pointerup', release); listen(button, 'pointercancel', release); listen(button, 'lostpointercapture', release);
  }
  let announcedCount = 4;
  function inputState() {
    let steer = Number(active('ArrowLeft') || active('KeyA')) - Number(active('ArrowRight') || active('KeyD'));
    const leftAir = active('KeyQ'), rightAir = active('KeyE');
    steer += (Number(leftAir) - Number(rightAir)) * .72;
    let throttle = active('ArrowUp') || active('KeyW'), brake = active('ArrowDown') || active('KeyS');
    let boost = active('ShiftLeft') || active('ShiftRight') || active('Space');
    let airBrake = leftAir || rightAir;
    try {
      const gp = navigator.getGamepads?.()?.find(g => g && g.mapping === 'standard');
      if (gp) {
        const axis = gp.axes[0] || 0; if (Math.abs(axis) > .12) steer -= (Math.abs(axis) - .12) / .88 * Math.sign(axis);
        steer += Number(gp.buttons[14]?.pressed) - Number(gp.buttons[15]?.pressed);
        throttle ||= gp.buttons[0]?.pressed || gp.buttons[7]?.value > .2;
        brake ||= gp.buttons[6]?.value > .2;
        boost ||= gp.buttons[1]?.pressed;
        const l = gp.buttons[4]?.pressed, r = gp.buttons[5]?.pressed;
        steer += (Number(!!l) - Number(!!r)) * .72; airBrake ||= l || r;
      }
    } catch { /* Gamepad API may be disabled by embedding permissions. */ }
    return { steer: clamp(steer, -1.72, 1.72), throttle: !!throttle, brake: !!brake, boost: !!boost, airBrake: !!airBrake };
  }
  function physicsStep(dt, inputOverride = null) {
    const racing = mode === 'racing';
    const input = inputOverride || inputState();
    if (mode === 'countdown') {
      countdown -= dt;
      const count = Math.max(1, Math.ceil(countdown));
      if (count !== announcedCount) { announcedCount = count; audio.beep(440, .11); }
      if (countdown <= 0) { mode = 'racing'; $('stage').dataset.mode = mode; announcedCount = 4; audio.beep(880, .3); message('GO!', 1.5); $('game-state').textContent = 'RACE IN PROGRESS'; }
    }
    if (racing) raceTime += dt;
    previousPosition.copy(currentPosition);
    previousMagneticDistance = magneticDistance; previousLane = frame.offset;
    // The deck coordinates are authoritative, even at crossed road sections.
    // Rapier can change tangent motion on contact, but never attachment height.
    const velocity = V(body.linvel()), up = V(frame.up), tangent = V(frame.tangent);
    velocity.addScaledVector(up, -velocity.dot(up));
    heading.addScaledVector(up, -heading.dot(up)).normalize();
    if (heading.lengthSq() < .5) heading.copy(tangent);
    hoverContact = true; fallTime = 0; safeS = frame.s;
    steering = lerp(steering, racing ? input.steer : 0, dampFactor(12, dt));
    let yaw = manualYaw(steering, speed);
    if (settings.assist && hoverContact) {
      // Optional light heading correction. No centerline target or position force.
      yaw += signedAngle(heading, tangent, up) * .65 * (1 - clamp(Math.abs(input.steer), 0, 1));
    }
    if (racing) heading.applyAxisAngle(up, yaw * dt).normalize();
    const right = new THREE.Vector3().crossVectors(heading, up).normalize();
    let forwardSpeed = velocity.dot(heading), lateralSpeed = velocity.dot(right);
    padTimer = Math.max(0, padTimer - dt); padCooldown = Math.max(0, padCooldown - dt); damageCooldown = Math.max(0, damageCooldown - dt);
    if (racing && hoverContact && padCooldown === 0 && track.pads.some(pad => track.containsStrip(frame.s, frame.offset, pad))) {
      padTimer = 1.1; padCooldown = 1.4; audio.beep(620, .14); message('BOOST STRIP', .9);
    }
    if (energy <= .1) boostLocked = true;
    if (!input.boost && energy > 16) boostLocked = false;
    const energyBoost = racing && input.boost && !boostLocked && energy > 0 && speed > 25;
    boosting = racing && (energyBoost || padTimer > 0);
    if (racing) {
      energy = clamp(energy + (energyBoost ? -TUNING.boostDrain : TUNING.boostRecharge) * dt, 0, 100);
      if (hoverContact && track.containsStrip(frame.s, frame.offset, track.recharge)) energy = Math.min(100, energy + 44 * dt);
    }
    const targetSpeed = !racing ? 0 : input.brake ? 0 : boosting ? TUNING.boostSpeed : input.throttle ? TUNING.topSpeed : 0;
    let acceleration = input.brake ? TUNING.braking : boosting ? TUNING.boostAcceleration : input.throttle ? TUNING.acceleration : TUNING.coasting;
    if (input.airBrake) acceleration *= .88;
    forwardSpeed = moveToward(forwardSpeed, targetSpeed, acceleration * dt);
    lateralSpeed *= Math.exp(-(input.airBrake ? TUNING.airBrakeGrip : TUNING.lateralGrip) * dt);
    if (racing && input.airBrake) lateralSpeed -= Math.sign(input.steer) * 25 * SPEED_SCALE * dt;
    const nextVelocity = heading.clone().multiplyScalar(forwardSpeed).addScaledVector(right, lateralSpeed);
    body.setLinvel(nextVelocity, true); body.resetForces(true);

    // Same-lane spacing prevents a large field from collapsing into overlapping sprites.
    if (racing) {
      for (const laneSign of [-1, 1]) {
        const queue = rivals.filter(r => Math.sign(r.baseLane) === laneSign).sort((a, b) => mod(a.distance, track.length) - mod(b.distance, track.length));
        for (let i = 0; i < queue.length; i++) {
          const r = queue[i], ahead = queue[(i + 1) % queue.length];
          r.gap = queue.length > 1 ? mod(ahead.distance - r.distance, track.length) : Infinity;
        }
      }
    }
    for (let i = 0; i < rivals.length; i++) {
      const rival = rivals[i]; rival.previous.copy(rival.pos);
      rival.previousDistance = rival.distance; rival.previousLane = rival.lane;
      if (racing) {
        const bend = Math.abs(rival.frame.curvature);
        const target = rival.targetSpeed * clamp(1 - bend * 28, .73, 1);
        rival.speed = moveToward(rival.speed, target, rival.acceleration * dt);
        const inPad = track.pads.some(pad => track.containsStrip(mod(rival.distance, track.length), rival.lane, pad));
        const advance = Math.min(rival.speed * (inPad ? 1.22 : 1) * dt, Math.max(0, rival.gap - 12));
        rival.distance += advance;
        rival.speed = Math.min(rival.speed, advance / dt);
        rival.lane = clamp(rival.baseLane + Math.sin(raceTime * .52 + i * 1.9) * 7, -track.width / 2 + MAGNET_MARGIN, track.width / 2 - MAGNET_MARGIN);
        if (rival.finishTime === null && rival.distance >= track.length * 3) rival.finishTime = raceTime;
      }
      rival.frame = track.magneticPose(rival.distance, rival.lane); rival.pos.copy(V(rival.frame.point));
      rival.rb.setNextKinematicTranslation(rival.pos);
    }
    world.step(events);
    const displacement = sub(body.translation(), currentPosition);
    // A collision can add a normal impulse. The dual deck axes discard it.
    const locked = magneticAdvance(track, magneticDistance, frame.offset, displacement);
    magneticDistance = locked.distance;
    const newUp = V(locked.pose.up), transport = camera.quaternion.clone().setFromUnitVectors(up, newUp);
    const tangentVelocity = V(body.linvel()).addScaledVector(up, -V(body.linvel()).dot(up)).applyQuaternion(transport);
    heading.applyQuaternion(transport).normalize();
    if (tangentVelocity.length() > TUNING.boostSpeed * 1.15) tangentVelocity.setLength(TUNING.boostSpeed * 1.15);
    // Hard edge constraint: remove only outward velocity, not steering or inward motion.
    const outward = tangentVelocity.dot(V(locked.pose.right));
    if (locked.edge && outward * locked.lane > 0) tangentVelocity.addScaledVector(V(locked.pose.right), -outward);
    frame = locked.pose; safeS = frame.s;
    currentPosition.copy(V(frame.point));
    body.setTranslation(currentPosition, true); body.setLinvel(tangentVelocity, true);
    lastSurfaceNormal.copy(newUp);
    speed = Math.max(0, tangentVelocity.dot(heading)); maxSpeed = Math.max(maxSpeed, speed);
    if (locked.edge && racing && damageCooldown === 0 && nextVelocity.length() > 25) {
      damageCooldown = .42; energy = Math.max(0, energy - TUNING.railEnergyCost);
      shake = reducedMotion ? 0 : .3; totalWallHits++; audio.beep(75, .09, .2, 'sawtooth');
    }
    events.drainCollisionEvents((a, b, started) => {
      if (!started || !racing || damageCooldown > 0 || (a !== collider.handle && b !== collider.handle)) return;
      const other = a === collider.handle ? b : a;
      if (other === scenery.roadCollider.handle) return;
      damageCooldown = .42; energy = Math.max(0, energy - TUNING.railEnergyCost);
      shake = reducedMotion ? 0 : .6; totalWallHits++; audio.beep(75, .09, .35, 'sawtooth');
    });
    if (racing) {
      const completed = tracker.update(frame.s, raceTime + penalty);
      if (completed) {
        const lap = tracker.lapTimes.at(-1); const record = lap < bestLap;
        if (record) { bestLap = lap; refreshSettings(); }
        lapFlash = 2.8; audio.beep(660, .2);
        if (tracker.finished) finishRace();
        else message(`${record ? 'NEW BEST / ' : 'LAP / '}${formatTime(lap)}`, 3);
      }
    }
    shake = Math.max(0, shake - dt * 2.8); lapFlash = Math.max(0, lapFlash - dt);
  }

  const mapBounds = { minX: Math.min(...track.positions.map(p => p.x)), maxX: Math.max(...track.positions.map(p => p.x)), minZ: Math.min(...track.positions.map(p => p.z)), maxZ: Math.max(...track.positions.map(p => p.z)) };
  const mapScale = Math.min(68 / (mapBounds.maxX - mapBounds.minX), 76 / (mapBounds.maxZ - mapBounds.minZ));
  const mapPoint = p => ({ x: 18 + (p.x - mapBounds.minX) * mapScale, y: hudBottom - 96 + (p.z - mapBounds.minZ) * mapScale });
  function drawHUD() {
    ctx.clearRect(0, 0, hudWidth, hudHeight);
    if (mode === 'menu') return;
    const rank = mode === 'finished' ? finishPosition : 1 + rivals.filter(r => r.distance > tracker.distance).length;
    const center = hudWidth / 2, rightEdge = hudWidth - 16;
    const pale = '#f2eaf0', cyan = '#91f5de', pink = '#e4a4d4';
    pixelText(ctx, 'POSITION', 16, 13, 1, pink);
    pixelText(ctx, rankText(rank), 16, 26, 3, pale); pixelText(ctx, `/${RACER_COUNT}`, 76, 38, 1, pink);
    pixelText(ctx, 'MAGNET LOCK', 16, 54, 1, cyan);
    pixelText(ctx, 'LAP', center - 24, 13, 1, pink); pixelText(ctx, `${Math.min(3, tracker.laps + 1)}/3`, center - 3, 27, 2, pale, 'center');
    pixelText(ctx, formatTime(raceTime + penalty), rightEdge, 14, 2, pale, 'right');
    pixelText(ctx, `BEST ${formatTime(bestLap)}`, rightEdge, 34, 1, pink, 'right');
    if (lapFlash > 0 && tracker.lapTimes.length) pixelText(ctx, formatTime(tracker.lapTimes.at(-1)), rightEdge, 47, 1, cyan, 'right');
    ctx.fillStyle = 'rgba(24,23,46,.5)'; ctx.fillRect(11, hudBottom - 102, 68, 88);
    ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.strokeStyle = '#746483'; ctx.beginPath();
    track.positions.forEach((p, i) => { const v = mapPoint(p); if (i === 0) ctx.moveTo(v.x, v.y); else ctx.lineTo(v.x, v.y); }); ctx.closePath(); ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = '#be9ebc'; ctx.stroke();
    for (const rival of rivals) { const p = mapPoint(rival.frame.position); ctx.fillStyle = '#e5a0c8'; ctx.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 3, 3); }
    const marker = mapPoint(frame.position); ctx.fillStyle = '#1d233c'; ctx.fillRect(Math.round(marker.x) - 3, Math.round(marker.y) - 3, 7, 7);
    ctx.fillStyle = cyan; ctx.fillRect(Math.round(marker.x) - 2, Math.round(marker.y) - 2, 5, 5);
    pixelText(ctx, 'ASTRAL RING', 15, hudBottom - 111, 1, '#d4b3cc');
    pixelText(ctx, speedKmh(speed), rightEdge - 2, hudBottom - 54, 4, boosting ? cyan : pale, 'right');
    pixelText(ctx, 'KM/H', rightEdge - 1, hudBottom - 20, 1, pink, 'right');
    pixelText(ctx, boostLocked ? 'RECHARGE' : 'ENERGY', hudWidth - 119, hudBottom - 81, 1, energy < 20 ? '#ef9aa8' : cyan);
    ctx.fillStyle = '#29263f'; ctx.fillRect(hudWidth - 120, hudBottom - 70, 103, 8);
    for (let i = 0; i < 20; i++) {
      ctx.fillStyle = i < energy / 5 ? energy < 20 ? '#e09ba9' : cyan : '#55485f'; ctx.fillRect(hudWidth - 118 + i * 5, hudBottom - 68, 3, 4);
    }
    if (boosting) {
      pixelText(ctx, 'BOOST', center, hudBottom - 38, 2, cyan, 'center');
      if (!reducedMotion) {
        ctx.strokeStyle = 'rgba(149,242,229,.4)'; ctx.lineWidth = 1;
        for (let i = 0; i < 11; i++) {
          const angle = i * 2.39996, phase = mod(raceTime * 3.2 + i * .618, 1);
          const radius = 110 + phase * 185, x = Math.cos(angle), y = Math.sin(angle) * .58;
          ctx.beginPath(); ctx.moveTo(center + x * radius, hudHeight * .49 + y * radius); ctx.lineTo(center + x * (radius + 30), hudHeight * .49 + y * (radius + 30)); ctx.stroke();
        }
      }
    }
    if (mode === 'countdown') pixelText(ctx, String(Math.max(1, Math.ceil(countdown))), center, Math.round(hudHeight * .37), 8, cyan, 'center');
    if (mode === 'racing' && toastUntil > raceTime) {
      const isGo = toast === 'GO!';
      pixelText(ctx, toast, center, isGo ? Math.round(hudHeight * .37) : 65, isGo ? 5 : 1, cyan, 'center');
    }
    if (mode === 'racing' && raceTime > 2 && raceTime < 8 && speed < 10) pixelText(ctx, 'HOLD W OR UP TO ACCELERATE', center, Math.round(hudHeight * .52), 1, pale, 'center');
  }
  function placeVehicle(vehicle, pos, f, direction, turn = 0, throttle = false, turbo = false, time = 0, offset = f.offset || 0) {
    vehicle.ship.visible = true;
    vehicle.ship.position.copy(pos).addScaledVector(V(f.up), .5);
    const bankFrame = clamp(Math.round(turn * 2.1) + 3, 0, 6);
    vehicle.ship.material.map = art.shipFrames[vehicle.index][bankFrame];
    vehicle.ship.material.rotation = -f.bank * .3;
    const surface = positionAt(f, offset, .13);
    vehicle.shadow.position.copy(surface);
    vehicle.shadow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), V(f.up));
    vehicle.shadow.visible = vehicle !== player || hoverContact || mode === 'menu';
    const right = new THREE.Vector3().crossVectors(direction, V(f.up)).normalize();
    vehicle.flames.forEach((flame, i) => {
      flame.visible = throttle; flame.position.copy(pos).addScaledVector(direction, -3.5).addScaledVector(right, i ? 3.8 : -3.8).addScaledVector(V(f.up), -.7);
      flame.scale.set(turbo ? 2.6 : 1.7, (turbo ? 8 : 4) * (1 + Math.sin(time * 39 + i) * .12), 1);
      flame.material.rotation = 0;
    });
  }
  function hideVehicle(vehicle) {
    vehicle.ship.visible = false; vehicle.shadow.visible = false;
    vehicle.flames.forEach(flame => { flame.visible = false; });
  }
  function updateVisuals(dt, alpha, draw = true) {
    let viewPos, viewFrame, viewHeading, viewSpeed;
    if (mode === 'menu') {
      menuTime += dt;
      const s = 330 + menuTime * 68 * SPEED_SCALE;
      viewFrame = track.magneticPose(s, -5); viewPos = V(viewFrame.point); viewHeading = V(viewFrame.tangent); viewSpeed = 125 * SPEED_SCALE;
      placeVehicle(player, viewPos, viewFrame, viewHeading, Math.sin(menuTime * .6) * .3, true, false, menuTime);
      for (let i = 0; i < rivals.length; i++) {
        const rival = rivals[i], offsetS = 24 + Math.floor(i / 2) * 22 + (i % 2) * 4;
        if (offsetS > 650) { hideVehicle(rival); continue; }
        const f = track.magneticPose(s + offsetS, rival.baseLane), p = V(f.point);
        placeVehicle(rival, p, f, V(f.tangent), 0, true, false, menuTime);
      }
    } else {
      const blend = mode === 'paused' || mode === 'finished' ? 1 : clamp(alpha, 0, 1);
      viewFrame = track.magneticPose(lerp(previousMagneticDistance, magneticDistance, blend), lerp(previousLane, frame.offset, blend));
      viewPos = V(viewFrame.point);
      viewHeading = heading.clone(); viewSpeed = speed;
      placeVehicle(player, viewPos, viewFrame, viewHeading, steering, mode === 'racing' && speed > 10, boosting, raceTime);
      for (const rival of rivals) {
        // Distant rivals still simulate and keep their race position; only their drawing is skipped.
        if (rival.pos.distanceToSquared(viewPos) > 650 * 650) { hideVehicle(rival); continue; }
        const rf = track.magneticPose(lerp(rival.previousDistance, rival.distance, blend), lerp(rival.previousLane, rival.lane, blend));
        placeVehicle(rival, V(rf.point), rf, V(rf.tangent), 0, mode === 'racing' && rival.speed > 10, false, raceTime);
      }
    }
    const up = V(viewFrame.up);
    const desiredPos = viewPos.clone().addScaledVector(viewHeading, -23 - (boosting ? 2 : 0)).addScaledVector(up, 10.5);
    const desiredAim = viewPos.clone().addScaledVector(viewHeading, 72).addScaledVector(up, 1.3);
    const desiredUp = up.clone().lerp(new THREE.Vector3(0, 1, 0), .45).normalize();
    if (!cameraInitialized) { camera.position.copy(desiredPos); cameraAim.copy(desiredAim); cameraUp.copy(desiredUp); previousViewPosition.copy(viewPos); cameraInitialized = true; }
    if (mode !== 'paused') {
      // Track translation directly; damp only camera pose changes. At 3x speed
      // world-position damping alone would leave the camera far behind the craft.
      if (previousViewPosition.distanceToSquared(viewPos) < 300 * 300) {
        const motion = viewPos.clone().sub(previousViewPosition);
        camera.position.add(motion); cameraAim.add(motion);
      }
      camera.position.lerp(desiredPos, dampFactor(11, dt)); cameraAim.lerp(desiredAim, dampFactor(9, dt)); cameraUp.lerp(desiredUp, dampFactor(7, dt)).normalize();
      if (shake > 0) camera.position.addScaledVector(V(viewFrame.right), Math.sin(raceTime * 130) * shake * .35);
    }
    previousViewPosition.copy(viewPos);
    camera.up.copy(cameraUp); camera.lookAt(cameraAim);
    const fov = 63 + clamp(viewSpeed / TUNING.topSpeed, 0, 1) * 4 + (boosting && !reducedMotion ? 3 : 0);
    camera.fov = lerp(camera.fov, fov, dampFactor(5, dt)); camera.updateProjectionMatrix();
    if (!draw) return;
    renderer.setRenderTarget(pixelPass.target); renderer.render(scene, camera); renderer.setRenderTarget(null); renderer.render(pixelPass.scene, pixelPass.camera);
    drawHUD();
    audio.update(speed / SPEED_SCALE, boosting, mode === 'racing', raceTime);
  }
  let raf = 0, disposed = false, running = false, primed = false;
  function animate(now) {
    if (disposed || !running || !boot.active()) return;
    try {
    const dt = Math.min((now - lastFrame) / 1000, .1); lastFrame = now;
    if (mode === 'racing' || mode === 'countdown') {
      accumulator = Math.min(accumulator + dt, TUNING.fixedStep * TUNING.maxSubsteps);
      let steps = 0;
      while (accumulator >= TUNING.fixedStep && steps < TUNING.maxSubsteps && (mode === 'racing' || mode === 'countdown')) {
        physicsStep(TUNING.fixedStep); accumulator -= TUNING.fixedStep; steps++;
      }
    } else accumulator = 0;
    updateVisuals(dt, accumulator / TUNING.fixedStep);
    if (now - lastHUDUpdate > 500) {
      lastHUDUpdate = now; $('speed-accessible').textContent = `Speed ${Math.round(speed * 3.6)} kilometers per hour. Lap ${Math.min(3, tracker.laps + 1)} of 3. Position ${1 + rivals.filter(r => r.distance > tracker.distance).length} of ${RACER_COUNT}. Magnetic lock active. Energy ${Math.round(energy)} percent.`;
    }
    boot.heartbeat();
    raf = requestAnimationFrame(animate);
    } catch (error) { graphicsFailure(error); }
  }
  function graphicsFailure(error) {
    running = false; cancelAnimationFrame(raf);
    boot.fail('RUN-ERR', error);
  }
  async function prime() {
    if (!boot.active()) throw boot.error('BOOT-STOP', 'Startup was stopped.');
    // Set the real camera and sprite poses before compiling the first view.
    updateVisuals(0, 0, false);
    camera.coordinateSystem=renderer.coordinateSystem; camera.updateProjectionMatrix();
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    renderer.setRenderTarget(pixelPass.target);
    await renderer.compileAsync(scene, camera);
    if (!boot.active()) throw boot.error('BOOT-STOP', 'Startup was stopped.');
    renderer.setRenderTarget(null);
    pixelPass.camera.coordinateSystem=renderer.coordinateSystem; pixelPass.camera.updateProjectionMatrix();
    pixelPass.scene.updateMatrixWorld(true); pixelPass.camera.updateMatrixWorld(true);
    await renderer.compileAsync(pixelPass.scene, pixelPass.camera);
    if (!boot.active()) throw boot.error('BOOT-STOP', 'Startup was stopped.');
    updateVisuals(0, 0);
    const device = renderer.backend.device;
    if (device && device.queue && device.queue.onSubmittedWorkDone) await device.queue.onSubmittedWorkDone();
    if (!boot.active()) throw boot.error('BOOT-STOP', 'Startup was stopped.');
    primed = true;
  }
  function run() {
    if (!primed || !boot.canRun() || disposed) throw boot.error('RUN-GATE', 'The game cannot start before all required checks pass.');
    if (running) return;
    running = true; lastFrame = performance.now();
    $('start').disabled = false; $('game-state').textContent = 'READY TO RACE';
    boot.heartbeat(); raf = requestAnimationFrame(animate);
  }
  function halt() {
    running = false; cancelAnimationFrame(raf); clearInput();
    if (audio.context) audio.context.suspend().catch(() => {});
  }
  const api = {
    prime, run, halt,
    pauseForDiagnostics() { if (mode === 'racing' || mode === 'countdown') togglePause(); },
    versions: { three: THREE.REVISION, backend: backendName, rapierPackage: '0.19.3', rapier: typeof RAPIER.version === 'function' ? RAPIER.version() : '0.19.3' },
    getState: () => ({ mode, speed, energy, raceTime, penalty, lap: Math.min(3, tracker.laps + 1), position: { ...body.translation() },
      rank: mode === 'finished' ? finishPosition : 1 + rivals.filter(r => r.distance > tracker.distance).length,
      racerCount: RACER_COUNT, rivalCount: rivals.length, startingPosition: START_POSITION, magneticLock: true,
      clearance: dot(sub(body.translation(), frame.surface), frame.up), magneticHeight: TUNING.hoverHeight, edgeLimit: track.width / 2 - MAGNET_MARGIN,
      raceDistance: tracker.distance, visibleRivals: rivals.filter(r => r.ship.visible).length,
      s: frame.s, lateralOffset: frame.offset, hoverContact, courseLength: track.length, trackWidth: track.width, lanes: track.lanes, assist: settings.assist, backend: backendName, topSpeed: TUNING.topSpeed, boostSpeed: TUNING.boostSpeed, bestLap, wallHits: totalWallHits, recoveries: raceRecoveries }),
    getRacers: () => rivals.map(r => ({ name: r.name, gridPosition: r.gridPosition, distance: r.distance, lane: r.lane,
      speed: r.speed, position: { x: r.pos.x, y: r.pos.y, z: r.pos.z }, finishTime: r.finishTime,
      clearance: dot(sub(r.rb.translation(), r.frame.surface), r.frame.up) })),
    start: startRace, pause: togglePause, recover,
    dispose() {
      if (disposed) return;
      disposed = true; running = false; cancelAnimationFrame(raf);
      const clean=fn=>{try{fn();}catch(error){boot.warn('STOP-ERR',error);}};
      disposers.splice(0).forEach(fn=>clean(fn));
      clean(()=>pixelPass.dispose()); clean(()=>events.free()); clean(()=>world.free());
      const resources=new Set(art.textures);
      scene.traverse(object=>{if(object.geometry)resources.add(object.geometry);for(const m of Array.isArray(object.material)?object.material:[object.material])if(m)resources.add(m);});
      for(const resource of resources)clean(()=>resource.dispose());
      clean(()=>audio.context?.close().catch(()=>{})); clean(()=>renderer.domElement.remove());
      // The boot adapter owns and disposes the renderer once.
    }
  };
  if (params.has('debug')) {
    api.debug = {
      step(ticks, input = {}, followTrack = false) {
        if (!Number.isInteger(ticks) || ticks < 0 || ticks > 60000) throw new RangeError('Invalid step count.');
        cancelAnimationFrame(raf);
        const controls = { steer: 0, throttle: false, brake: false, boost: false, airBrake: false, ...input };
        let advanced = 0;
        for (let i = 0; i < ticks && (mode === 'racing' || mode === 'countdown'); i++) {
          if (followTrack) heading.copy(V(frame.tangent));
          physicsStep(TUNING.fixedStep, controls); advanced++;
        }
        accumulator = 0; lastFrame = performance.now(); cameraInitialized = false; updateVisuals(1 / 60, 1); boot.heartbeat();
        return { advanced, state: api.getState() };
      },
      place(s, lane, forward = 0, lateral = 0, normal = 0) {
        resetPosition(s, forward, lane);
        body.setLinvel(V(frame.tangent).multiplyScalar(forward).addScaledVector(V(frame.right), lateral).addScaledVector(V(frame.up), normal), true);
        tracker = new LapTracker(track.length, s, 3); speed = forward;
      },
      contactRival(index) {
        const r = rivals[index]; if (!r) throw new RangeError('Invalid rival.');
        resetPosition(r.distance - 3.5, 650, r.lane); tracker = new LapTracker(track.length, magneticDistance, 3); speed = 650;
      }
    };
    window.GZERO = api;
    window.ION = api; // Legacy debug alias for existing test scripts.
  }
  return api;
}

