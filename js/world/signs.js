// Signage of a real, modern city: lightbox fascias above the shop fronts, backlit company letters on the tall buildings,
// LED screens that show data, code and IsAcademy's courses, and the IsAcademy crown on the tower. Every name is
// invented. Fascias and letters share one atlas texture (one draw call); they read as painted panels and metal letters
// by day and glow softly at night, without neon tubes or flicker.
import * as THREE from 'three/webgpu';
import { texture, uv, attribute, max, min, mix, vec3, smoothstep } from 'three/tsl';
import { CITY, rng } from './layout.js';
import { NIGHT, WET, atNight } from './materials.js';

// ground floors: everyday shops next to the tech ones, as in any real neighbourhood
const SHOPS = [
  'Byte Café', 'Café Lambda', 'Ramen Async', 'Pizzería Recursiva', 'Farmacia', 'Panadería', 'Frutería', 'Lavandería',
  'Coworking Commit', 'Taller de portátiles', 'Componentes PC', 'Librería Técnica', 'Gimnasio', 'Óptica',
  'Bicis eléctricas', 'Impresión 3D', 'Floristería', 'Tienda de robótica', 'Reparación de móviles', 'Academia de idiomas',
];
// company letters on the tall buildings, by district
const COMPANIES = {
  ia: ['Tensor Labs', 'Neural Health', 'Instituto de Visión', 'Robótica Delta', 'Agentes Norte'],
  data: ['Data Center Sur', 'Lago de Datos', 'Analítica Plaza', 'Pipeline & Co.', 'Estadística Viva'],
  net: ['Torre Fibra', 'Red Abierta', 'Nodo Central', 'Cloud Bahía', 'Telecom Ribera'],
  sec: ['Ciberseguridad 24h', 'Cifra Segura', 'Kernel Systems', 'Guardia Digital', 'SOC Ribera'],
  campus: ['Biblioteca Turing', 'Residencia Lovelace'],
};
const PANELS = [   // fascia panel / letters: dark panels with light letters and a few light boxes with dark letters
  ['#1d2026', '#f4efe6'], ['#24323d', '#f4efe6'], ['#3a2a22', '#ffe6c2'], ['#173a34', '#eaf6ef'], ['#4a1f26', '#fbe9e4'],
  ['#f1ece2', '#1f2329'], ['#e9eef2', '#1d3a52'],
];
const BRAND = { ia: '#4fb4d8', data: '#d9a441', net: '#8f7ad8', sec: '#4fbf86', campus: '#d9b26a' };

const cache = new Map();
function fasciaCanvas(text, panel, ink) {
  const key = `f|${text}|${panel}`;
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas'), g = c.getContext('2d');
  g.font = '600 54px "Space Grotesk", sans-serif';
  c.width = Math.ceil(g.measureText(text).width + 96); c.height = 96;
  g.fillStyle = panel; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(0, 0, c.width, 4);   // top edge of the box catches the light
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, c.height - 5, c.width, 5);
  g.font = '600 54px "Space Grotesk", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = ink; g.fillText(text, c.width / 2, c.height / 2 + 2);
  cache.set(key, c);
  return c;
}
function lettersCanvas(text, brand) {
  const key = `l|${text}|${brand}`;
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas'), g = c.getContext('2d');
  g.font = '600 88px "Space Grotesk", sans-serif';
  c.width = Math.ceil(g.measureText(text).width + 150); c.height = 128;
  g.fillStyle = brand; g.fillRect(10, 26, 76, 76);   // a simple square logo in the brand colour
  g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(30, 46, 36, 36);
  g.fillStyle = brand; g.fillRect(40, 56, 16, 16);
  g.font = '600 88px "Space Grotesk", sans-serif'; g.textBaseline = 'middle';
  g.fillStyle = '#f6f3ec'; g.fillText(text, 110, 68);
  cache.set(key, c);
  return c;
}

// All sign canvases packed into one atlas texture (shelf packing), so every sign in the city is a single draw call.
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
  const uvOf = (c) => { const r = rects.get(c); return [(r.x + 0.5) / W, 1 - (r.y + r.h - 0.5) / H, (r.x + r.w - 0.5) / W, 1 - (r.y + 0.5) / H]; };
  return { tex, uvOf };
}

