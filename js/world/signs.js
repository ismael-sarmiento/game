// Neon signs on the facades, their reflections on the wet road, scrolling holographic billboards and the IsAcademy
// crown on the tower. Glyphs are drawn once on canvases; colours above 1.0 feed the bloom.
import * as THREE from 'three/webgpu';
import { texture, uv, vec2, time, attribute, float, step, hash, floor } from 'three/tsl';
import { rng } from './layout.js';
import { signMaterial, COLORS, NIGHT, WET, atNight } from './materials.js';

const WORDS = {
  ia: ['IA', 'LLM', 'NEURAL', 'GPU', 'PROMPT', 'TOKENS', 'VISION', 'AGENT'],
  data: ['DATA', 'SQL', 'PANDAS', 'ETL', 'STATS', 'CSV', 'BI', 'QUERY'],
  net: ['NET', 'API', 'HTTP', 'DNS', 'CLOUD', '5G', 'WIFI', 'ROUTER'],
  sec: ['SEC', 'FIREWALL', '2FA', 'AES', 'KERNEL', 'HASH', 'VPN', 'PATCH'],
  any: ['BYTE CAFÉ', 'NEURAL BAR', 'PIXEL', 'RAM', '404 CLUB', '</>', '{ }', 'PYTHON', 'HELLO WORLD', 'DEBUG', 'GIT', 'LINUX'],
};

