// Interiors you can walk into. The IsAcademy tower lobby: glass ground floor behind a stone portico with the name in
// brass, marble floor, reception in front of a wooden wall with the logo, a library wall, study tables with laptops,
// course screens, sofas, plants, lifts and warm interior light. A stone totem on the plaza lists the courses.
import * as THREE from 'three/webgpu';
import { texture, positionWorld, vec3, sin, float, mix } from 'three/tsl';
import { CITY } from './layout.js';
import { neonMaterial, NIGHT } from './materials.js';
import { mergeStatic } from './chunks.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const LOBBY = { size: 34, height: 8, door: 4 };

function canvasTexture(draw, w = 1024, h = 512) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function buildLobby({ scene, world, RAPIER }, tower, kitTextures, t) {
  const S = LOBBY.size, H = LOBBY.height, half = S / 2, y0 = CITY.CURB;
  const cx = tower.x, cz = tower.z;
  const group = new THREE.Group();
  group.position.set(cx, y0, cz);
  scene.add(group);
  const collider = (hx, hy, hz, x, y, z) => world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx + x, y0 + y, cz + z));

  // floor: polished marble that mirrors the lights
  const marble = new THREE.MeshStandardNodeMaterial({ roughness: 0.12, metalness: 0.05 });
  if (kitTextures?.marble) marble.colorNode = texture(kitTextures.marble, positionWorld.xz.div(4)).rgb.mul(0.9);
  else marble.color = new THREE.Color(0xe8e4dc);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(S, 0.1, S), marble);
  floor.position.y = 0.05; floor.receiveShadow = true; group.add(floor);
  // ceiling with light panels
  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(S, 0.3, S), new THREE.MeshStandardNodeMaterial({ color: 0xf2efe8, roughness: 0.8 }));
  ceiling.position.y = H; group.add(ceiling);
  const panelMat = new THREE.MeshBasicNodeMaterial(); panelMat.colorNode = vec3(1, 0.95, 0.86).mul(float(1.2));
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.05, 1.2), panelMat);
    p.position.set(i * 6, H - 0.17, j * 6); group.add(p);
  }

  // pale stone for the piers, the top band and the portico
  const stone = new THREE.MeshStandardNodeMaterial({ roughness: 0.78 });
  if (kitTextures?.marble) stone.colorNode = texture(kitTextures.marble, positionWorld.zy.add(positionWorld.x).div(5)).rgb.mul(vec3(0.84, 0.81, 0.76));
  else stone.color = new THREE.Color(0xcfc8bb);

  // glass walls between stone piers (every other mullion); the entrance faces the campus (+x side)
  const glass = new THREE.MeshPhysicalNodeMaterial({ color: 0xbfd6e6, metalness: 0.1, roughness: 0.03, transparent: true, opacity: 0.22, depthWrite: false });
  const frame = new THREE.MeshStandardNodeMaterial({ color: 0x1d2330, roughness: 0.4, metalness: 0.8 });
  const wall = (len, x, z, rotY) => {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(len, H), glass);
    g.position.set(x, H / 2, z); g.rotation.y = rotY; group.add(g);
    for (let k = -len / 2, n = 0; k <= len / 2 + 0.01; k += 2.8, n++) {
      const pier = n % 2 === 0;
      const m = new THREE.Mesh(pier ? new THREE.BoxGeometry(0.7, H, 0.7) : new THREE.BoxGeometry(0.12, H, 0.12), pier ? stone : frame);
      const dx = Math.cos(rotY) * k, dz = -Math.sin(rotY) * k;
      m.position.set(x + dx, H / 2, z + dz); m.castShadow = true; group.add(m);
    }
  };
  wall(S, 0, -half, 0); wall(S, 0, half, Math.PI); wall(S, -half, 0, Math.PI / 2);
  // stone band under the classroom floors, around the four sides (open inside, so the ceiling lights stay visible)
  [[0, -half, S + 0.9, 0.9], [0, half, S + 0.9, 0.9], [-half, 0, 0.9, S + 0.9], [half, 0, 0.9, S + 0.9]].forEach(([x, z, w, d]) => {
    const band = new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, d), stone);
    band.position.set(x, H - 0.45, z); band.castShadow = true; group.add(band);
  });
  const side = (S - LOBBY.door) / 2;
  wall(side, half, -(LOBBY.door / 2 + side / 2), -Math.PI / 2); wall(side, half, LOBBY.door / 2 + side / 2, -Math.PI / 2);
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.2, LOBBY.door + 0.6), frame);
  lintel.position.set(half, H - 0.6 - 3.2, 0); group.add(lintel);
  // walls only stop people: thin colliders with a gap at the door
  collider(half, H / 2, 0.15, 0, H / 2, -half); collider(half, H / 2, 0.15, 0, H / 2, half); collider(0.15, H / 2, half, -half, H / 2, 0);
  collider(0.15, H / 2, side / 2, half, H / 2, -(LOBBY.door / 2 + side / 2)); collider(0.15, H / 2, side / 2, half, H / 2, LOBBY.door / 2 + side / 2);
  // stone portico over the entrance: two pillars, a deep lintel with the name in brass letters and the tagline
  // brass letters cut out of a canvas (alpha) and softly backlit
  const brassLetters = (tex, glow) => {
    const m = new THREE.MeshStandardNodeMaterial({ color: 0xb58534, metalness: 0.85, roughness: 0.32, alphaTest: 0.5 });
    m.opacityNode = texture(tex).a; m.emissiveNode = glow;
    return m;
  };
  [-5.6, 5.6].forEach((z) => {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 6.06, 1.1), stone);
    pillar.position.set(half + 5, 3.03, z); pillar.castShadow = true; group.add(pillar);
    collider(0.55, 3.1, 0.55, half + 5, 3.1, z);
  });
  const lintel2 = new THREE.Mesh(new THREE.BoxGeometry(6, 1.9, 13.4), stone);
  lintel2.position.set(half + 2.9, 7.0, 0); lintel2.castShadow = true; group.add(lintel2);
  const nameTex = canvasTexture((g, w, h) => {
    g.fillStyle = '#ffffff'; g.textBaseline = 'alphabetic';
    g.font = '190px Allura, cursive'; const isW = g.measureText('Is').width;
    g.font = '600 132px "Space Grotesk", sans-serif'; const acW = g.measureText('Academy').width;
    const x0 = (w - isW - acW - 8) / 2;
    g.font = '190px Allura, cursive'; g.fillText('Is', x0, 178);
    g.font = '600 132px "Space Grotesk", sans-serif'; g.fillText('Academy', x0 + isW + 8, 172);
    g.font = '500 44px "Space Grotesk", sans-serif'; g.textAlign = 'center'; g.fillText(t('lobby.tagline').toUpperCase(), w / 2, 262);
  }, 1024, 300);
  const nameMat = brassLetters(nameTex, vec3(1.0, 0.78, 0.45).mul(NIGHT.mul(0.7)));
  const name = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 6.4 * 300 / 1024), nameMat);
  name.position.set(half + 5.91, 7.0, 0); name.rotation.y = Math.PI / 2; group.add(name);

  // totem on the plaza: the courses, engraved in a dark stone slab
  const totemTex = canvasTexture((g, w, h) => {
    g.fillStyle = '#23272d'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#d9b26a'; g.font = '150px Allura, cursive'; g.fillText('Is', 70, 210);
    g.fillStyle = '#efe9dd'; g.font = '600 96px "Space Grotesk", sans-serif'; g.fillText('Academy', 180, 204);
    g.fillStyle = '#d9b26a'; g.fillRect(70, 250, w - 140, 3);
    g.font = '500 48px "Space Grotesk", sans-serif'; g.fillStyle = '#efe9dd';
    t('lobby.subjects').forEach((c, i) => g.fillText(c, 70, 350 + i * 84, w - 140));
    g.font = '400 38px "Space Grotesk", sans-serif'; g.fillStyle = '#a9b0ba';
    g.fillText('isuniverse.dev/academy', 70, h - 70);
  }, 1024, 1300);
  const totem = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.2, 2.4), new THREE.MeshStandardNodeMaterial({ color: 0x23272d, roughness: 0.55 }));
  totem.position.set(half + 10, 1.6, -9); totem.castShadow = true; group.add(totem);
  const totemFace = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2 * 1300 / 1024), new THREE.MeshStandardNodeMaterial({ map: totemTex, roughness: 0.5 }));
  totemFace.material.emissiveNode = texture(totemTex).rgb.mul(NIGHT.mul(0.25));
  totemFace.position.set(half + 10.26, 1.6, -9); totemFace.rotation.y = Math.PI / 2; group.add(totemFace);
  collider(0.25, 1.6, 1.2, half + 10, 1.6, -9);

  // reception desk with the IsAcademy logo
  const deskMat = new THREE.MeshPhysicalNodeMaterial({ color: 0x3b2a1e, roughness: 0.35, metalness: 0.05, clearcoat: 0.6 });   // walnut
  const desk = new THREE.Mesh(new THREE.BoxGeometry(2, 1.1, 9), deskMat);
  desk.position.set(6, 0.55, 0); desk.castShadow = true; group.add(desk);
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.08, 9.3), new THREE.MeshStandardNodeMaterial({ color: 0xe2b25c, roughness: 0.3, metalness: 0.8 }));
  top.position.set(6, 1.14, 0); group.add(top);
  collider(1.1, 0.6, 4.6, 6, 0.6, 0);

  const logo = canvasTexture((g, w, h) => {
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '210px Allura, cursive'; g.fillText('IsAcademy', w / 2, h * 0.42);
    g.font = '500 40px "Space Grotesk", sans-serif'; g.fillText(t('lobby.motto'), w / 2, h * 0.8);
  });
  const logoMat = brassLetters(logo, vec3(1.0, 0.8, 0.5).mul(0.25));
  const logoWall = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), logoMat);
  logoWall.position.set(1.42, 3.6, 0); logoWall.rotation.y = Math.PI / 2; group.add(logoWall);
  const wood = new THREE.MeshStandardNodeMaterial({ roughness: 0.6 });
  wood.colorNode = mix(vec3(0.3, 0.19, 0.11), vec3(0.4, 0.26, 0.15), sin(positionWorld.y.mul(9).add(sin(positionWorld.z.mul(1.7)).mul(2))).mul(0.5).add(0.5));
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(0.4, H, 14), wood);
  backWall.position.set(1.2, H / 2, 0); group.add(backWall);
  collider(0.2, H / 2, 7, 1.2, H / 2, 0);

  // course screens on the side walls (redrawn with the language)
  const courses = t('lobby.courses');
  const screens = [];
  (Array.isArray(courses) ? courses : []).forEach((name, k) => {
    const tex = canvasTexture((g, w, h) => {
      g.fillStyle = '#14171c'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#d9b26a'; g.font = '110px Allura, cursive'; g.fillText('Is', 60, 130);
      g.fillStyle = '#efe9dd'; g.font = '600 64px "Space Grotesk", sans-serif'; g.fillText('Academy', 140, 126);
      g.fillStyle = '#ffffff'; g.font = '700 110px "Space Grotesk", sans-serif'; g.fillText(name, 60, 300);
      g.fillStyle = '#d9b26a'; g.fillRect(60, 340, 120, 4);
      g.fillStyle = '#b9c0c9'; g.font = '500 44px "Space Grotesk", sans-serif'; g.fillText(t('lobby.screenLine'), 60, 420);
    });
    const mat = new THREE.MeshBasicNodeMaterial(); mat.colorNode = texture(tex).rgb.mul(0.95);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.2), mat);
    const zSide = k % 2 ? 1 : -1;
    scr.position.set(-10 + Math.floor(k / 2) * 8, 3.4, zSide * (half - 0.3)); scr.rotation.y = zSide > 0 ? Math.PI : 0;
    group.add(scr); screens.push(scr);
  });

  // lifts at the back
  const steel = new THREE.MeshStandardNodeMaterial({ color: 0xb7bcc4, roughness: 0.25, metalness: 0.95 });
  for (let k = -1; k <= 1; k++) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3, 2), steel);
    door.position.set(-half + 0.2, 1.5, k * 4); group.add(door);
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.5), neonMaterial(new THREE.Color('#f2d18b'), 1.2));
    light.position.set(-half + 0.26, 3.3, k * 4); group.add(light);
  }
  // sofas, low tables and plants
  const fabric = new THREE.MeshStandardNodeMaterial({ color: 0x2e3c74, roughness: 0.9 });
  const pot = new THREE.MeshStandardNodeMaterial({ color: 0xe9e4da, roughness: 0.6 });
  const leaf = new THREE.MeshStandardNodeMaterial({ color: 0x2f5a25, roughness: 0.8 });
  [[-6, -10], [-6, 10]].forEach(([x, z]) => {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.45, 6), fabric); seat.position.set(x - 1.5, 0.32, z);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.9, 6), fabric); back.position.set(x - 2.5, 0.75, z);
    const table = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.4, 24), deskMat); table.position.set(x + 1, 0.3, z);
    [seat, back, table].forEach((m) => { m.castShadow = true; group.add(m); });
    collider(1.4, 0.5, 3, x - 1.8, 0.5, z);
  });
  [[12, -14], [12, 14], [-14, -14], [-14, 14], [14, -6], [14, 6]].forEach(([x, z]) => {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.35, 0.9, 16), pot); p.position.set(x, 0.45, z);
    const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 1), leaf); f.position.set(x, 1.6, z); f.scale.y = 1.4;
    [p, f].forEach((m) => { m.castShadow = true; group.add(m); });
  });

  // library along the back of the west side: shelves full of books (spines painted on a canvas)
  const books = canvasTexture((g, w, h) => {
    g.fillStyle = '#3a2716'; g.fillRect(0, 0, w, h);
    const palette = ['#7a2e2a', '#2f4a6d', '#d9c9a3', '#3e5a3a', '#8a6a2f', '#5b3b5e', '#c4b8a5', '#1f2a36', '#a8452f'];
    for (let row = 0; row < 5; row++) {
      const y0 = row * (h / 5) + 10, bh = h / 5 - 24;
      g.fillStyle = '#2a1b0f'; g.fillRect(0, y0 + bh, w, 14);
      for (let x = 6; x < w - 10;) {
        const bw = 10 + Math.random() * 16, hh = bh * (0.7 + Math.random() * 0.3);
        g.fillStyle = palette[Math.floor(Math.random() * palette.length)]; g.fillRect(x, y0 + bh - hh, bw, hh);
        g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x + 2, y0 + bh - hh + 8, bw - 4, 3);
        x += bw + 1 + (Math.random() < 0.06 ? 18 : 0);
      }
    }
  }, 2048, 640);
  [-1, 1].forEach((zs) => {
    const shelf = new THREE.Mesh(new THREE.PlaneGeometry(12, 3.8), new THREE.MeshStandardNodeMaterial({ map: books, roughness: 0.8 }));
    shelf.position.set(-6, 2.0, zs * (half - 0.25)); shelf.rotation.y = zs > 0 ? Math.PI : 0; group.add(shelf);
    const case_ = new THREE.Mesh(new THREE.BoxGeometry(12.4, 4.2, 0.45), wood);
    case_.position.set(-6, 2.1, zs * (half - 0.05)); group.add(case_);
  });

  // study tables by the windows on both sides of the entrance, with open laptops
  const tableTop = new THREE.MeshStandardNodeMaterial({ color: 0xd8cbb4, roughness: 0.5 });
  const metal = new THREE.MeshStandardNodeMaterial({ color: 0x2a2d33, roughness: 0.4, metalness: 0.8 });
  const screenMat = new THREE.MeshBasicNodeMaterial(); screenMat.colorNode = vec3(0.55, 0.68, 0.85).mul(0.9);
  [-10.5, 10.5].forEach((z) => {
    const top2 = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 5), tableTop); top2.position.set(10, 0.76, z); top2.castShadow = true; group.add(top2);
    [-2.2, 2.2].forEach((dz) => { const leg = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.72, 0.06), metal); leg.position.set(10, 0.37, z + dz); group.add(leg); });
    collider(0.8, 0.4, 2.5, 10, 0.4, z);
    [-1.6, 0, 1.6].forEach((dz, i) => {
      const side2 = i % 2 ? 1 : -1;
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.015, 0.34), metal); base.position.set(10 + side2 * 0.35, 0.8, z + dz); group.add(base);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.22, 0.34), metal); lid.position.set(10 + side2 * 0.48, 0.92, z + dz); lid.rotation.z = side2 * 0.25; group.add(lid);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.19), screenMat); scr.position.set(10 + side2 * 0.47, 0.92, z + dz); scr.rotation.set(0, -side2 * Math.PI / 2, -side2 * 0.25); group.add(scr);
      const chair = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), metal); chair.position.set(10 + side2 * 1.15, 0.23, z + dz); group.add(chair);
    });
  });

  // warm interior light (the panels glow; two real lights give the marble its sheen)
  [[-8, -8], [-8, 8]].forEach(([x, z]) => {
    const l = new THREE.PointLight(0xffe2b8, 22, 22, 1.8); l.position.set(x, H - 0.6, z); group.add(l);
  });

  // merge the static furniture and structure into one mesh per material (keeps the draw count low)
  const lights = group.children.filter((c) => c.isLight);
  const merged = mergeStatic(group, mergeGeometries);
  scene.remove(group);
  merged.position.set(0, 0, 0);
  scene.add(merged);
  lights.forEach((l) => { l.position.add(new THREE.Vector3(cx, y0, cz)); scene.add(l); });

  return {
    group: merged,
    reception: { x: cx + 4.2, z: cz },
    contains(p, margin = 0) { return Math.abs(p.x - cx) < half + margin && Math.abs(p.z - cz) < half + margin && p.y < y0 + H; },
  };
}
