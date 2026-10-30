// Interiors you can walk into. The IsAcademy tower lobby: glass ground floor with an entrance facing the campus,
// marble floor, reception desk with the logo, course screens, sofas, plants, lifts and warm interior light.
import * as THREE from 'three/webgpu';
import { texture, positionWorld, vec3, time, sin, float } from 'three/tsl';
import { CITY } from './layout.js';
import { neonMaterial } from './materials.js';

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
  const panelMat = new THREE.MeshBasicNodeMaterial(); panelMat.colorNode = vec3(1, 0.96, 0.88).mul(float(1.6));
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.05, 1.2), panelMat);
    p.position.set(i * 6, H - 0.17, j * 6); group.add(p);
  }

  // glass walls with mullions; the entrance faces the campus (+x side)
  const glass = new THREE.MeshPhysicalNodeMaterial({ color: 0xbfd6e6, metalness: 0.1, roughness: 0.03, transparent: true, opacity: 0.22, depthWrite: false });
  const frame = new THREE.MeshStandardNodeMaterial({ color: 0x1d2330, roughness: 0.4, metalness: 0.8 });
  const wall = (len, x, z, rotY) => {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(len, H), glass);
    g.position.set(x, H / 2, z); g.rotation.y = rotY; group.add(g);
    for (let k = -len / 2; k <= len / 2 + 0.01; k += 2.8) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, H, 0.12), frame);
      const dx = Math.cos(rotY) * k, dz = -Math.sin(rotY) * k;
      m.position.set(x + dx, H / 2, z + dz); m.castShadow = true; group.add(m);
    }
  };
  wall(S, 0, -half, 0); wall(S, 0, half, Math.PI); wall(S, -half, 0, Math.PI / 2);
  const side = (S - LOBBY.door) / 2;
  wall(side, half, -(LOBBY.door / 2 + side / 2), -Math.PI / 2); wall(side, half, LOBBY.door / 2 + side / 2, -Math.PI / 2);
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.2, LOBBY.door + 0.6), frame);
  lintel.position.set(half, H - 0.6 - 3.2, 0); group.add(lintel);
  // walls only stop people: thin colliders with a gap at the door
  collider(half, H / 2, 0.15, 0, H / 2, -half); collider(half, H / 2, 0.15, 0, H / 2, half); collider(0.15, H / 2, half, -half, H / 2, 0);
  collider(0.15, H / 2, side / 2, half, H / 2, -(LOBBY.door / 2 + side / 2)); collider(0.15, H / 2, side / 2, half, H / 2, LOBBY.door / 2 + side / 2);
  // canopy over the entrance with the name
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(4, 0.25, 8), frame);
  canopy.position.set(half + 2, 4.2, 0); canopy.castShadow = true; group.add(canopy);

  // reception desk with the IsAcademy logo
  const deskMat = new THREE.MeshPhysicalNodeMaterial({ color: 0x14182c, roughness: 0.25, metalness: 0.3, clearcoat: 1 });
  const desk = new THREE.Mesh(new THREE.BoxGeometry(2, 1.1, 9), deskMat);
  desk.position.set(6, 0.55, 0); desk.castShadow = true; group.add(desk);
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.08, 9.3), new THREE.MeshStandardNodeMaterial({ color: 0xe2b25c, roughness: 0.3, metalness: 0.8 }));
  top.position.set(6, 1.14, 0); group.add(top);
  const glow = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 8.6), neonMaterial(new THREE.Color('#f2d18b'), 3));
  glow.position.set(7.02, 0.25, 0); group.add(glow);
  collider(1.1, 0.6, 4.6, 6, 0.6, 0);

  const logo = canvasTexture((g, w, h) => {
    g.fillStyle = '#0d1229'; g.fillRect(0, 0, w, h);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = '#e2b25c'; g.shadowBlur = 30; g.fillStyle = '#f2d18b'; g.font = '210px Allura, cursive'; g.fillText('IsAcademy', w / 2, h * 0.44);
    g.shadowBlur = 0; g.fillStyle = '#c9cde3'; g.font = '500 40px "Space Grotesk", sans-serif'; g.fillText(t('lobby.motto'), w / 2, h * 0.8);
  });
  const logoMat = new THREE.MeshBasicNodeMaterial(); logoMat.colorNode = texture(logo).rgb.mul(1.3);
  const logoWall = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), logoMat);
  logoWall.position.set(1.5, 3.6, 0); logoWall.rotation.y = Math.PI / 2; group.add(logoWall);
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(0.4, H, 14), new THREE.MeshStandardNodeMaterial({ color: 0x232a44, roughness: 0.6 }));
  backWall.position.set(1.2, H / 2, 0); group.add(backWall);
  collider(0.2, H / 2, 7, 1.2, H / 2, 0);

  // course screens on the side walls (redrawn with the language)
  const courses = t('lobby.courses');
  const screens = [];
  (Array.isArray(courses) ? courses : []).forEach((name, k) => {
    const tex = canvasTexture((g, w, h) => {
      const grd = g.createLinearGradient(0, 0, w, h); grd.addColorStop(0, '#0d1229'); grd.addColorStop(1, '#1b2247');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#3fe0ff'; g.lineWidth = 6; g.strokeRect(14, 14, w - 28, h - 28);
      g.fillStyle = '#3fe0ff'; g.font = '600 46px "Space Grotesk", sans-serif'; g.fillText('ISACADEMY', 60, 110);
      g.fillStyle = '#ffffff'; g.font = '700 110px "Space Grotesk", sans-serif'; g.fillText(name, 60, 280);
      g.fillStyle = '#e2b25c'; g.font = '500 44px "Space Grotesk", sans-serif'; g.fillText(t('lobby.screenLine'), 60, 400);
    });
    const mat = new THREE.MeshBasicNodeMaterial(); mat.colorNode = texture(tex).rgb.mul(sin(time.mul(0.8).add(k)).mul(0.08).add(1.1));
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
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.5), neonMaterial(new THREE.Color('#f2d18b'), 2.5));
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

  // warm interior light (the panels glow; two real lights give the marble its sheen)
  [[-8, -8], [-8, 8]].forEach(([x, z]) => {
    const l = new THREE.PointLight(0xffe2b8, 22, 22, 1.8); l.position.set(x, H - 0.6, z); group.add(l);
  });

  return {
    group,
    reception: { x: cx + 4.2, z: cz },
    contains(p, margin = 0) { return Math.abs(p.x - cx) < half + margin && Math.abs(p.z - cz) < half + margin && p.y < y0 + H; },
  };
}
