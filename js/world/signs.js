// Neon signs on the facades, their reflections on the wet road, scrolling holographic billboards and the IsAcademy
// crown on the tower. Glyphs are drawn once on canvases; colours above 1.0 feed the bloom.
import * as THREE from 'three/webgpu';
import { texture, uv, vec2, time } from 'three/tsl';
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
function glyphTexture(text, color, vertical) {
  const key = `${text}|${color}|${vertical}`;
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const size = 96;
  g.font = `700 ${size}px "Space Grotesk", sans-serif`;
  const letters = [...text];
  if (vertical) { c.width = 160; c.height = Math.max(256, letters.length * 112 + 60); }
  else { c.width = Math.ceil(g.measureText(text).width + 120); c.height = 170; }
  g.font = `700 ${size}px "Space Grotesk", sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.strokeStyle = color; g.lineWidth = 5; g.shadowColor = color; g.shadowBlur = 22;
  g.strokeRect(10, 10, c.width - 20, c.height - 20);
  g.fillStyle = '#ffffff';
  const draw = (t, x, y) => { g.shadowBlur = 26; g.fillStyle = color; g.fillText(t, x, y); g.shadowBlur = 6; g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillText(t, x, y); };
  if (vertical) letters.forEach((l, i) => draw(l, c.width / 2, 70 + i * 112));
  else draw(text, c.width / 2, c.height / 2 + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const out = { tex, aspect: c.width / c.height };
  cache.set(key, out);
  return out;
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

  for (const a of anchors) {
    if (rand() > 0.78 || a.h < 9) continue;
    const pool = rand() < 0.25 ? WORDS.any : WORDS[a.district] || WORDS.any;
    const text = pool[Math.floor(rand() * pool.length)];
    const color = '#' + (COLORS[a.district] || COLORS.ia).getHexString();
    const altColor = ['#ff5c7a', '#3fe0ff', '#e2b25c', '#a98bff'][Math.floor(rand() * 4)];
    const col = rand() < 0.3 ? altColor : color;
    const vertical = text.length <= 6 && rand() < 0.4;
    const { tex, aspect } = glyphTexture(text, col, vertical);
    let w, h;
    if (vertical) { h = Math.min(4 + text.length * 2.2, a.h - 6); w = h * aspect; }
    else { w = Math.min(Math.max(text.length * 1.5 + 2, 5), a.span * 0.8); h = w / aspect; }
    const y = vertical ? 5 + h / 2 + rand() * 4 : Math.min(4.6 + rand() * 14, a.h - h);
    const flicker = rand() < 0.12 ? 0.12 : 0;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(w, h), signMaterial(tex, 2.6, flicker));
    sign.position.set(a.px + a.nx * 0.35, y + 0.18, a.pz + a.nz * 0.35);
    sign.rotation.y = Math.atan2(a.nx, a.nz);
    sign.renderOrder = 2;
    group.add(sign);
    const c3 = new THREE.Color(col);
    lights.push({ x: sign.position.x + a.nx * 3, y: Math.min(y, 9), z: sign.position.z + a.nz * 3, color: c3 });

    // reflection of the sign stretched across the wet street
    if (y < 16) {
      const len = 9 + y * 0.8;
      const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const tx = texture(streakTex);
      mat.colorNode = tx.rgb.mul(c3.clone().multiplyScalar(0.55));
      mat.opacityNode = tx.a.mul(0.75).mul(WET).mul(NIGHT.mul(0.7).add(0.3));   // only wet streets mirror the signs
      const streak = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(w * 0.7, 2), len).rotateX(-Math.PI / 2), mat);
      const d = a.gap + 1.0 + len / 2;
      streak.position.set(a.px + a.nx * d, 0.04, a.pz + a.nz * d);
      streak.rotation.y = Math.atan2(a.nx, a.nz);   // bright end of the streak at the facade
      streak.renderOrder = 1;
      group.add(streak);
    }
  }

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
