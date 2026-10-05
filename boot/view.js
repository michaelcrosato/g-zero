/* GAMEBOOT/1 basic HTML view. Keep this script usable before engine code parses. */
(function (w, d) {
  'use strict';
  if (w.__gameBootEarlyFailure) return;
  var Core = w.GameBootCore, config;
  try {
    if (!Core || !Core.Machine) throw new Error('The boot core is missing or damaged.');
    config = JSON.parse(d.getElementById('gb-config').textContent);
    if (!config || typeof config.name !== 'string' || !config.buildId || !config.id || !config.version)
      throw new Error('The game configuration is incomplete.');
  } catch (error) { w.GameBootEmergency('CFG-ERR', error); return; }
  var root = d.getElementById('gb-root');
  if (!root || !d.getElementById('game-mount')) { w.GameBootEmergency('VIEW-ERR', new Error('The startup view is missing.')); return; }
  var pristineRoot = root.outerHTML;
  var $ = function (id) { return d.getElementById(id); };
  var platform = (w.navigator.userAgentData && w.navigator.userAgentData.platform) || w.navigator.platform || 'Not reported';
  var ua = w.navigator.userAgent;
  var match = ua.match(/(Edg|OPR|Firefox|Chrome)\/([\d.]+)/) || ua.match(/Version\/([\d.]+).*Safari/);
  var browser = match ? (match[0].indexOf('Version/') === 0 ? 'Safari ' + match[1] : match[1] + ' ' + match[2]) : 'Not reported';
  var context = { game: { id: config.id, name: config.name, version: config.version, buildId: config.buildId },
    mode: config.mode, engines: { three: '0.181.0', rapierPackage: '0.19.3' },
    platform: { name: platform, browser: browser, userAgent: w.navigator.userAgent, protocol: w.location.protocol,
      secureContext: w.isSecureContext === true, viewport: [w.innerWidth, w.innerHeight], pixelRatio: w.devicePixelRatio || 1 },
    renderer: 'Not initialized', adapter: 'Not initialized', physics: 'Not initialized', capabilities: {}, tests: {}, payloads: {} };
  var app = null, critical = null, moduleURLs = [], startGuard, cleanup = [], lastGameState = null, previousFocus = null;
  function safely(fn) { try { fn(); } catch (error) { machine.warn('STOP-ERR', error); } }
  function discard(value) { if (value && value.dispose) safely(function () { value.dispose(); }); }
  var machine = new Core.Machine({ onChange: paint, timeouts: config.mode === 'hosted' ? { B10: 60000 } : undefined, onStop: function () {
    if (app && app.getState) { try { lastGameState = app.getState(); } catch (_) {} }
    if (app && app.halt) safely(function () { app.halt(); });
    discard(app); discard(critical);
    cleanup.splice(0).forEach(function (fn) { safely(fn); });
    clearInterval(view && view._watchdog);
    moduleURLs.splice(0).forEach(function (url) { safely(function () { URL.revokeObjectURL(url); }); });
  }});
  var view = { config: config, data: context, machine: machine, hooks: null, packageBuilder: null,
    setApp: function (value) { if (machine.state === 'FAIL') { discard(value); throw Core.error('BOOT-STOP','Startup was stopped.'); } app = value; },
    setCritical: function (value) { if (machine.state === 'FAIL') { discard(value); throw Core.error('BOOT-STOP','Startup was stopped.'); } critical = value; },
    addCleanup: function (fn) { if (typeof fn !== 'function') return; if (machine.state === 'FAIL') safely(fn); else cleanup.push(fn); },
    guard: function () { if (machine.state === 'FAIL') throw Core.error('BOOT-STOP','Startup was stopped.'); },
    set: function (key, value) { if (machine.state === 'FAIL') return; context[key] = value; paint(); },
    note: function (message) { machine.note(message); }, warn: function (code, error) { machine.warn(code, error); },
    wait: function (value, ms, code, label) { return machine.wait(value, ms, code, label); },
    fail: function (code, error) { return machine.fail(code, error); },
    active: function () { return machine.state !== 'FAIL'; },
    canRun: function () { return machine.canRun(); },
    heartbeat: function () { machine.heartbeat(); },
    isOpen: function () { return !root.hidden; },
    error: Core.error, checksum: Core.checksum,
    trackURL: function (url) { if (machine.state === 'FAIL') { URL.revokeObjectURL(url); throw Core.error('BOOT-STOP','Startup was stopped.'); } moduleURLs.push(url); return url; },
    initialRoot: function () { return pristineRoot; },
    report: report, paint: paint, fullScreen: fullScreen,
    show: function () { if (app && app.pauseForDiagnostics) app.pauseForDiagnostics(); previousFocus = d.activeElement; $('game-mount').setAttribute('inert',''); $('game-mount').setAttribute('aria-hidden','true'); root.hidden = false; $('gb-close').hidden = machine.state !== 'RUN'; paint(); $('gb-copy').focus(); },
    close: function () { if (machine.state === 'RUN') { root.hidden = true; $('game-mount').setAttribute('aria-hidden','false'); $('game-mount').removeAttribute('inert'); if (previousFocus && previousFocus.isConnected) previousFocus.focus(); } }
  };
  w.GameBoot = view;
  function text(id, value) { if ($(id)) $(id).textContent = String(value); }
  function paint() {
    if (!machine) return;
    root.setAttribute('data-state', machine.state);
    text('gb-protocol', 'GAMEBOOT ' + Core.version);
    text('gb-brand', config.name); text('gb-edition', config.mode === 'offline' ? 'SINGLE FILE / OFFLINE' : 'WEB / CACHED ASSETS');
    text('gb-game-version', config.name + ' ' + config.version); text('gb-build', config.buildId);
    text('gb-browser', context.platform.browser);
    text('gb-platform', context.platform.name + ' / ' + context.platform.viewport.join(' × '));
    text('gb-context', context.platform.protocol + (context.platform.secureContext ? ' / SECURE' : ' / NOT SECURE'));
    text('gb-renderer', context.renderer); text('gb-adapter', context.adapter); text('gb-physics', context.physics);
    text('gb-stage', machine.stage + ' / ' + (machine.state === 'FAIL' ? machine.errorCode : machine.message));
    text('gb-state', machine.state === 'FAIL' ? machine.errorCode + ' / STARTUP STOPPED' : machine.state === 'RUN' ? 'RUN / SYSTEMS READY' : machine.stage + ' / ' + machine.message);
    text('gb-message', machine.state === 'FAIL' ? machine.failure.message : machine.message);
    $('gb-progress').value = machine.progress; text('gb-percent', machine.progress + '%');
    var rows = $('gb-stage-rows');
    if (!rows.childNodes.length) machine.stages.forEach(function (stage) {
      var tr = d.createElement('tr'); tr.id = 'gb-row-' + stage.id;
      for (var i = 0; i < 4; i++) tr.appendChild(d.createElement('td'));
      rows.appendChild(tr);
    });
    machine.stages.forEach(function (stage) {
      var tr = $('gb-row-' + stage.id); tr.setAttribute('data-status', stage.status);
      tr.children[0].textContent = stage.id; tr.children[1].textContent = stage.label;
      tr.children[2].textContent = stage.status;
      tr.children[3].textContent = stage.durationMs === null ? '—' : Math.round(stage.durationMs) + ' ms';
    });
    text('gb-log', machine.log.slice(-35).map(function (line) {
      return '[' + line.stage + '] ' + line.status + ' ' + line.code + ' +' + Math.round(line.ms) + ' ms / ' + line.message;
    }).join('\n'));
    if (machine.state === 'FAIL') {
      root.hidden = false; $('gb-retry').hidden = false; $('gb-webgl').hidden = !['offline', 'hosted'].includes(config.mode); $('gb-close').hidden = true;
      $('game-mount').setAttribute('aria-hidden','true'); $('game-mount').setAttribute('inert','');
      text('gb-hint', 'Startup is stopped. Capture this screen or save the report. No game loop is running.');
      if (!view._failureSaved) {
        view._failureSaved = true;
        try { w.localStorage.setItem('gameboot.last-failure.' + config.id, JSON.stringify(report())); } catch (_) { /* Optional storage. */ }
      }
    } else if (machine.state === 'RUN') {
      text('gb-hint', 'All required checks passed. The report includes any fallback or optional-feature warnings.');
      $('gb-close').hidden = false;
      if (!view._handedOff) { view._handedOff = true; view.close(); }
    }
  }
  function report() {
    var snapshot = machine.snapshot(); snapshot.game = JSON.parse(JSON.stringify(context.game));
    snapshot.diagnostics = JSON.parse(JSON.stringify(context));
    if (lastGameState) snapshot.gameState = JSON.parse(JSON.stringify(lastGameState));
    else if (app && app.getState) { try { snapshot.gameState = app.getState(); } catch (_) { /* Preserve the startup report. */ } }
    return snapshot;
  }
  function reportText() { return JSON.stringify(report(), null, 2); }
  function selectReport() {
    var area = $('gb-report-text'); area.hidden = false; area.value = reportText(); area.focus(); area.select();
    return area;
  }
  function copyReport() {
    var fallback = function () {
      selectReport();
      try { if (d.execCommand('copy')) { text('gb-feedback','Report copied.'); return; } } catch (_) {}
      text('gb-feedback','Select the report text and copy it.');
    };
    try {
      if (w.navigator.clipboard && w.navigator.clipboard.writeText) w.navigator.clipboard.writeText(reportText()).then(function () { text('gb-feedback','Report copied.'); }, fallback);
      else fallback();
    } catch (_) { fallback(); }
  }
  function downloadReport() {
    try {
      var blob = new Blob([reportText()], {type:'application/json'}), url = URL.createObjectURL(blob), a = d.createElement('a');
      a.href = url; a.download = config.id + '-' + (machine.errorCode || machine.stage) + '-report.json';
      a.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
      text('gb-feedback','The report file is ready. No data was sent.');
    } catch (_) { selectReport(); text('gb-feedback','File saving is unavailable. Copy the report text instead.'); }
  }
  function fullScreen() {
    var active = d.fullscreenElement || d.webkitFullscreenElement;
    var fn = active ? (d.exitFullscreen || d.webkitExitFullscreen) : (d.documentElement.requestFullscreen || d.documentElement.webkitRequestFullscreen);
    if (!fn) { text('gb-feedback','Native fullscreen is unavailable. The game still fills the browser window.'); return; }
    try {
      var result = fn.call(active ? d : d.documentElement);
      if (result && result.catch) result.catch(function () { text('gb-feedback','Fullscreen was denied. The game still fills the browser window.'); });
    } catch (_) { text('gb-feedback','Fullscreen was denied. The game still fills the browser window.'); }
  }
  $('gb-copy').onclick = copyReport; $('gb-save').onclick = downloadReport;
  $('gb-fullscreen').onclick = fullScreen; $('gb-close').onclick = view.close;
  $('gb-retry').onclick = function () { w.location.reload(); };
  $('gb-webgl').onclick = function () { var url = new URL(w.location.href); url.searchParams.set('renderer','webgl2'); w.location.href = url.href; };
  w.addEventListener('error', function (event) {
    if (event.target && event.target !== w && event.target.tagName !== 'SCRIPT') return;
    view.fail('JS-ERR', event.error || new Error(event.message || 'A local script could not load.'));
  });
  w.addEventListener('unhandledrejection', function (event) { view.fail('JS-REJ', event.reason || new Error('An initialization promise failed.')); });
  w.addEventListener('resize', function () { context.platform.viewport = [w.innerWidth,w.innerHeight]; if (!root.hidden) paint(); });
  d.addEventListener('visibilitychange', function () { machine.lastFrame = machine.clock(); });
  w.addEventListener('pagehide', function () {
    clearInterval(view._watchdog); clearTimeout(startGuard);
    if (app && app.halt) safely(function () { app.halt(); });
    for (var i=0;i<moduleURLs.length;i++) URL.revokeObjectURL(moduleURLs[i]);
  });
  // A bfcache restore must not leave a stopped game canvas on screen.
  w.addEventListener('pageshow', function (event) { if (event.persisted) w.location.reload(); });
  function begin() {
    if (machine.state === 'FAIL' || machine._started) return;
    if (!w.Promise || !w.Uint8Array || !w.Map || !w.Set || !Math.imul || !('noModule' in d.createElement('script'))) {
      view.fail('CAP-JS', new Error('This browser lacks required JavaScript or module support. Use a current browser.')); return;
    }
    if (view.hooks) {
      machine.run(view.hooks);
      view._watchdog = setInterval(function () { machine.checkHeartbeat(!d.hidden, 15000); }, 2000);
    } else {
      startGuard = setTimeout(function () { if (view.hooks) begin(); else if (machine.state !== 'FAIL') view.fail('CAP-ES', new Error('The startup module did not start. This browser may block local modules.')); }, 3000);
    }
  }
  paint();
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', begin, {once:true}); else begin();
}(window, document));
