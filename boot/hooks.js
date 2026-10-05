// Do not run a coordinator after an early boot failure.
if (window.GameBoot && !window.__gameBootEarlyFailure) {
  /* GAMEBOOT/1 adapter. This small coordinator runs before engine or game imports. */
  const boot = window.GameBoot;
  let THREE, RAPIER, engine, critical, app;
  const sources = new Map();
  const hostedPayloads = new Map();
  async function loadHostedPayloads() {
    const controller = new AbortController();
    boot.addCleanup(() => controller.abort());
    await Promise.all(
      ['three-core', 'three-webgpu', 'rapier', 'engines', 'game'].map(
        async (name) => {
          const element = document.getElementById('gb-payload-' + name);
          if (!element)
            throw boot.error(
              'PKG-MISS',
              'The ' + name + ' payload descriptor is missing.',
            );
          let data;
          try {
            data = JSON.parse(element.textContent);
          } catch (error) {
            throw boot.error(
              'PKG-DATA',
              'The ' + name + ' payload descriptor is damaged.',
              error,
            );
          }
          if (
            !data ||
            typeof data.url !== 'string' ||
            !/^\/assets\/[a-z-]+-[a-f0-9]{16}\.mjs$/.test(data.url)
          )
            throw boot.error(
              'PKG-URL',
              'The ' + name + ' payload must use a local hashed asset URL.',
            );
          try {
            const response = await fetch(data.url, {
              signal: controller.signal,
              credentials: 'same-origin',
              redirect: 'error',
            });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            data.source = await response.text();
          } catch (error) {
            throw boot.error(
              'PKG-NET',
              'The ' +
                name +
                ' payload could not load. Check the connection and reload. ' +
                error.message,
              error,
            );
          }
          boot.guard();
          hostedPayloads.set(name, data);
        },
      ),
    );
  }
  function payload(name) {
    if (sources.has(name)) return sources.get(name);
    const element = document.getElementById('gb-payload-' + name);
    if (!element)
      throw boot.error(
        'PKG-MISS',
        'The embedded ' + name + ' payload is missing.',
      );
    let data;
    try {
      data = hostedPayloads.get(name) || JSON.parse(element.textContent);
    } catch (error) {
      throw boot.error(
        'PKG-DATA',
        'The ' + name + ' payload is damaged.',
        error,
      );
    }
    if (!data || !data.source || typeof data.source !== 'string')
      throw boot.error(
        'PKG-MISS',
        'The ' +
          name +
          ' engine is not embedded. Obtain a complete copy of the game file.',
      );
    const expected =
      name === 'rapier'
        ? '0.19.3'
        : name.startsWith('three-')
          ? '0.181.0'
          : boot.config.version;
    if (data.version !== expected)
      throw boot.error(
        'PKG-VER',
        'The ' + name + ' payload has the wrong version.',
      );
    if (data.checksum !== boot.checksum(data.source))
      throw boot.error(
        'PKG-HASH',
        'The ' +
          name +
          ' payload checksum does not match. Obtain a new copy of the game.',
      );
    boot.data.payloads[name] = {
      checksum: data.checksum,
      bytes: data.bytes,
      version: data.version || 'game build',
    };
    sources.set(name, data.source);
    return data.source;
  }
  function moduleURL(source) {
    return boot.trackURL(
      URL.createObjectURL(new Blob([source], { type: 'text/javascript' })),
    );
  }
  async function localModule(name) {
    boot.guard();
    const module = await import(moduleURL(payload(name)));
    boot.guard();
    return module;
  }
  boot.hooks = {
    core() {
      boot.note('Boot core ready. Engine and game payloads are inactive.');
      if (!['offline', 'hosted'].includes(boot.config.mode))
        throw boot.error(
          'PKG-MODE',
          'This game build has an unsupported delivery mode.',
        );
    },
    async capabilities() {
      const required = {
        wasm: typeof WebAssembly === 'object',
        blobModules:
          typeof Blob === 'function' &&
          typeof URL.createObjectURL === 'function',
        animationFrame: typeof requestAnimationFrame === 'function',
        modernArrays: typeof [].at === 'function',
      };
      boot.data.capabilities = {
        ...required,
        canvas2D: false,
        webgpuExposed: !!navigator.gpu,
        webgl2Exposed: typeof WebGL2RenderingContext !== 'undefined',
        fullscreen: !!(
          document.documentElement.requestFullscreen ||
          document.documentElement.webkitRequestFullscreen
        ),
        audio: !!(window.AudioContext || window.webkitAudioContext),
        gamepad: typeof navigator.getGamepads === 'function',
        touch: (navigator.maxTouchPoints || 0) > 0,
        resizeObserver: typeof ResizeObserver === 'function',
        storage: false,
      };
      if (!required.wasm)
        throw boot.error(
          'CAP-WASM',
          'WebAssembly is required for the physics engine.',
        );
      if (
        !required.blobModules ||
        !required.animationFrame ||
        !required.modernArrays
      )
        throw boot.error(
          'CAP-ES',
          'This browser lacks a required JavaScript feature. Use a current browser.',
        );
      const canvas = document.createElement('canvas');
      if (!canvas.getContext('2d'))
        throw boot.error(
          'CAP-2D',
          'A 2D canvas is required for the HUD and pixel artwork.',
        );
      boot.data.capabilities.canvas2D = true;
      try {
        await WebAssembly.compile(
          new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
        );
      } catch (error) {
        throw boot.error(
          'WASM-BLOCK',
          'WebAssembly compilation is blocked in this browser context.',
          error,
        );
      }
      boot.guard();
      const key = 'gameboot.probe.' + boot.config.id;
      try {
        const previous = localStorage.getItem(key);
        localStorage.setItem(key, '1');
        if (previous === null) localStorage.removeItem(key);
        else localStorage.setItem(key, previous);
        boot.data.capabilities.storage = true;
      } catch (error) {
        boot.warn(
          'SAVE-OFF',
          new Error('Local records are unavailable. The race can still run.'),
        );
      }
      if (!boot.data.capabilities.audio)
        boot.warn(
          'AUD-OFF',
          new Error('Audio is unavailable. The race can run without sound.'),
        );
      if (!boot.data.capabilities.fullscreen)
        boot.warn(
          'FS-OFF',
          new Error(
            'Native fullscreen is unavailable. The game will fill the browser window.',
          ),
        );
      if (boot.config.mode === 'hosted') {
        if (
          typeof fetch !== 'function' ||
          typeof AbortController !== 'function'
        )
          throw boot.error(
            'CAP-ES',
            'This browser cannot load the hosted game assets. Use a current browser.',
          );
        boot.note('Loading game assets from this site.');
        await loadHostedPayloads();
      }
      for (const name of [
        'three-core',
        'three-webgpu',
        'rapier',
        'engines',
        'game',
      ])
        payload(name);
      boot.note('Required platform features and payload checks passed.');
    },
    async renderer() {
      boot.note('Loading embedded Three.js r181.');
      const coreURL = moduleURL(payload('three-core'));
      const gpuSource = payload('three-webgpu').replace(
        /(["'])\.\/three\.core(?:\.min)?\.js\1/g,
        JSON.stringify(coreURL),
      );
      THREE = await import(moduleURL(gpuSource));
      boot.guard();
      if (String(THREE.REVISION) !== '181')
        throw boot.error(
          'VER-THREE',
          'Expected Three.js r181. The embedded engine reports r' +
            THREE.REVISION +
            '.',
        );
      engine = await localModule('engines');
      critical = await engine.selectRenderer(
        THREE,
        boot,
        new URLSearchParams(location.search).get('renderer') === 'webgl2',
      );
      boot.setCritical(critical);
    },
    async physics() {
      boot.note(
        'Initializing embedded Rapier 0.19.3 and its WebAssembly module.',
      );
      const module = await localModule('rapier');
      RAPIER = module.default || module;
      if (
        typeof RAPIER.init !== 'function' ||
        typeof RAPIER.World !== 'function'
      )
        throw boot.error(
          'VER-RAPIER',
          'The embedded Rapier module has an invalid interface.',
        );
      try {
        await RAPIER.init();
        boot.guard();
      } catch (error) {
        throw boot.error(
          'PHY-INIT',
          'The physics engine could not initialize. ' + error.message,
          error,
        );
      }
      boot.data.engines.rapierWasm =
        typeof RAPIER.version === 'function' ? RAPIER.version() : 'Not exposed';
      if (boot.data.engines.rapierWasm !== '0.19.3')
        throw boot.error(
          'VER-RAPIER',
          'Expected Rapier 0.19.3. The embedded engine reports ' +
            boot.data.engines.rapierWasm +
            '.',
        );
      boot.set(
        'physics',
        'RAPIER 0.19.3 / WASM ' + boot.data.engines.rapierWasm,
      );
    },
    async verify() {
      boot.note('Testing physics and the four-corner image orientation.');
      boot.data.tests.physics = engine.physicsCheck(RAPIER, boot);
      try {
        boot.data.tests.graphics = await boot.wait(
          engine.renderCheck(THREE, critical, boot),
          12000,
          'RND-TIME',
          'Graphics self-test',
        );
      } catch (error) {
        if (critical.name !== 'WEBGPU' || !boot.active()) throw error;
        boot.warn(error.code || 'GPU-TEST', error);
        const old = critical;
        old.dispose();
        critical = await engine.selectRenderer(THREE, boot, true);
        boot.setCritical(critical);
        boot.data.tests.graphics = await boot.wait(
          engine.renderCheck(THREE, critical, boot),
          12000,
          'RND-TIME',
          'WebGL2 graphics self-test',
        );
      }
      boot.guard();
      boot.note('Required engine tests passed. The pixel pass is upright.');
    },
    async prepare() {
      boot.note('Mounting the game UI and preparing the circuit.');
      const rawView = document
        .getElementById('gb-game-view')
        .textContent.trim();
      if (boot.checksum(rawView) !== boot.config.viewChecksum)
        throw boot.error('PKG-HASH', 'The game view is damaged.');
      const view = JSON.parse(rawView);
      const style = document.createElement('style');
      style.textContent = view.css;
      style.dataset.gbRuntime = 'style';
      document.head.appendChild(style);
      const mount = document.getElementById('game-mount');
      mount.innerHTML = view.html;
      const game = await localModule('game');
      if (!boot.active()) throw boot.error('BOOT-STOP', 'Startup was stopped.');
      boot.addCleanup(game.setupDisplayControls());
      document.getElementById('diagnostics').onclick = () => boot.show();
      app = await game.prepareGame(THREE, RAPIER, {
        renderer: critical.renderer,
        boot,
      });
      boot.setApp(app);
    },
    async frame() {
      boot.note('Compiling game shaders and drawing the first frame.');
      const device = critical.renderer.backend.device;
      let scope = false;
      try {
        if (device) {
          device.pushErrorScope('validation');
          scope = true;
        }
        await app.prime();
        boot.guard();
        if (device) {
          const error = await device.popErrorScope();
          scope = false;
          if (error) throw boot.error('GPU-FRAME', error.message, error);
        }
        if (critical.pendingError) throw critical.pendingError;
        boot.guard();
        boot.data.tests.firstFrame = { result: 'PASS', gameLoopStarted: false };
      } finally {
        if (scope) {
          try {
            await device.popErrorScope();
          } catch {}
        }
      }
    },
    run() {
      if (!boot.canRun())
        throw boot.error('RUN-GATE', 'Startup checks are incomplete.');
      app.run();
    },
  };
}