// quads (centre, facing angle, width, height) merged into one geometry with extra per-vertex attributes
function quads(list, flat = false) {
  const pos = [], nrm = [], uvs = [], extra = {}, idx = [];
  list.forEach((q, k) => {
    const c = Math.cos(q.rot), s = Math.sin(q.rot), hw = q.w / 2, hh = q.h / 2;
    [[-hw, -hh], [hw, -hh], [-hw, hh], [hw, hh]].forEach(([u, v]) => {
      if (flat) { pos.push(q.x + u * c - v * s, q.y, q.z - u * s - v * c); nrm.push(0, 1, 0); }   // lying on the road, uv.y back to the facade
      else { pos.push(q.x + u * c, q.y + v, q.z - u * s); nrm.push(s, 0, c); }
    });
    const [u0, v0, u1, v1] = q.uv;
    uvs.push(u0, v0, u1, v0, u0, v1, u1, v1);
    for (const [name, val] of Object.entries(q.attrs || {})) { (extra[name] ||= []).push(...[0, 1, 2, 3].flatMap(() => (Array.isArray(val) ? val : [val]))); }
    const b = k * 4; idx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
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

// LED screens: slides that rotate every few seconds (IsAcademy courses, a live chart, Python, SQL)
const CODE = {
  python: ['def aprender(tema):', '    preguntas = explorar(tema)', '    for p in preguntas:', '        pensar(p)', '    return comprender(tema)'],
  sql: ['SELECT distrito, COUNT(*) AS viajes', 'FROM movilidad', "WHERE hora BETWEEN '08:00' AND '10:00'", 'GROUP BY distrito', 'ORDER BY viajes DESC;'],
};
function drawSlide(g, w, h, kind, t, tr, k) {
  g.fillStyle = '#0b0f16'; g.fillRect(0, 0, w, h);
  if (kind === 'ad') {
    const grd = g.createLinearGradient(0, 0, w, h); grd.addColorStop(0, '#101826'); grd.addColorStop(1, '#1d1a14');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = '#d9b26a'; g.font = '150px Allura, cursive'; g.textBaseline = 'alphabetic'; g.fillText('Is', 60, 190);
    g.fillStyle = '#f4efe6'; g.font = '600 92px "Space Grotesk", sans-serif'; g.fillText('Academy', 175, 186);
    g.font = '400 38px "Space Grotesk", sans-serif'; g.fillStyle = '#e8dcc4';
    const motto = tr('lobby.motto'); g.fillText(motto, 64, 270);
    const courses = tr('lobby.courses');
    g.font = '600 32px "Space Grotesk", sans-serif';
    let x = 64;
    courses.forEach((c) => { const cw = g.measureText(c).width + 40; g.strokeStyle = '#d9b26a'; g.lineWidth = 2; g.strokeRect(x, 318, cw, 56); g.fillStyle = '#f4efe6'; g.fillText(c, x + 20, 358); x += cw + 16; });
    g.font = '400 30px "Space Grotesk", sans-serif'; g.fillStyle = '#9fb2c8'; g.fillText('isuniverse.dev/academy', 64, 470);
  } else if (kind === 'chart') {
    g.fillStyle = '#e9eef4'; g.font = '600 40px "Space Grotesk", sans-serif'; g.textBaseline = 'alphabetic'; g.fillText(tr('world.screenChart'), 56, 80);
    const n = 14, bw = (w - 140) / n;
    for (let i = 0; i < n; i++) {
      const v = 0.35 + 0.3 * Math.sin(i * 0.7 + t * 0.6 + k) + 0.15 * Math.sin(i * 2.3 + t * 1.3);
      const bh = Math.max(12, v * (h - 200));
      g.fillStyle = i === n - 1 ? '#d9b26a' : '#4fb4d8'; g.fillRect(70 + i * bw, h - 70 - bh, bw * 0.7, bh);
    }
    g.fillStyle = 'rgba(233,238,244,0.35)'; g.fillRect(56, h - 68, w - 112, 2);
  } else {
    const lines = CODE[kind];
    g.fillStyle = '#9fb2c8'; g.font = '500 30px "Space Grotesk", sans-serif'; g.textBaseline = 'alphabetic';
    g.fillText(kind === 'python' ? 'aprender.py' : 'movilidad.sql', 56, 64);
    g.font = '500 40px Menlo, Consolas, monospace';
    const shown = Math.min(lines.length, Math.floor((t % 10) * 1.2) + 1);   // lines appear as if typed
    lines.slice(0, shown).forEach((line, i) => {
      g.fillStyle = '#5b6b80'; g.fillText(String(i + 1).padStart(2), 56, 140 + i * 66);
      g.fillStyle = i === shown - 1 ? '#f4efe6' : '#cfe3f2'; g.fillText(line, 130, 140 + i * 66);
    });
    if (Math.floor(t * 2) % 2 === 0) { g.fillStyle = '#d9b26a'; g.fillRect(130 + g.measureText(lines[shown - 1]).width + 8, 108 + (shown - 1) * 66, 20, 40); }
  }
  // fine LED grid
  g.fillStyle = 'rgba(0,0,0,0.18)';
  for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
}

export function buildSigns({ scene }, anchors, tower, t) {
  const rand = rng(77);
  const streakTex = streakTexture();
  const lights = [];   // positions and colours for the dynamic light pool near the player
  const group = new THREE.Group();
  scene.add(group);

  const signs = [], streaks = [];
  const usedCompanies = new Set();
  for (const a of anchors) {
    if (a.h < 9) continue;
    const rot = Math.atan2(a.nx, a.nz), ax = Math.cos(rot), az = -Math.sin(rot);   // along the facade
    // one to three shop fascias along the ground floor, just above the shop fronts
    const n = Math.min(3, Math.floor(a.span / 14));
    for (let i = 0; i < n; i++) {
      if (rand() > 0.55) continue;
      const text = SHOPS[Math.floor(rand() * SHOPS.length)];
      const [panel, ink] = PANELS[Math.floor(rand() * PANELS.length)];
      const canvas = fasciaCanvas(text, panel, ink);
      const h = 0.62, w = Math.min(h * canvas.width / canvas.height, a.span / n - 1.5);
      const off = (i - (n - 1) / 2) * (a.span / n);
      const x = a.px + ax * off + a.nx * 0.08, z = a.pz + az * off + a.nz * 0.08, y = CITY.CURB + 3.25;
      signs.push({ canvas, x, y, z, rot, w, h: w * canvas.height / canvas.width, attrs: { letters: 0 } });
      const glow = new THREE.Color(ink).lerp(new THREE.Color('#ffd9a8'), 0.6);
      lights.push({ x: x + a.nx * 4, y: 3.6, z: z + a.nz * 4, color: glow });
      // reflection of the lit fascia on the wet street
      const len = 7, d = a.gap + 0.8 + len / 2;
      streaks.push({ x: a.px + ax * off + a.nx * d, y: 0.04, z: a.pz + az * off + a.nz * d, rot, w: Math.max(w * 0.7, 1.5), h: len, uv: [0, 0, 1, 1], attrs: { tint: [glow.r * 0.3, glow.g * 0.3, glow.b * 0.3] } });
    }
    // company letters on top of the tall buildings (each company once)
    if (a.h > 45 && rand() < 0.55) {
      const list = (COMPANIES[a.district] || COMPANIES.ia).filter((c) => !usedCompanies.has(c));
      if (!list.length) continue;
      const text = list[Math.floor(rand() * list.length)]; usedCompanies.add(text);
      const canvas = lettersCanvas(text, BRAND[a.district] || BRAND.ia);
      const w = Math.min(a.span * 0.6, 26), h = w * canvas.height / canvas.width;
      signs.push({ canvas, x: a.px + a.nx * 0.1, y: CITY.CURB + a.h - h / 2 - 1.6, z: a.pz + a.nz * 0.1, rot, w, h, attrs: { letters: 1 } });
    }
  }
  const { tex: atlas, uvOf } = buildAtlas(new Set(signs.map((sg) => sg.canvas)));
  signs.forEach((sg) => { sg.uv = uvOf(sg.canvas); });
  // painted panels and metal letters by day; at night the bright parts (letters, light boxes) glow
  const signMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.45, metalness: 0.1, alphaTest: 0.5 });
  const at = texture(atlas, uv());
  const bright = smoothstep(0.45, 0.8, max(max(at.r, at.g), at.b));
  // company letters are dark brushed metal by day (white faces would vanish against pale facades) and light up white
  const white = smoothstep(0.8, 0.95, min(min(at.r, at.g), at.b)).mul(attribute('letters', 'float'));
  signMat.colorNode = mix(at.rgb, vec3(0.13, 0.14, 0.16), white);
  signMat.opacityNode = at.a;
  signMat.emissiveNode = at.rgb.mul(bright).mul(NIGHT.mul(0.55).add(0.02));   // a lit box, not a lamp: readable, no glare
  const signMesh = new THREE.Mesh(quads(signs), signMat);
  signMesh.castShadow = false; signMesh.receiveShadow = true;
  group.add(signMesh);
  const streakMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const st = texture(streakTex, uv());
  streakMat.colorNode = st.rgb.mul(attribute('tint', 'vec3'));
  streakMat.opacityNode = st.a.mul(0.75).mul(WET).mul(NIGHT);   // only wet streets at night mirror the signs
  const streakMesh = new THREE.Mesh(quads(streaks, true), streakMat);
  streakMesh.renderOrder = 1;
  group.add(streakMesh);

  // LED screens on a few tall facades: dark bezel, bright panel; two shared canvases, so updating them stays cheap
  const SW = 1024, SH = 576;
  const feeds = [['ad', 'chart', 'python'], ['chart', 'sql', 'ad']].map((seq) => {
    const canvas = document.createElement('canvas'); canvas.width = SW; canvas.height = SH;
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
    return { seq, canvas, g: canvas.getContext('2d'), tex };
  });
  const bezelMat = new THREE.MeshStandardNodeMaterial({ color: 0x16181c, roughness: 0.5, metalness: 0.6 });
  const screens = anchors.filter((a) => a.h > 60 && a.span > 24).slice(0, 6);
  screens.forEach((a, k) => {
    const feed = feeds[k % 2];
    const mat = new THREE.MeshBasicNodeMaterial();
    mat.colorNode = texture(feed.tex, uv()).rgb.mul(atNight(0.85).mul(1.15));
    const w = Math.min(a.span * 0.55, 18), h = w * SH / SW;
    const rot = Math.atan2(a.nx, a.nz), y = CITY.CURB + Math.min(14 + (k % 3) * 3, a.h - h - 4);
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, h + 0.6, 0.4), bezelMat);
    bezel.position.set(a.px + a.nx * 0.2, y, a.pz + a.nz * 0.2); bezel.rotation.y = rot;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    screen.position.set(a.px + a.nx * 0.42, y, a.pz + a.nz * 0.42); screen.rotation.y = rot;
    group.add(bezel, screen);
  });

  // IsAcademy on the four faces of the tower: brass letters (the brand's "Is" in script), warmly backlit at night
  const crown = document.createElement('canvas'); crown.width = 1024; crown.height = 256;
  const g = crown.getContext('2d');
  g.textBaseline = 'alphabetic'; g.fillStyle = '#ffffff';
  g.font = '210px Allura, cursive'; const isW = g.measureText('Is').width;
  g.font = '600 150px "Space Grotesk", sans-serif'; const acW = g.measureText('Academy').width;
  const x0 = (1024 - isW - acW - 10) / 2;
  g.font = '210px Allura, cursive'; g.fillText('Is', x0, 196);
  g.font = '600 150px "Space Grotesk", sans-serif'; g.fillText('Academy', x0 + isW + 10, 190);
  const crownTex = new THREE.CanvasTexture(crown); crownTex.colorSpace = THREE.SRGBColorSpace; crownTex.anisotropy = 8;
  const brass = new THREE.MeshStandardNodeMaterial({ color: 0xb58534, metalness: 0.85, roughness: 0.32, alphaTest: 0.5 });
  const ct = texture(crownTex, uv());
  brass.opacityNode = ct.a;
  brass.emissiveNode = vec3(1.0, 0.78, 0.45).mul(NIGHT.mul(0.9));
  for (let i = 0; i < 4; i++) {
    const ang = i * Math.PI / 2;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(22, 5.5), brass);
    m.position.set(tower.x + Math.sin(ang) * 13.1, 120, tower.z + Math.cos(ang) * 13.1);
    m.rotation.y = ang;
    group.add(m);
  }

  // screens redraw twice a second (the chart moves, code is typed) and change slide every 8 s
  let clock = 0, redraw = 0;
  const paint = () => feeds.forEach((f, k) => {
    const kind = f.seq[Math.floor(clock / 8 + k * 0.5) % f.seq.length];
    drawSlide(f.g, SW, SH, kind, clock, t, k);
    f.tex.needsUpdate = true;
  });
  const update = (dt, near = true) => {
    clock += dt; redraw -= dt;
    if (redraw > 0 || !near) return;
    redraw = 0.5; paint();
  };
  const refresh = () => paint();
  paint();
  return { lights, refresh, update, screens };
}
