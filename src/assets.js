import { Circuit, add, mul, seededRandom, clamp, mod } from './core.js';

/** All artwork is drawn procedurally; no external art, fonts, or Nintendo assets. */
export function createArt(THREE) {
  const textures = [];
  function texture(w, h, paint, repeat = false) {
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false; paint(ctx, w, h);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.magFilter = THREE.NearestFilter; map.minFilter = THREE.NearestFilter;
    map.generateMipmaps = false;
    if (repeat) map.wrapS = map.wrapT = THREE.RepeatWrapping;
    textures.push(map); return map;
  }
  const road = texture(128, 128, (c, w, h) => {
    c.fillStyle = '#62677f'; c.fillRect(0, 0, w, h);
    const random = seededRandom(6), colors = ['#6b7186', '#5e6278', '#73788a', '#595e76'];
    for (let i = 0; i < 1350; i++) {
      c.fillStyle = colors[Math.floor(random() * colors.length)];
      c.fillRect(Math.floor(random() * w / 2) * 2, Math.floor(random() * h / 2) * 2, 2, 2);
    }
    c.fillStyle = '#e9dce8'; c.fillRect(2, 0, 2, h); c.fillRect(124, 0, 2, h);
    // One dashed center line divides the road into exactly two lanes.
    c.fillStyle = '#c8c6d2'; c.fillRect(63, 4, 2, 31); c.fillRect(63, 68, 2, 31);
    c.fillStyle = '#727a90'; c.fillRect(7, 0, 2, h); c.fillRect(119, 0, 2, h);
    c.fillStyle = '#44475e'; c.fillRect(0, 126, w, 2);
  }, true);
  const ground = texture(64, 64, c => {
    c.fillStyle = '#422b53'; c.fillRect(0, 0, 64, 64);
    c.fillStyle = '#483058'; c.fillRect(0, 0, 32, 32); c.fillRect(32, 32, 32, 32);
    c.fillStyle = '#51365e'; c.fillRect(0, 0, 64, 1); c.fillRect(0, 0, 1, 64);
    c.fillStyle = '#624166'; c.fillRect(0, 0, 2, 2); c.fillRect(32, 32, 2, 2);
  }, true); ground.repeat.set(130, 130);
  const boost = texture(32, 64, c => {
    c.fillStyle = '#18374f'; c.fillRect(0, 0, 32, 64);
    c.fillStyle = '#71ffdf'; c.fillRect(0, 0, 2, 64); c.fillRect(30, 0, 2, 64);
    for (let y = -16; y < 64; y += 22) {
      c.fillStyle = '#44ecca';
      for (let x = 4; x < 28; x += 2) c.fillRect(x, y + Math.abs(x - 15) * 0.65, 2, 7);
      c.fillStyle = '#d9fff0'; c.fillRect(14, y, 4, 5);
    }
  });
  const recharge = texture(32, 64, c => {
    c.fillStyle = '#562f74'; c.fillRect(0, 0, 32, 64);
    c.fillStyle = '#e7a9ff'; c.fillRect(0, 0, 2, 64); c.fillRect(30, 0, 2, 64);
    c.fillStyle = '#ac69ce'; for (let y = 2; y < 64; y += 8) c.fillRect(3, y, 26, 4);
  });
  const checkers = texture(64, 16, c => {
    for (let y = 0; y < 16; y += 4) for (let x = 0; x < 64; x += 4) {
      c.fillStyle = (x / 4 + y / 4) % 2 ? '#21243a' : '#e9f6ef'; c.fillRect(x, y, 4, 4);
    }
  });
  const sky = texture(512, 288, (c, w, h) => {
    const bands = ['#1d1839', '#27203e', '#322546', '#422c50', '#573958', '#724966', '#905977', '#ae6d88', '#c28b99', '#d4aaa8'];
    bands.forEach((color, i) => { c.fillStyle = color; c.fillRect(0, i * 17, w, 18); });
    c.fillStyle = '#bd91a0'; c.fillRect(0, 170, w, h - 170);
    const random = seededRandom(34);
    c.fillStyle = '#aa89a5';
    for (let i = 0; i < 75; i++) c.fillRect(Math.floor(random() * w), Math.floor(random() * 66), 1, 1);
    c.save(); c.beginPath(); c.arc(378, 101, 34, 0, Math.PI * 2); c.clip();
    c.fillStyle = '#f9d3a3'; c.fillRect(339, 64, 78, 40);
    c.fillStyle = '#efb8a6'; c.fillRect(339, 104, 78, 40);
    c.fillStyle = '#ae6d88'; for (let i = 0; i < 5; i++) c.fillRect(339, 108 + i * 7, 78, 2 + i);
    c.restore();
    c.fillStyle = '#8b6a8d'; c.beginPath(); c.moveTo(0, 166);
    for (let x = 0; x <= w; x += 10) c.lineTo(x, 137 + Math.sin(x * 0.022) * 15 - random() * 15);
    c.lineTo(w, 224); c.lineTo(0, 224); c.fill();
    c.fillStyle = '#725577';
    for (let x = 0; x < w; x += 6 + Math.floor(random() * 10)) {
      const bh = 8 + Math.floor(random() * 36), bw = 4 + Math.floor(random() * 8);
      c.fillRect(x, 168 - bh, bw, bh + 90);
      if (random() > .65) c.fillRect(x + 2, 161 - bh, 1, 8);
      c.fillStyle = '#cc9bad';
      if (bh > 27) { c.fillRect(x + 2, 171 - bh, 1, 2); c.fillRect(x + 2, 178 - bh, 1, 1); }
      c.fillStyle = '#725577';
    }
    c.fillStyle = '#7b5a7e'; c.fillRect(0, 188, w, h - 188);
  });
  function ship(color = '#84f3e0', shade = '#2992a0') {
    const frames = [];
    for (let bank = -3; bank <= 3; bank++) {
      frames.push(texture(64, 48, c => {
        const poly = (pts, fill) => {
          c.fillStyle = fill; c.beginPath();
          pts.forEach(([x, y], i) => {
            x = Math.round(32 + (x - 32) * (1 - Math.abs(bank) * .035));
            y = Math.round(16 + (y - 5) * .66 + (x - 32) * bank * .055);
            if (i) c.lineTo(x, y); else c.moveTo(x, y);
          }); c.closePath(); c.fill();
        };
        poly([[28,5],[36,5],[41,15],[43,25],[53,27],[61,38],[61,43],[42,41],[39,35],[25,35],[22,41],[3,43],[3,38],[11,28],[21,25],[23,15]], '#121e3b');
        poly([[26,14],[29,7],[35,7],[39,15],[41,31],[23,31]], shade);
        poly([[29,7],[34,7],[36,18],[28,18]], '#daf6ea');
        poly([[27,18],[37,18],[38,29],[26,29]], '#172b51');
        poly([[29,20],[35,20],[36,26],[28,26]], '#79a8d4');
        poly([[27,28],[38,28],[38,32],[25,32]], color);
        poly([[22,27],[23,33],[20,38],[6,40],[13,30]], color);
        poly([[41,27],[50,30],[58,40],[44,38],[40,33]], color);
        poly([[15,31],[21,29],[19,36],[10,38]], '#e5d6f2');
        poly([[43,29],[49,31],[54,38],[46,36]], '#e5d6f2');
        poly([[5,40],[20,38],[21,40],[5,42]], shade);
        poly([[44,38],[59,40],[59,42],[43,40]], shade);
        poly([[28,30],[36,30],[37,35],[26,35]], '#d559a9');
        poly([[9,38],[16,37],[17,40],[8,41]], '#282844');
        poly([[48,37],[55,38],[56,41],[47,40]], '#282844');
        poly([[11,39],[15,38],[15,41],[10,42]], '#ffcd9d');
        poly([[49,38],[53,39],[54,42],[49,41]], '#ffcd9d');
      }));
    }
    return frames;
  }
  const shipFrames = [ship(), ship('#f1d371', '#b4794e'), ship('#ed91ad', '#965184'), ship('#93acf1', '#526ea2'), ship('#c6e79c', '#6a9776'), ship('#c6a2f3', '#7651a3')];
  const flame = texture(16, 32, c => {
    c.fillStyle = '#6944be'; c.fillRect(2, 0, 12, 13); c.fillRect(4, 13, 8, 9); c.fillRect(6, 22, 4, 9);
    c.fillStyle = '#76e6ff'; c.fillRect(4, 0, 8, 14); c.fillRect(6, 14, 4, 8);
    c.fillStyle = '#f0ffff'; c.fillRect(6, 0, 4, 12);
  });
  const shadow = texture(32, 16, c => {
    c.fillStyle = 'rgba(16,17,40,0.48)'; c.beginPath(); c.ellipse(16, 8, 15, 6, 0, 0, Math.PI * 2); c.fill();
  });
  return { texture, textures, road, ground, boost, recharge, checkers, sky, shipFrames, flame, shadow };
}

