/** WebGPU first. Its node-based WebGL2 backend is the only fallback. */
export async function createRenderer(THREE, forceWebGL = false) {
  const make = force => new THREE.WebGPURenderer({
    antialias: false, alpha: false, depth: true, stencil: false,
    powerPreference: 'high-performance', forceWebGL: force
  });
  let renderer = make(forceWebGL);
  try {
    // r181 performs its built-in WebGL2 fallback here when WebGPU is unavailable.
    await renderer.init();
  } catch (primaryError) {
    if (forceWebGL) {
      try { renderer.dispose(); } catch { /* Keep the useful startup error. */ }
      throw primaryError;
    }
    console.warn('Primary renderer initialization failed. Trying WebGL2.', primaryError);
    try { renderer.dispose(); } catch { /* Partial initialization may have no resources. */ }
    // Use a new canvas: a canvas that acquired WebGPU cannot acquire WebGL2.
    renderer = make(true);
    try { await renderer.init(); }
    catch (fallbackError) {
      try { renderer.dispose(); } catch { /* Keep the useful startup error. */ }
      throw new Error(`WebGPU and WebGL2 initialization failed. ${fallbackError.message}`, { cause: primaryError });
    }
  }
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  return renderer;
}

/** The same TSL graph compiles to WGSL or GLSL on the selected backend. */
export function createPixelPass(THREE, width, height) {
  const { texture, uv, uniform, floor, mod, vec4, sRGBTransferOETF, sRGBTransferEOTF } = THREE.TSL;
  const target = new THREE.RenderTarget(width, height, {
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    type: THREE.UnsignedByteType, depthBuffer: true, stencilBuffer: false, samples: 0
  });
  target.texture.generateMipmaps = false;
  target.texture.colorSpace = THREE.LinearSRGBColorSpace;
  const resolution = uniform(new THREE.Vector2(width, height));
  const p = floor(uv().mul(resolution));
  // Bayer 4x4: 0 8 2 10 / 12 4 14 6 / 3 11 1 9 / 15 7 13 5.
  const b2 = (x, y) => x.mul(2).add(y.mul(3)).sub(x.mul(y).mul(4));
  const fine = b2(mod(p.x, 2), mod(p.y, 2));
  const coarse = b2(mod(floor(p.x.div(2)), 2), mod(floor(p.y.div(2)), 2));
  const dither = fine.mul(4).add(coarse).div(16).sub(.5).mul(.5);
  const linear = texture(target.texture, uv()).rgb.max(0);
  const encoded = sRGBTransferOETF(linear).clamp(0, 1);
  const quantized = encoded.mul(31).add(.5).add(dither).floor().div(31).clamp(0, 1);
  const material = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false, fog: false, toneMapped: false });
  // Return linear color. The renderer applies the final output transfer once.
  material.fragmentNode = vec4(sRGBTransferEOTF(quantized), 1);
  const scene = new THREE.Scene();
  // r181 render textures use top-left UVs. QuadMesh supplies that convention.
  // PlaneGeometry supplies the opposite Y direction and inverted the old view.
  const quad = new THREE.QuadMesh(material);
  const camera = quad.camera;
  quad.frustumCulled = false;
  scene.add(quad);
  return {
    target, scene, camera,
    resize(w, h) { target.setSize(w, h); resolution.value.set(w, h); },
    dispose() { target.dispose(); material.dispose(); /* QuadMesh geometry is a shared library object. */ }
  };
}
