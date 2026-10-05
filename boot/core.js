/* GAMEBOOT/1. Dependency-free, fixed-order startup state machine. MIT. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GameBootCore = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var STAGES = [
    { id: 'B00', key: 'core', label: 'BOOT CORE', end: 5, timeout: 5000 },
    { id: 'B10', key: 'capabilities', label: 'PLATFORM CHECK', end: 15, timeout: 10000 },
    { id: 'B20', key: 'renderer', label: 'RENDER BACKEND', end: 40, timeout: 45000 },
    { id: 'B30', key: 'physics', label: 'PHYSICS ENGINE', end: 55, timeout: 30000 },
    { id: 'B40', key: 'verify', label: 'ENGINE SELF-TEST', end: 65, timeout: 45000 },
    { id: 'B50', key: 'prepare', label: 'GAME SYSTEMS', end: 85, timeout: 30000 },
    { id: 'B60', key: 'frame', label: 'FIRST FRAME', end: 97, timeout: 45000 },
    { id: 'B70', key: 'run', label: 'START GAME', end: 100, timeout: 5000 }
  ];
  function coded(code, message, cause) {
    var error = new Error(message); error.code = code;
    if (cause) error.cause = cause;
    return error;
  }
  function safeText(value, fallback) {
    try { return String(value == null ? fallback : value); } catch (_) { return fallback; }
  }
  function property(value, key, fallback) {
    try { return value && value[key] || fallback; } catch (_) { return fallback; }
  }
  function clean(error) {
    if (!error) return { name: 'Error', message: 'No error detail was supplied.', stack: '' };
    return { name: safeText(property(error, 'name', 'Error'), 'Error').slice(0, 100),
      message: safeText(property(error, 'message', error), 'Unprintable error.').slice(0, 1600),
      stack: safeText(property(error, 'stack', ''), '').slice(0, 6000) };
  }
  function checksum(text) {
    // Detect accidental payload damage. This is not a signature or a trust check.
    var h = 2166136261, i;
    for (i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }
  function Machine(options) {
    this.options = options || {};
    this.clock = this.options.clock || function () { return Date.now(); };
    this.startedAt = this.clock();
    this.state = 'IDLE'; this.stage = 'B00'; this.progress = 0;
    this.message = 'Waiting for startup.'; this.errorCode = ''; this.failure = null;
    this.issues = []; this.log = []; this.sequence = 0; this._generation = 0;
    this._started = false; this._stopped = false; this._watchdog = null;
    this.lastFrame = this.clock(); this.frames = 0;
    this.stages = STAGES.map(function (s) {
      return { id: s.id, key: s.key, label: s.label, end: s.end,
        timeout: s.timeout, status: 'WAIT', startedMs: null, durationMs: null };
    });
  }
  Machine.prototype.emit = function () {
    if (this.options.onChange) {
      try { this.options.onChange(this); } catch (_) { /* A view must not break startup. */ }
    }
  };
  Machine.prototype.record = function (status, code, message) {
    this.log.push({ n: ++this.sequence, ms: Math.max(0, this.clock() - this.startedAt),
      stage: this.stage, status: status, code: code, message: safeText(message, 'Unprintable detail.').slice(0, 1600) });
    if (this.log.length > 160) this.log.shift();
  };
  Machine.prototype.note = function (message) {
    if (this.state === 'FAIL') return;
    this.message = safeText(message, 'Unprintable detail.').slice(0, 1600); this.record('INFO', this.stage, message); this.emit();
  };
  Machine.prototype.warn = function (code, error) {
    var detail = clean(error); code = safeText(code, 'WARN').slice(0, 60);
    this.issues.push({ severity: 'warning', code: code, stage: this.stage,
      ms: this.clock() - this.startedAt, name: detail.name, message: detail.message, stack: detail.stack });
    if (this.issues.length > 80) this.issues.shift();
    this.record('WARN', code, detail.message); this.emit();
  };
  Machine.prototype.fail = function (code, error) {
    var detail = clean(error), stage = this.stage, i;
    if (this.state === 'FAIL') {
      this.warn(code || 'SECONDARY', error);
      return false; // The first failure remains the primary report.
    }
    this.errorCode = safeText(code || property(error, 'code', 'BOOT-ERR'), 'BOOT-ERR').slice(0, 60);
    this.failure = { severity: 'error', code: this.errorCode, stage: stage,
      ms: this.clock() - this.startedAt, name: detail.name, message: detail.message, stack: detail.stack };
    this.issues.push(this.failure); if (this.issues.length > 80) this.issues.shift(); this.state = 'FAIL'; this._generation++;
    this.message = detail.message;
    for (i = 0; i < this.stages.length; i++) if (this.stages[i].id === stage) {
      this.stages[i].status = 'FAIL';
      if (this.stages[i].startedMs !== null) this.stages[i].durationMs = this.failure.ms - this.stages[i].startedMs;
    }
    this.record('FAIL', this.errorCode, detail.message);
    if (!this._stopped && this.options.onStop) {
      this._stopped = true;
      try { this.options.onStop(this.failure); }
      catch (stopError) { this.warn('STOP-ERR', stopError); }
    }
    this.emit(); return false;
  };
  Machine.prototype.wait = function (operation, milliseconds, code, label) {
    var timer;
    return new Promise(function (resolve, reject) {
      timer = setTimeout(function () { reject(coded(code || 'BOOT-TIME', (label || 'Startup operation') + ' timed out.')); }, milliseconds);
      Promise.resolve(operation).then(function (value) { clearTimeout(timer); resolve(value); }, function (error) { clearTimeout(timer); reject(error); });
    });
  };
  Machine.prototype.canRun = function () {
    if (this.state === 'FAIL') return false;
    return this.stages.slice(0, -1).every(function (stage) { return stage.status === 'OK' || stage.status === 'WARN'; });
  };
  Machine.prototype.run = function (hooks) {
    var self = this;
    if (self.state === 'FAIL') return Promise.resolve(false);
    if (self._started) return Promise.reject(coded('BOOT-ONCE', 'This startup instance has already run.'));
    self._started = true; self.state = 'BOOT'; self.hooks = hooks || {};
    var generation = self._generation;
    var promise = Promise.resolve();
    self.stages.forEach(function (stage) {
      promise = promise.then(function () {
        if (self.state === 'FAIL' || generation !== self._generation) throw coded('BOOT-STOP', 'Startup was stopped.');
        self.stage = stage.id; stage.status = 'WORK'; stage.startedMs = self.clock() - self.startedAt;
        if (typeof self.hooks[stage.key] !== 'function') throw coded('HOOK-MISS', 'Missing startup hook: ' + stage.key);
        if (stage.key === 'run' && !self.canRun()) throw coded('RUN-GATE', 'A required startup check is incomplete.');
        self.message = stage.label; self.record('WORK', stage.id, stage.label); self.emit();
        // A task boundary lets the basic startup view paint before heavy work.
        return new Promise(function (resolve) { setTimeout(resolve, 0); }).then(function () {
          if (self.state === 'FAIL' || generation !== self._generation) throw coded('BOOT-STOP', 'Startup was stopped.');
          return self.wait(Promise.resolve().then(function () { return self.hooks[stage.key](self); }),
            (self.options.timeouts && self.options.timeouts[stage.id]) || stage.timeout, stage.id + '-TIME', stage.label);
        }).then(function () {
          if (self.state === 'FAIL' || generation !== self._generation) throw coded('BOOT-STOP', 'Startup was stopped.');
          stage.durationMs = self.clock() - self.startedAt - stage.startedMs;
          stage.status = self.issues.some(function (issue) { return issue.stage === stage.id && issue.severity === 'warning'; }) ? 'WARN' : 'OK';
          self.progress = stage.end; self.record(stage.status, stage.id, stage.label + ' complete.'); self.emit();
        });
      });
    });
    return promise.then(function () {
      if (!self.canRun()) throw coded('RUN-GATE', 'A required startup check is incomplete.');
      self.state = 'RUN'; self.message = 'All required systems are ready.';
      self.lastFrame = self.clock(); self.record('OK', 'RUN', self.message); self.emit(); return true;
    }).catch(function (error) {
      if (self.state !== 'FAIL') self.fail(property(error, 'code', self.stage + '-ERR'), error);
      return false;
    });
  };
  Machine.prototype.heartbeat = function () { this.lastFrame = this.clock(); this.frames++; };
  Machine.prototype.checkHeartbeat = function (visible, limit) {
    if (!visible) { this.lastFrame = this.clock(); return true; }
    if (this.state === 'RUN' && this.clock() - this.lastFrame > (limit || 15000))
      return this.fail('RUN-STALL', coded('RUN-STALL', 'No game frame was received. Reload the game.'));
    return true;
  };
  Machine.prototype.snapshot = function () {
    return JSON.parse(JSON.stringify({ protocol: 'GAMEBOOT/1', loaderVersion: '1.0.2', state: this.state,
      stage: this.stage, progress: this.progress, code: this.errorCode || this.stage,
      message: this.message, frames: this.frames, elapsedMs: this.clock() - this.startedAt,
      stages: this.stages, failure: this.failure, issues: this.issues, log: this.log }));
  };
  return { Machine: Machine, stages: STAGES, error: coded, clean: clean, checksum: checksum, version: '1.0.2' };
}));