const cache = new Map();
function glyphCanvas(text, color, vertical) {
  const key = `${text}|${color}|${vertical}`;
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const size = 72;
  g.font = `700 ${size}px "Space Grotesk", sans-serif`;
  const letters = [...text];
  if (vertical) { c.width = 120; c.height = Math.max(192, letters.length * 84 + 46); }
  else { c.width = Math.ceil(g.measureText(text).width + 90); c.height = 128; }
  g.font = `700 ${size}px "Space Grotesk", sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.strokeStyle = color; g.lineWidth = 4; g.shadowColor = color; g.shadowBlur = 16;
  g.strokeRect(8, 8, c.width - 16, c.height - 16);
  const draw = (t, x, y) => { g.shadowBlur = 20; g.fillStyle = color; g.fillText(t, x, y); g.shadowBlur = 4; g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillText(t, x, y); };
  if (vertical) letters.forEach((l, i) => draw(l, c.width / 2, 52 + i * 84));
  else draw(text, c.width / 2, c.height / 2 + 3);
  cache.set(key, c);
  return c;
}

// All sign glyphs packed into one atlas texture (shelf packing), so every sign in the city is a single draw call.
function buildAtlas(canvases) {
  const W = 4096, pad = 4, rects = new Map();
  let x = 0, y = 0, row = 0;
  const sorted = [...canvases].sort((a, b) => b.height - a.height);
  for (const c of sorted) {
    if (x + c.width + pad > W) { x = 0; y += row + pad; row = 0; }
    rects.set(c, { x, y, w: c.width, h: c.height });
    x += c.width + pad; row = Math.max(row, c.height);
  }
  const H = Math.min(4096, 2 ** Math.ceil(Math.log2(y + row + 1)));
  const atlas = document.createElement('canvas'); atlas.width = W; atlas.height = H;
  const g = atlas.getContext('2d');
  for (const [c, r] of rects) g.drawImage(c, r.x, r.y);
  const tex = new THREE.CanvasTexture(atlas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.generateMipmaps = true;
  const uvOf = (c) => { const r = rects.get(c); return [r.x / W, 1 - (r.y + r.h) / H, (r.x + r.w) / W, 1 - r.y / H]; };
  return { tex, uvOf };
}

// quads (centre, facing angle, width, height) merged into one geometry with extra per-vertex attributes
function quads(list, flat = false) {
  const pos = [], uvs = [], extra = {}, idx = [];
  list.forEach((q, k) => {
    const c = Math.cos(q.rot), s = Math.sin(q.rot), hw = q.w / 2, hh = q.h / 2;
    [[-hw, -hh], [hw, -hh], [-hw, hh], [hw, hh]].forEach(([u, v]) => {
      if (flat) pos.push(q.x + u * c - v * s, q.y, q.z - u * s - v * c);   // lying on the road, uv.y pointing back to the facade
      else pos.push(q.x + u * c, q.y + v, q.z - u * s);
    });
    const [u0, v0, u1, v1] = q.uv;
    uvs.push(u0, v0, u1, v0, u0, v1, u1, v1);
    for (const [name, val] of Object.entries(q.attrs || {})) { (extra[name] ||= []).push(...[0, 1, 2, 3].flatMap(() => (Array.isArray(val) ? val : [val]))); }
    const b = k * 4; idx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  for (const [name, arr] of Object.entries(extra)) g.setAttribute(name, new THREE.Float32BufferAttribute(arr, arr.length / (list.length * 4)));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function streakTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  for (let x = 0; x < 64; x++) {
    const a = 0.35 + Math.random() * 0.65;
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, `rgba(255,255,255,${0.9 * a})`); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(x, 0, 1, 256);
  }
  const fade = g.createLinearGradient(0, 0, 64, 0);
  fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(0.25, 'rgba(0,0,0,0)'); fade.addColorStop(0.75, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out'; g.fillStyle = fade; g.fillRect(0, 0, 64, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function billboardCanvas(text, color) {
  const c = document.createElement('canvas'); c.width = 2048; c.height = 256;
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = 'rgba(10,20,50,0.35)'; g.fillRect(0, 0, c.width, c.height);
  for (let y = 0; y < c.height; y += 6) { g.fillStyle = 'rgba(120,220,255,0.05)'; g.fillRect(0, y, c.width, 2); }
  g.font = '700 120px "Space Grotesk", sans-serif'; g.textBaseline = 'middle';
  g.shadowColor = color; g.shadowBlur = 30; g.fillStyle = color;
  const w = g.measureText(text).width;
  for (let x = 40; x < c.width + w; x += w + 120) g.fillText(text, x, 132);
  return c;
}

export function buildSigns({ scene }, anchors, tower, t) {
  const rand = rng(77);
  const streakTex = streakTexture();
  const lights = [];   // positions and colours for the dynamic light pool near the player
  const group = new THREE.Group();
  scene.add(group);

  const signs = [], streaks = [];
  for (const a of anchors) {
    if (rand() > 0.78 || a.h < 9) continue;
    const pool = rand() < 0.25 ? WORDS.any : WORDS[a.district] || WORDS.any;
    const text = pool[Math.floor(rand() * pool.length)];
    const color = '#' + (COLORS[a.district] || COLORS.ia).getHexString();
    const altColor = ['#ff5c7a', '#3fe0ff', '#e2b25c', '#a98bff'][Math.floor(rand() * 4)];
    const col = rand() < 0.3 ? altColor : color;
    const vertical = text.length <= 6 && rand() < 0.4;
    const canvas = glyphCanvas(text, col, vertical), aspect = canvas.width / canvas.height;
    let w, h;
    if (vertical) { h = Math.min(4 + text.length * 2.2, a.h - 6); w = h * aspect; }
    else { w = Math.min(Math.max(text.length * 1.5 + 2, 5), a.span * 0.8); h = w / aspect; }
    const y = vertical ? 5 + h / 2 + rand() * 4 : Math.min(4.6 + rand() * 14, a.h - h);
    const flicker = rand() < 0.12 ? 0.12 : 0;
    const x = a.px + a.nx * 0.35, z = a.pz + a.nz * 0.35, rot = Math.atan2(a.nx, a.nz);
    signs.push({ canvas, x, y: y + 0.18, z, rot, w, h, attrs: { flick: flicker, phase: rand() * 100 } });
    const c3 = new THREE.Color(col);
    lights.push({ x: x + a.nx * 3, y: Math.min(y, 9), z: z + a.nz * 3, color: c3 });
    // reflection of the sign stretched across the wet street (bright end at the facade)
    if (y < 16) {
      const len = 9 + y * 0.8, d = a.gap + 1.0 + len / 2;
      streaks.push({ x: a.px + a.nx * d, y: 0.04, z: a.pz + a.nz * d, rot, w: Math.max(w * 0.7, 2), h: len, uv: [0, 0, 1, 1], attrs: { tint: [c3.r * 0.55, c3.g * 0.55, c3.b * 0.55] } });
    }
  }
  const { tex: atlas, uvOf } = buildAtlas(new Set(signs.map((sg) => sg.canvas)));
  signs.forEach((sg) => { sg.uv = uvOf(sg.canvas); });
  const signMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const at = texture(atlas, uv());
  const flick = attribute('flick', 'float'), phase = attribute('phase', 'float');
  const f = float(1).sub(step(float(1).sub(flick), hash(floor(time.mul(14).add(phase)))).mul(0.85));
  signMat.colorNode = at.rgb.mul(2.6).mul(f).mul(atNight(0.45));
  signMat.opacityNode = at.a;
  const signMesh = new THREE.Mesh(quads(signs), signMat);
  signMesh.renderOrder = 2;
  group.add(signMesh);
  const streakMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const st = texture(streakTex, uv());
  streakMat.colorNode = st.rgb.mul(attribute('tint', 'vec3'));
  streakMat.opacityNode = st.a.mul(0.75).mul(WET).mul(NIGHT.mul(0.7).add(0.3));   // only wet streets mirror the signs
  const streakMesh = new THREE.Mesh(quads(streaks, true), streakMat);
  streakMesh.renderOrder = 1;
  group.add(streakMesh);

  // holographic billboards with scrolling copy (redrawn when the language changes)
  const boards = [];
  const tall = anchors.filter((a) => a.h > 60 && a.span > 24).slice(0, 10);
  tall.forEach((a, k) => {
    const canvas = billboardCanvas('', '#3fe0ff');
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping;
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const tx = texture(tex, uv().mul(vec2(0.5, 1)).add(vec2(time.mul(0.035 + k * 0.004), 0)));
    mat.colorNode = tx.rgb.mul(2.2).mul(atNight(0.6)); mat.opacityNode = tx.a;
    const w = Math.min(a.span * 0.9, 34), h = w / 8 * 2;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    board.position.set(a.px + a.nx * 0.6, Math.min(26 + k * 2, a.h - h), a.pz + a.nz * 0.6);
    board.rotation.y = Math.atan2(a.nx, a.nz);
    group.add(board);
    boards.push({ canvas, tex, color: ['#3fe0ff', '#e2b25c', '#a98bff'][k % 3], k });
  });

  // IsAcademy crown on the four faces of the tower
  const crown = document.createElement('canvas'); crown.width = 1024; crown.height = 300;
  const g = crown.getContext('2d');
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.shadowColor = '#e2b25c'; g.shadowBlur = 30;
  g.font = '220px Allura, cursive'; g.fillStyle = '#f2d18b'; g.fillText('IsAcademy', 512, 160);
  g.shadowBlur = 4; g.fillStyle = 'rgba(255,248,230,0.9)'; g.fillText('IsAcademy', 512, 160);
  const crownTex = new THREE.CanvasTexture(crown); crownTex.colorSpace = THREE.SRGBColorSpace;
  for (let i = 0; i < 4; i++) {
    const ang = i * Math.PI / 2;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(24, 7), signMaterial(crownTex, 3));
    m.position.set(tower.x + Math.sin(ang) * 13.2, 118, tower.z + Math.cos(ang) * 13.2);
    m.rotation.y = ang;
    group.add(m);
  }

  const refresh = () => boards.forEach((b) => {
    const text = `${t('world.billboard')[b.k % t('world.billboard').length]}   ·   `;
    const fresh = billboardCanvas(text, b.color);
    b.canvas.getContext('2d').clearRect(0, 0, b.canvas.width, b.canvas.height);
    b.canvas.getContext('2d').drawImage(fresh, 0, 0);
    b.tex.needsUpdate = true;
  });
  refresh();
  return { lights, refresh };
}
