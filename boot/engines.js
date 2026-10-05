import { createRenderer, createPixelPass } from '../src/renderer.js';

/* Three.js r181 / Rapier 0.19.3 adapter for GAMEBOOT/1. No game imports. */
export async function selectRenderer(THREE, boot, forced = false) {
  const opts = { antialias: false, alpha: false, depth: true, stencil: false,
    outputType: THREE.UnsignedByteType, powerPreference: 'high-performance' };
  let renderer, device, live = false, disposed = false;
  const result = { renderer: null, name: '', pendingError: null,
    guard() { boot.guard(); if (disposed) throw boot.error('BOOT-STOP', 'This renderer attempt was stopped.'); },
    dispose() {
      if (disposed) return; disposed = true; live = false;
      try { renderer?.dispose(); } catch {}
      try { device?.destroy(); } catch {}
    }
  };
  boot.addCleanup(() => result.dispose());
  const wait = (p, code, label) => boot.wait(p, 10000, code, label);
  async function initialize(candidate) {
    renderer = candidate;
    const pending = renderer.init();
    try { await wait(pending, 'RND-TIME', 'Render backend initialization'); }
    catch (error) {
      // A timed-out init may still resolve. Never adopt a late candidate.
      pending.then(() => { try { candidate.dispose(); } catch {} }, () => {});
      throw error;
    }
    if (!boot.active() || disposed) { try { candidate.dispose(); } catch {} throw boot.error('BOOT-STOP', 'Startup was stopped.'); }
  }
  if (!forced && globalThis.isSecureContext && navigator.gpu) {
    boot.note('Requesting a WebGPU adapter.');
    try {
      const adapter = await wait(navigator.gpu.requestAdapter({ powerPreference:'high-performance' }), 'GPU-TIME', 'WebGPU adapter request');
      boot.guard();
      if (!adapter) throw boot.error('GPU-NO', 'No WebGPU adapter was returned.');
      const info = adapter.info || {};
      const adapterName = [info.description, info.vendor, info.architecture, info.device].filter(Boolean).join(' / ');
      boot.set('adapter', adapterName || 'WebGPU adapter name is not exposed by this browser.');
      const devicePromise = adapter.requestDevice();
      try { device = await wait(devicePromise, 'GPU-TIME', 'WebGPU device request'); }
      catch (error) { devicePromise.then(d => { try { d.destroy(); } catch {} }, () => {}); throw error; }
      boot.guard();
      await initialize(new THREE.WebGPURenderer({ ...opts, device }));
      if (!renderer.backend.isWebGPUBackend) throw boot.error('GPU-BACK', 'The requested WebGPU backend was not selected.');
      result.name = 'WEBGPU';
    } catch (error) {
      boot.warn(error.code || 'GPU-INIT', error);
      try { renderer?.dispose(); } catch {}
      try { device?.destroy(); } catch {}
      renderer = null; device = null; boot.guard();
    }
  } else if (!forced) {
    boot.warn('GPU-SKIP', new Error(globalThis.isSecureContext ? 'WebGPU is not exposed. Trying WebGL2.' : 'This context does not expose secure WebGPU. Trying WebGL2.'));
  }
  boot.guard();
  if (!renderer) {
    boot.note(forced ? 'WebGL2 was selected for this startup.' : 'Starting the WebGL2 backup.');
    const canvas = document.createElement('canvas'); // Never reuse a WebGPU canvas.
    const gl = canvas.getContext('webgl2', { antialias:false, alpha:false, depth:true, stencil:false });
    if (!gl) throw boot.error('RND-NONE', 'No working WebGPU or WebGL2 renderer was found. Check browser graphics support and hardware acceleration.');
    try {
      await initialize(new THREE.WebGPURenderer({ ...opts, forceWebGL:true, canvas, context:gl }));
      result.name = 'WEBGL2';
      try {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        boot.set('adapter', String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)));
      } catch { boot.set('adapter', 'WebGL2 adapter name is not exposed by this browser.'); }
    } catch (error) {
      result.dispose(); throw boot.error('GL-INIT', 'The WebGL2 backup could not initialize. ' + error.message, error);
    }
  }
  boot.guard();
  renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
  result.renderer = renderer; live = true;
  renderer.onDeviceLost = info => {
    if (!live || disposed) return;
    const error = boot.error(result.name === 'WEBGPU' ? 'GPU-LOST' : 'GL-LOST', info.message || 'The graphics device was lost.');
    result.pendingError = error;
    if (boot.machine.state === 'RUN' || ['B50','B60','B70'].includes(boot.machine.stage)) boot.fail(error.code, error);
    else boot.warn(error.code, error);
  };
  if (device) device.addEventListener('uncapturederror', event => {
    if (!live || disposed) return;
    result.pendingError = event.error;
    if (boot.machine.state === 'RUN' || ['B50','B60','B70'].includes(boot.machine.stage)) boot.fail('GPU-VAL', event.error);
    else boot.warn('GPU-VAL', event.error);
  });
  boot.set('renderer', result.name + ' / THREE R181');
  return result;
}