export function createScenery(THREE, RAPIER, scene, world, track, art) {
  scene.background = art.sky;
  scene.fog = new THREE.Fog(0x846783, 490, 1850);
  const materials = [], geometries = [];
  const basic = options => { const m = new THREE.MeshBasicMaterial(options); materials.push(m); return m; };
  function geometry(vertices, indices, uvs, colors) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    if (indices) g.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
    if (uvs) g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.computeVertexNormals(); g.computeBoundingSphere(); geometries.push(g); return g;
  }
  const roadMesh = track.surfaceVertices();
  const uvs = [];
  for (let i = 0; i <= track.count; i++) uvs.push(0, i * track.step / 52, 1, i * track.step / 52);
  scene.add(new THREE.Mesh(geometry(roadMesh.vertices, roadMesh.indices, uvs), basic({ map: art.road, side: THREE.DoubleSide })));
  const roadCollider = world.createCollider(RAPIER.ColliderDesc.trimesh(roadMesh.vertices, roadMesh.indices).setFriction(0.08).setRestitution(0.05));
  function strip(s, distance, width, lane, height, map) {
    const verts = [], uv = [], idx = [], steps = Math.max(2, Math.ceil(distance / 4));
    for (let i = 0; i <= steps; i++) {
      const f = track.sample(s - distance / 2 + distance * i / steps);
      for (const side of [-1, 1]) {
        const p = add(add(f.position, mul(f.right, lane + side * width / 2)), mul(f.up, height));
        verts.push(p.x, p.y, p.z); uv.push((side + 1) / 2, i / steps);
      }
      if (i < steps) { const a = 2 * i; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const mesh = new THREE.Mesh(geometry(verts, idx, uv), basic({ map, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    scene.add(mesh); return mesh;
  }
  for (const pad of track.pads) strip(pad.s, pad.length, pad.width, pad.lane, .07, art.boost);
  const re = track.recharge; strip(re.s, re.length, re.width, re.lane, .08, art.recharge);
  strip(0, 9, track.width, 0, .09, art.checkers);
  const wallColliders = [];
  for (const side of [-1, 1]) {
    const verts = [], colors = [], idx = [], cap = [], capIdx = [], capColors = [];
    const coral = new THREE.Color('#d67eac'), white = new THREE.Color('#e9ddd7');
    const dark = new THREE.Color('#705678'), cyan = new THREE.Color('#90f3de');
    for (let i = 0; i < track.count; i++) {
      const f = track.frames[i], next = track.frames[(i + 1) % track.count];
      const base = add(f.position, mul(f.right, side * (track.width / 2 + .3)));
      const end = add(next.position, mul(next.right, side * (track.width / 2 + .3)));
      const top = add(base, mul(f.up, 3.4)), endTop = add(end, mul(next.up, 3.4));
      const color = Math.floor(i / 3) % 2 ? coral : white;
      for (const [p, col] of [[base, dark], [end, dark], [top, color], [endTop, color]]) {
        verts.push(p.x, p.y, p.z); colors.push(col.r, col.g, col.b);
      }
      const a = i * 4; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      for (const p of [top, endTop, add(top, mul(f.right, side * 1.5)), add(endTop, mul(next.right, side * 1.5))]) {
        cap.push(p.x, p.y, p.z); capColors.push(cyan.r, cyan.g, cyan.b);
      }
      capIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    scene.add(new THREE.Mesh(geometry(verts, idx, null, colors), basic({ vertexColors: true, side: THREE.DoubleSide })));
    scene.add(new THREE.Mesh(geometry(cap, capIdx, null, capColors), basic({ vertexColors: true, side: THREE.DoubleSide })));
    wallColliders.push(world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(verts), new Uint32Array(idx)).setFriction(.04).setRestitution(.3)));
  }
  // Dark underslung deck: the road is a bridge in real 3D, not an infinite flat plane.
  const under = track.surfaceVertices(1.8, -3.5);
  scene.add(new THREE.Mesh(geometry(under.vertices, under.indices), basic({ color: 0x363548, side: THREE.DoubleSide })));
  const groundGeo = new THREE.PlaneGeometry(18000, 18000);
  geometries.push(groundGeo);
  const floor = new THREE.Mesh(groundGeo, basic({ map: art.ground }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -28; scene.add(floor);
  const random = seededRandom(42);
  const pillarGeo = new THREE.BoxGeometry(1, 1, 1); geometries.push(pillarGeo);
  const pillarCount = Math.floor(track.length / 100);
  const pillars = new THREE.InstancedMesh(pillarGeo, basic({ color: 0x54425d }), pillarCount);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < pillarCount; i++) {
    const f = track.sample(i * 100), h = f.position.y + 26;
    dummy.position.set(f.position.x, -28 + h / 2, f.position.z); dummy.scale.set(11, h, 11);
    dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); pillars.setMatrixAt(i, dummy.matrix);
  } scene.add(pillars);
  const towers = new THREE.InstancedMesh(pillarGeo, basic({ color: 0x63506d }), 135);
  for (let i = 0; i < 135; i++) {
    const angle = random() * Math.PI * 2, radius = 1450 + random() * 1700;
    const height = 50 + random() * 300;
    dummy.position.set(-450 + Math.cos(angle) * radius, height / 2 - 28, 150 + Math.sin(angle) * radius);
    dummy.scale.set(35 + random() * 65, height, 35 + random() * 65); dummy.updateMatrix(); towers.setMatrixAt(i, dummy.matrix);
  } scene.add(towers);
  // Sparse trackside chevrons add lateral motion cues without photorealistic clutter.
  const signMap = art.texture(64, 24, c => {
    c.fillStyle = '#262943'; c.fillRect(0, 0, 64, 24); c.fillStyle = '#93f3df';
    c.fillRect(0, 0, 64, 2); c.fillRect(0, 22, 64, 2);
    for (let x = 6; x < 60; x += 16) {
      c.beginPath(); c.moveTo(x, 5); c.lineTo(x + 7, 12); c.lineTo(x, 19); c.lineTo(x + 6, 19); c.lineTo(x + 13, 12); c.lineTo(x + 6, 5); c.fill();
    }
  });
  const signGeo = new THREE.PlaneGeometry(19, 7); geometries.push(signGeo);
  for (let s = 160; s < track.length; s += 155) {
    const f = track.sample(s), sign = new THREE.Mesh(signGeo, basic({ map: signMap, side: THREE.DoubleSide }));
    const p = add(add(f.position, mul(f.right, track.width / 2 + 8)), mul(f.up, 9));
    sign.position.set(p.x, p.y, p.z);
    sign.lookAt(p.x - f.tangent.x * 5, p.y - f.tangent.y * 5, p.z - f.tangent.z * 5);
    scene.add(sign);
  }
  return { roadCollider, wallColliders, geometries, materials };
}

// A small original 5x7 bitmap font. Rendering stays at the game's internal resolution.
const PIXEL_FONT = {
  'A':['01110','10001','10001','11111','10001','10001','10001'],
  'B':['11110','10001','10001','11110','10001','10001','11110'],
  'C':['01111','10000','10000','10000','10000','10000','01111'],
  'D':['11110','10001','10001','10001','10001','10001','11110'],
  'E':['11111','10000','10000','11110','10000','10000','11111'],
  'F':['11111','10000','10000','11110','10000','10000','10000'],
  'G':['01111','10000','10000','10111','10001','10001','01110'],
  'H':['10001','10001','10001','11111','10001','10001','10001'],
  'I':['11111','00100','00100','00100','00100','00100','11111'],
  'J':['00111','00010','00010','00010','10010','10010','01100'],
  'K':['10001','10010','10100','11000','10100','10010','10001'],
  'L':['10000','10000','10000','10000','10000','10000','11111'],
  'M':['10001','11011','10101','10101','10001','10001','10001'],
  'N':['10001','11001','11001','10101','10011','10011','10001'],
  'O':['01110','10001','10001','10001','10001','10001','01110'],
  'P':['11110','10001','10001','11110','10000','10000','10000'],
  'Q':['01110','10001','10001','10001','10101','10010','01101'],
  'R':['11110','10001','10001','11110','10100','10010','10001'],
  'S':['01111','10000','10000','01110','00001','00001','11110'],
  'T':['11111','00100','00100','00100','00100','00100','00100'],
  'U':['10001','10001','10001','10001','10001','10001','01110'],
  'V':['10001','10001','10001','10001','10001','01010','00100'],
  'W':['10001','10001','10001','10101','10101','10101','01010'],
  'X':['10001','10001','01010','00100','01010','10001','10001'],
  'Y':['10001','10001','01010','00100','00100','00100','00100'],
  'Z':['11111','00001','00010','00100','01000','10000','11111'],
  '0':['01110','10001','10011','10101','11001','10001','01110'],
  '1':['00100','01100','00100','00100','00100','00100','01110'],
  '2':['01110','10001','00001','00010','00100','01000','11111'],
  '3':['11110','00001','00001','01110','00001','00001','11110'],
  '4':['00010','00110','01010','10010','11111','00010','00010'],
  '5':['11111','10000','10000','11110','00001','00001','11110'],
  '6':['01110','10000','10000','11110','10001','10001','01110'],
  '7':['11111','00001','00010','00100','01000','01000','01000'],
  '8':['01110','10001','10001','01110','10001','10001','01110'],
  '9':['01110','10001','10001','01111','00001','00001','01110'],
  ':':['00000','00100','00100','00000','00100','00100','00000'],
  '.':['00000','00000','00000','00000','00000','00110','00110'],
  '/':['00001','00001','00010','00100','01000','10000','10000'],
  '-':['00000','00000','00000','11111','00000','00000','00000'],
  '+':['00000','00100','00100','11111','00100','00100','00000'],
  '!':['00100','00100','00100','00100','00100','00000','00100'],
  '?':['01110','10001','00001','00010','00100','00000','00100']
};
export function pixelText(ctx, text, x, y, scale = 1, color = '#effbf2', align = 'left') {
  text = String(text).toUpperCase();
  const width = text.length * 6 * scale - scale;
  if (align === 'right') x -= width; else if (align === 'center') x -= width / 2;
  x = Math.round(x); y = Math.round(y);
  function paint(dx, dy, fill) {
    ctx.fillStyle = fill;
    for (let i = 0; i < text.length; i++) {
      const glyph = PIXEL_FONT[text[i]]; if (!glyph) continue;
      for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 5; gx++) if (glyph[gy][gx] === '1') {
        ctx.fillRect(x + i * 6 * scale + gx * scale + dx, y + gy * scale + dy, scale, scale);
      }
    }
  }
  paint(scale, scale, '#1b1933'); paint(0, 0, color);
}