export function physicsCheck(RAPIER, boot) {
  let world;
  try {
    world = new RAPIER.World({x:0,y:-9.81,z:0}); world.timestep = 1/60;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0,2,0));
    world.createCollider(RAPIER.ColliderDesc.ball(.25), body);
    world.step();
    const position = body.translation(), velocity = body.linvel();
    if (![position.x,position.y,position.z,velocity.y].every(Number.isFinite) || !(position.y < 2) || !(velocity.y < 0))
      throw boot.error('PHY-TEST', 'The physics engine did not pass the gravity-step test.');
    return { result:'PASS', test:'dynamic body + collider + gravity step', timestep:1/60 };
  } finally { world?.free(); }
}

export async function renderCheck(THREE, critical, boot) {
  const renderer = critical.renderer;
  const pixel = createPixelPass(THREE, 16, 16);
  const output = new THREE.RenderTarget(16,16,{type:THREE.UnsignedByteType,depthBuffer:false});
  output.texture.colorSpace = THREE.LinearSRGBColorSpace;
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1,1,1,-1,.1,10);
  camera.position.z = 2;
  const geometry = new THREE.PlaneGeometry(1,1), materials = [];
  [[-.5,.5,0x00ff00],[.5,.5,0x0000ff],[-.5,-.5,0xff0000],[.5,-.5,0xffff00]].forEach(([x,y,color]) => {
    const material = new THREE.MeshBasicMaterial({color,depthTest:false,depthWrite:false,toneMapped:false});
    materials.push(material); const quad = new THREE.Mesh(geometry,material); quad.position.set(x,y,0); scene.add(quad);
  });
  const points = [[3,3],[12,3],[3,12],[12,12]];
  const samples = [];
  const mask = data => (data[0]>127 ? 1:0) | (data[1]>127 ? 2:0) | (data[2]>127 ? 4:0);
  const read = async target => {
    const result=[];
    for (const [x,y] of points) { critical.guard(); const data = await renderer.readRenderTargetPixelsAsync(target,x,y,1,1); critical.guard(); samples.push({x,y,type:data?.constructor?.name,values:Array.from(data || []).slice(0,8)}); result.push(mask(data)); }
    return result;
  };
  let scope = false;
  try {
    if (critical.pendingError) throw critical.pendingError;
    renderer.setSize(16,16,false);
    const device = renderer.backend.device;
    if (device) { device.pushErrorScope('validation'); scope = true; }
    // Set camera uniforms before precompilation. Otherwise the first draw can use an identity view matrix.
    camera.coordinateSystem=renderer.coordinateSystem; camera.updateProjectionMatrix();
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    renderer.setRenderTarget(pixel.target); await renderer.compileAsync(scene,camera); critical.guard(); renderer.render(scene,camera);
    const direct = await read(pixel.target);
    pixel.camera.coordinateSystem=renderer.coordinateSystem; pixel.camera.updateProjectionMatrix();
    pixel.scene.updateMatrixWorld(true); pixel.camera.updateMatrixWorld(true);
    renderer.setRenderTarget(output); await renderer.compileAsync(pixel.scene,pixel.camera); critical.guard(); renderer.render(pixel.scene,pixel.camera);
    const processed = await read(output);
    boot.data.tests.graphics={result:'CHECKING',direct,processed,samples};
    if (new Set(direct).size !== 4 || ![1,2,3,4].every(value=>direct.includes(value))) throw boot.error('RND-TEST','The graphics test did not return all four calibration colors.');
    if (direct.some((value,i)=>value!==processed[i])) throw boot.error('PIX-FLIP','The pixel pass did not preserve image orientation. The game was not started.');
    renderer.setRenderTarget(null); renderer.render(pixel.scene,pixel.camera);
    // Canvas capture checks the screen origin, not only render-target readback.
    let screen = 'NOT EXPOSED';
    const capture = document.createElement('canvas'); capture.width=16; capture.height=16;
    try {
      const ctx=capture.getContext('2d',{willReadFrequently:true}); ctx.drawImage(renderer.domElement,0,0);
      const values=points.map(([x,y])=>mask(ctx.getImageData(x,y,1,1).data));
      if (new Set(values).size === 4) {
        if (values.some((value,i)=>value!==[2,4,1,3][i])) throw boot.error('PIX-FLIP','The final canvas is vertically inverted. The game was not started.');
        screen='PASS';
      } else boot.warn('RND-COPY',new Error('Screen capture is unavailable. Render-target orientation passed.'));
    } catch (error) {
      if (error.code==='PIX-FLIP') throw error;
      boot.warn('RND-COPY',error);
    }
    if (device && scope) {
      const error=await device.popErrorScope(); scope=false;
      if(error) throw boot.error('GPU-VAL',error.message,error);
    }
    if (critical.pendingError) throw critical.pendingError;
    return {result:'PASS',test:'four-corner render + pixel-pass readback',direct,processed,screen};
  } finally {
    try { renderer.setRenderTarget(null); } catch {}
    if(scope) { try { renderer.backend.device.popErrorScope().catch(() => {}); } catch {} }
    for (const resource of [pixel,output,geometry,...materials]) { try { resource.dispose(); } catch {} }
  }
}
