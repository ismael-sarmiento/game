// Street life that is not alive: trees that sway, benches and bins on the sidewalks, traffic lights at every crossing
// (the traffic obeys them), the campus park with lawns and a fountain, bus stops with IsAcademy posters and a
// hackathon tent on the campus plaza.
import * as THREE from 'three/webgpu';
import { vec3, time, float, mx_noise_float, positionWorld, mix, smoothstep, texture, uv, length, fract, abs, step } from 'three/tsl';
import { CITY, roadAt, blockAt, isCampus } from './layout.js';
import { NIGHT, WET } from './timeofday.js';
import { chunked, single, mergeStatic } from './chunks.js';
import { buildTreeKit, SPECIES_NAMES } from './trees.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const LIGHT = { GREEN: 0, YELLOW: 1, RED: 2 };
const CYCLE = 26, GREEN = 10, YELLOW = 3;           // seconds: each axis gets 10 s green + 3 s yellow

function place(scene, geometry, material, items, write, { shadow = true, tiles = false, far = Infinity } = {}) {
  const group = tiles ? chunked(geometry, material, items, write, far) : single(geometry, material, items, write);
  group.castShadow = shadow; group.receiveShadow = true;
  scene.add(group);
  return group;
}

// one instanced trunk and crown per species, for the trees of that species
function plantTrees(scene, kit, trees, far = Infinity) {
  const up = new THREE.Vector3(0, 1, 0);
  for (const [name, { wood, leaves }] of Object.entries(kit.species)) {
    const mine = trees.filter((t) => t.kind === name);
    if (!mine.length) continue;
    const write = (t, p, q, s) => { p.set(t.x, CITY.CURB, t.z); q.setFromAxisAngle(up, t.rot || 0); s.setScalar(t.s); };
    place(scene, wood, kit.woodMat, mine, write, { tiles: far < Infinity, far });
    place(scene, leaves, kit.leafMat, mine, write, { tiles: far < Infinity, far });   // street trees fade into the fog
  }
}

export class TrafficLights {
  constructor({ scene }) {
    this.offset = new Map();
    const poles = [];
    for (let i = 0; i <= CITY.N; i++) for (let j = 0; j <= CITY.N; j++) {
      this.offset.set(`${i},${j}`, ((i * 7 + j * 13) % CYCLE));
      const x = roadAt(i), z = roadAt(j), e = CITY.ROAD / 2 + 0.9;
      // one pole per approach, on the right-hand corner, its head over the lane it controls
      poles.push({ i, j, x: x + e, z: z - e, axis: 'z', face: Math.PI, dir: -1 },   // traffic heading -z
        { i, j, x: x - e, z: z + e, axis: 'z', face: 0, dir: 1 },                     // heading +z
        { i, j, x: x - e, z: z - e, axis: 'x', face: Math.PI / 2, dir: 1 },           // heading +x
        { i, j, x: x + e, z: z + e, axis: 'x', face: -Math.PI / 2, dir: -1 });        // heading -x
    }
    this.poles = poles;
    const dark = new THREE.MeshStandardNodeMaterial({ color: 0x1b1e26, roughness: 0.5, metalness: 0.7 });
    const up = new THREE.Vector3(0, 1, 0);
    place(scene, new THREE.CylinderGeometry(0.09, 0.12, 5.6, 6).translate(0, 2.8, 0), dark, poles, (pl, p) => p.set(pl.x, CITY.CURB, pl.z));
    // arm reaching over the road towards the lanes it controls
    place(scene, new THREE.BoxGeometry(0.1, 0.1, 4.2).translate(0, 5.4, 2.1), dark, poles, (pl, p, q) => { p.set(pl.x, CITY.CURB, pl.z); q.setFromAxisAngle(up, pl.face + Math.PI / 2); });
    place(scene, new THREE.BoxGeometry(0.42, 1.2, 0.32).translate(0, 4.8, 4.0), dark, poles, (pl, p, q) => { p.set(pl.x, CITY.CURB, pl.z); q.setFromAxisAngle(up, pl.face + Math.PI / 2); });
    // the lit lamp: one emissive disc per pole whose colour and height follow the state
    this.colors = new THREE.InstancedBufferAttribute(new Float32Array(poles.length * 3), 3);
    this.lampMat = new THREE.MeshBasicNodeMaterial();
    this.lamps = new THREE.InstancedMesh(new THREE.CircleGeometry(0.13, 12), this.lampMat, poles.length);
    this.lampMat.colorNode = vec3(1, 1, 1).mul(3.2);
    this.lamps.instanceColor = this.colors;
    this.lamps.frustumCulled = false;
    scene.add(this.lamps);
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.s = new THREE.Vector3(1, 1, 1);
    this.lastStates = '';
  }

  state(i, j, axis, t) {
    const k = (t + this.offset.get(`${i},${j}`)) % CYCLE;
    const xPhase = k < GREEN ? LIGHT.GREEN : k < GREEN + YELLOW ? LIGHT.YELLOW : LIGHT.RED;
    const zPhase = k >= CYCLE / 2 && k < CYCLE / 2 + GREEN ? LIGHT.GREEN : k >= CYCLE / 2 + GREEN ? LIGHT.YELLOW : LIGHT.RED;
    return axis === 'x' ? xPhase : zPhase;
  }

  // can a car heading along `axis` enter crossing (i, j) now?
  canGo(i, j, axis, t, distance) {
    const s = this.state(i, j, axis, t);
    return s === LIGHT.GREEN || (s === LIGHT.YELLOW && distance < 16);
  }

  update(t) {
    const cols = [new THREE.Color('#2bff88'), new THREE.Color('#ffb020'), new THREE.Color('#ff2a3a')];
    const heights = [4.4, 4.8, 5.2];
    const up = new THREE.Vector3(0, 1, 0);
    this.poles.forEach((pl, k) => {
      const st = this.state(pl.i, pl.j, pl.axis, t);
      const c = cols[st];
      this.colors.setXYZ(k, c.r, c.g, c.b);
      // lamp on the face of the head that looks at the oncoming cars
      this.q.setFromAxisAngle(up, pl.face + Math.PI / 2);
      this.v.set(0, heights[st], 4.0 + 0.17).applyQuaternion(this.q);
      this.v.add(new THREE.Vector3(pl.x, CITY.CURB, pl.z));
      const face = new THREE.Quaternion().setFromAxisAngle(up, pl.face + Math.PI);
      this.m.compose(this.v, face, this.s);
      this.lamps.setMatrixAt(k, this.m);
    });
    this.colors.needsUpdate = true;
    this.lamps.instanceMatrix.needsUpdate = true;
  }
}

export function buildProps({ scene, world, RAPIER }, lamps, textures) {
  const fixed = (shape, x, y, z) => world.createCollider(shape.setTranslation(x, y, z));
  const trees = [], benches = [], bins = [];
  const lampAt = new Set(lamps.map((l) => `${Math.round(l.x / 4)},${Math.round(l.z / 4)}`));
  const seedRand = (() => { let a = 12345; return () => ((a = (a * 1103515245 + 12345) % 2147483648) / 2147483648); })();

  for (let i = 0; i < CITY.N; i++) for (let j = 0; j < CITY.N; j++) {
    if (isCampus(i, j)) continue;
    const cx = blockAt(i), cz = blockAt(j), edge = CITY.BLOCK / 2 - 1.7;
    for (let u = -CITY.BLOCK / 2 + 9; u <= CITY.BLOCK / 2 - 9; u += 11) {
      [[cx + u, cz - edge, 0], [cx + u, cz + edge, Math.PI], [cx - edge, cz + u, Math.PI / 2], [cx + edge, cz + u, -Math.PI / 2]].forEach(([x, z, rot], side) => {
        if (lampAt.has(`${Math.round(x / 4)},${Math.round(z / 4)}`)) return;
        const r = seedRand();
        if (r < 0.62) trees.push({ x, z, s: 0.8 + seedRand() * 0.5, rot: seedRand() * 6.28 });
        else if (r < 0.8) benches.push({ x, z, rot });
        else if (r < 0.88) bins.push({ x, z });
      });
    }
  }

  // trees (see trees.js): a linden or a maple at random, swaying with the wind (stronger in storms), in a tree pit
  // with a cast-iron grate
  const kit = buildTreeKit(textures);
  trees.forEach((t) => { t.kind = SPECIES_NAMES[Math.floor(seedRand() * SPECIES_NAMES.length)]; });
  plantTrees(scene, kit, trees, 380);
  const grate = new THREE.MeshStandardNodeMaterial({ roughness: 0.55, metalness: 0.6 });
  const g = uv().sub(0.5), ring = length(g);
  // concentric slots around an opening for the trunk, soil showing through
  const slots = step(0.5, fract(ring.mul(16))).mul(step(0.14, ring)).mul(step(abs(g.x).max(abs(g.y)), 0.47));
  grate.colorNode = mix(vec3(0.07, 0.055, 0.04), vec3(0.16, 0.16, 0.17), slots);
  place(scene, new THREE.BoxGeometry(1.3, 0.04, 1.3), grate, trees, (t, p) => p.set(t.x, CITY.CURB + 0.02, t.z), { shadow: false });
  trees.forEach((t) => fixed(RAPIER.ColliderDesc.cylinder(1.8, 0.22), t.x, CITY.CURB + 1.8, t.z));

  // benches facing the road and litter bins
  const up = new THREE.Vector3(0, 1, 0);
  const wood = new THREE.MeshStandardNodeMaterial({ color: 0x6b4a2f, roughness: 0.8 });
  const iron = new THREE.MeshStandardNodeMaterial({ color: 0x23262d, roughness: 0.5, metalness: 0.7 });
  place(scene, new THREE.BoxGeometry(1.8, 0.08, 0.5).translate(0, 0.46, 0), wood, benches, (b, p, q) => { p.set(b.x, CITY.CURB, b.z); q.setFromAxisAngle(up, b.rot); });
  place(scene, new THREE.BoxGeometry(1.8, 0.45, 0.06).translate(0, 0.78, -0.24), wood, benches, (b, p, q) => { p.set(b.x, CITY.CURB, b.z); q.setFromAxisAngle(up, b.rot); });
  place(scene, new THREE.BoxGeometry(1.7, 0.44, 0.4).translate(0, 0.22, 0), iron, benches, (b, p, q, s) => { p.set(b.x, CITY.CURB, b.z); q.setFromAxisAngle(up, b.rot); s.set(1, 1, 0.2); });
  place(scene, new THREE.CylinderGeometry(0.28, 0.24, 0.9, 10).translate(0, 0.45, 0), new THREE.MeshStandardNodeMaterial({ color: 0x1f3b2c, roughness: 0.6, metalness: 0.4 }), bins, (b, p) => p.set(b.x, CITY.CURB, b.z));
  benches.forEach((b) => fixed(RAPIER.ColliderDesc.cuboid(0.9, 0.45, 0.3), b.x, CITY.CURB + 0.45, b.z));

  buildPark(scene, world, RAPIER, kit, wood);
  return { trees: trees.length, benches: benches.length, wind: kit.wind };
}

// Campus park (block 5, 6): lawns with paths, trees, benches and a fountain with a lit pool at night.
function buildPark(scene, world, RAPIER, kit, wood) {
  const cx = blockAt(5), cz = blockAt(6);
  const grass = new THREE.MeshStandardNodeMaterial({ roughness: 0.95 });
  const g = mx_noise_float(positionWorld.xz.mul(0.35)).mul(0.5).add(0.5);
  const blades = mx_noise_float(positionWorld.xz.mul(7)).mul(0.5).add(0.5);
  grass.colorNode = mix(vec3(0.09, 0.2, 0.06), vec3(0.2, 0.32, 0.1), g.mul(0.7).add(blades.mul(0.3))).mul(float(1).sub(WET.mul(0.2)));
  const lawns = [[-14, -14], [14, -14], [-14, 14], [14, 14]];
  lawns.forEach(([ox, oz]) => {
    const lawn = new THREE.Mesh(new THREE.BoxGeometry(22, 0.12, 22), grass);
    lawn.position.set(cx + ox, CITY.CURB + 0.06, cz + oz); lawn.receiveShadow = true; scene.add(lawn);
  });
  const trees = [];
  lawns.forEach(([ox, oz]) => { for (let k = 0; k < 3; k++) trees.push({ x: cx + ox + Math.cos(k * 2.1 + ox) * 6.5, z: cz + oz + Math.sin(k * 2.1 + oz) * 6.5, s: 1.1 + (k % 2) * 0.35 }); });
  trees.forEach((t, k) => { t.kind = 'linden'; t.rot = k * 1.7; });
  plantTrees(scene, kit, trees);
  trees.forEach((t) => world.createCollider(RAPIER.ColliderDesc.cylinder(1.8, 0.25).setTranslation(t.x, CITY.CURB + 1.8, t.z)));

  // fountain in the middle of the paths
  const stone = new THREE.MeshStandardNodeMaterial({ color: 0xb9b4aa, roughness: 0.7 });
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.8, 0.7, 40, 1, true), stone);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(4.7, 0.25, 8, 48).rotateX(Math.PI / 2), stone);
  const water = new THREE.Mesh(new THREE.CircleGeometry(4.55, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardNodeMaterial({ color: 0x0d2a36, roughness: 0.04, metalness: 0.1 }));
  const ripple = mx_noise_float(positionWorld.xz.mul(2.2).add(vec3(time.mul(0.6), 0, 0).xz)).mul(0.5).add(0.5);
  water.material.emissiveNode = vec3(0.1, 0.55, 0.75).mul(smoothstep(0.55, 0.9, ripple)).mul(NIGHT.mul(0.9).add(0.05));
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 2.2, 16), stone);
  const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.25, 2.6, 12, 1, true), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(0.75, 0.9, 1).multiplyScalar(1.4), transparent: true, opacity: 0.55, depthWrite: false }));
  basin.position.set(cx, CITY.CURB + 0.35, cz); rim.position.set(cx, CITY.CURB + 0.7, cz); water.position.set(cx, CITY.CURB + 0.55, cz);
  column.position.set(cx, CITY.CURB + 1.1, cz); jet.position.set(cx, CITY.CURB + 3.4, cz);
  [basin, rim, column].forEach((m) => { m.castShadow = true; m.receiveShadow = true; });
  scene.add(basin, rim, water, column, jet);
  world.createCollider(RAPIER.ColliderDesc.cylinder(0.4, 4.9).setTranslation(cx, CITY.CURB + 0.4, cz));
  const benches = [[0, -8, 0], [0, 8, Math.PI], [-8, 0, Math.PI / 2], [8, 0, -Math.PI / 2]].map(([ox, oz, rot]) => ({ x: cx + ox, z: cz + oz, rot }));
  const up = new THREE.Vector3(0, 1, 0);
  place(scene, new THREE.BoxGeometry(2.2, 0.1, 0.55).translate(0, 0.46, 0), wood, benches, (b, p, q) => { p.set(b.x, CITY.CURB, b.z); q.setFromAxisAngle(up, b.rot); });
}

export { LIGHT };

// Bus stops: glass shelter with a bench and a lit IsAcademy poster, on the kerb where buses pull in.
export function buildBusStops({ scene, world, RAPIER }, t) {
  const e = CITY.ROAD / 2 + 1.2;
  const defs = [
    [roadAt(2), blockAt(3), 0, 1], [roadAt(2), blockAt(8), 0, -1], [roadAt(6), blockAt(3), 0, 1], [roadAt(6), blockAt(8), 0, -1],
    [roadAt(10), blockAt(3), 0, -1], [roadAt(10), blockAt(8), 0, 1], [blockAt(3), roadAt(4), 1, 1], [blockAt(8), roadAt(4), 1, -1],
    [blockAt(4), roadAt(8), 1, -1], [blockAt(9), roadAt(8), 1, 1],
  ];
  // [road coordinate, along, 0 = road runs along z / 1 = along x, travel direction] → stop on the right-hand kerb
  const stops = defs.map(([a, b, alongX, dir]) => {
    if (!alongX) { const x = a - dir * e; return { x, z: b, face: dir > 0 ? Math.PI / 2 : -Math.PI / 2 }; }
    const z = b + dir * e; return { x: a, z, face: dir > 0 ? Math.PI : 0 };
  }).map((s) => ({ ...s, x: s.x, z: s.z }));
  // three IsAcademy posters side by side on one canvas (a course each); every stop shows one of them
  const subjects = t('lobby.subjects');
  const featured = [subjects[0], subjects[2], subjects[6]];   // Python, SQL, AI
  const posterTex = (() => {
    const c = document.createElement('canvas'); c.width = 768; c.height = 512;
    const g = c.getContext('2d');
    featured.forEach((course, i) => {
      const x = i * 256;
      g.fillStyle = '#f1ece2'; g.fillRect(x, 0, 256, 512);
      g.fillStyle = '#14171c'; g.fillRect(x, 0, 256, 300);
      g.textAlign = 'left'; g.fillStyle = '#d9b26a'; g.font = '62px Allura, cursive'; g.fillText('Is', x + 24, 74);
      g.fillStyle = '#f1ece2'; g.font = '600 34px "Space Grotesk", sans-serif'; g.fillText('Academy', x + 70, 70);
      g.font = '700 40px "Space Grotesk", sans-serif'; g.fillText(course, x + 24, 190, 210);
      g.fillStyle = '#d9b26a'; g.fillRect(x + 24, 214, 60, 4);
      g.fillStyle = '#1f2329'; g.font = '600 22px "Space Grotesk", sans-serif';
      String(t('lobby.motto')).split('. ').forEach((line, k) => g.fillText(line.replace(/\.$/, ''), x + 24, 352 + k * 30, 210));
      g.fillStyle = '#5b6470'; g.font = '400 13px "Space Grotesk", sans-serif'; g.fillText('ismael-sarmiento.github.io/isacademy', x + 24, 480, 210);
    });
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 4; return tx;
  })();
  const frame = new THREE.MeshStandardNodeMaterial({ color: 0x2a2f3a, roughness: 0.4, metalness: 0.8 });
  const glass = new THREE.MeshPhysicalNodeMaterial({ color: 0xcfe3ee, transparent: true, opacity: 0.25, roughness: 0.05, depthWrite: false });
  const poster = new THREE.MeshBasicNodeMaterial(); poster.colorNode = texture(posterTex).rgb.mul(NIGHT.mul(0.25).add(0.75));   // a backlit panel
  const wood = new THREE.MeshStandardNodeMaterial({ color: 0x6b4a2f, roughness: 0.8 });
  const all = new THREE.Group();
  stops.forEach((s, k) => {
    const g = new THREE.Group();
    const back = new THREE.Mesh(new THREE.BoxGeometry(4, 2.3, 0.05), glass); back.position.set(0, 1.25, -0.9);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.1, 1.9), frame); roof.position.set(0, 2.45, 0);
    const ad = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.0, 0.12), frame); ad.position.set(2.1, 1.15, -0.2);
    const faceGeo = new THREE.PlaneGeometry(1.0, 1.9), fuv = faceGeo.attributes.uv;
    for (let n = 0; n < fuv.count; n++) fuv.setX(n, (fuv.getX(n) + (k % 3)) / 3);   // this stop's poster
    const face = new THREE.Mesh(faceGeo, poster); face.position.set(2.1, 1.15, -0.13);
    const bench = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 0.45), wood); bench.position.set(-0.3, 0.48, -0.6);
    [[-2, -0.9], [-2, 0.85], [1.55, -0.9]].forEach(([x, z]) => { const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.4, 0.08), frame); p.position.set(x, 1.2, z); g.add(p); });
    [back, roof, ad, face, bench].forEach((m) => { m.castShadow = true; g.add(m); });
    g.position.set(s.x, CITY.CURB, s.z); g.rotation.y = s.face;
    all.add(g);
    const fwd = new THREE.Vector3(0, 0, -0.9).applyAxisAngle(new THREE.Vector3(0, 1, 0), s.face);
    world.createCollider(RAPIER.ColliderDesc.cuboid(2, 1.2, 0.1).setTranslation(s.x + fwd.x, CITY.CURB + 1.2, s.z + fwd.z).setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.face)));
  });
  scene.add(mergeStatic(all, mergeGeometries));   // ten shelters, one mesh per material
  return stops;
}

// Hackathon on the campus plaza: a white canopy tent with a banner, two long tables with laptops and a screen with
// code, so the campus reads as a place where people build things together.
export function buildHackathon({ scene, world, RAPIER }, at, t) {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardNodeMaterial({ color: 0xf2f1ec, roughness: 0.8, side: THREE.DoubleSide });
  const metal = new THREE.MeshStandardNodeMaterial({ color: 0x9aa0a8, roughness: 0.35, metalness: 0.9 });
  const dark = new THREE.MeshStandardNodeMaterial({ color: 0x24272c, roughness: 0.45, metalness: 0.6 });
  const top = new THREE.MeshStandardNodeMaterial({ color: 0xd8cbb4, roughness: 0.5 });
  const W = 9, D = 6, H = 2.6;
  // tent: four poles, a pyramid roof and a valance
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sz]) => { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, H, 6), metal); p.position.set(sx * W / 2, H / 2, sz * D / 2); g.add(p); });
  const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(W, D) / 2, 1.3, 4, 1, true).rotateY(Math.PI / 4).scale(1, 1, D / W), white);
  roof.position.y = H + 0.65; roof.castShadow = true; g.add(roof);
  const banner = canvasTex((c) => {
    c.fillStyle = '#14171c'; c.fillRect(0, 0, 1024, 128);
    c.fillStyle = '#d9b26a'; c.font = '72px Allura, cursive'; c.fillText('Is', 30, 92);
    c.fillStyle = '#f1ece2'; c.font = '600 46px "Space Grotesk", sans-serif'; c.fillText(t('world.hackathon'), 100, 84, 900);
  }, 1024, 128);
  [-1, 1].forEach((sz) => {
    const val = new THREE.Mesh(new THREE.PlaneGeometry(W, W / 8), new THREE.MeshStandardNodeMaterial({ map: banner, roughness: 0.7 }));
    val.position.set(0, H - W / 16, sz * (D / 2 + 0.01)); val.rotation.y = sz > 0 ? 0 : Math.PI; g.add(val);
  });
  // two long tables with laptops facing each other
  const screen = new THREE.MeshBasicNodeMaterial(); screen.colorNode = vec3(0.55, 0.68, 0.85).mul(0.9);
  [-1.3, 1.3].forEach((x) => {
    const tt = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.05, 4.4), top); tt.position.set(x, 0.75, 0); tt.castShadow = true; g.add(tt);
    [-2, 2].forEach((dz) => { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.72, 0.05), dark); leg.position.set(x, 0.36, dz); g.add(leg); });
    [-1.5, 0, 1.5].forEach((dz) => [-1, 1].forEach((side) => {
      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.22, 0.32), dark); lid.position.set(x + side * 0.2, 0.89, dz); lid.rotation.z = side * 0.25; g.add(lid);
      const sc = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.18), screen); sc.position.set(x + side * 0.19, 0.89, dz); sc.rotation.set(0, -side * Math.PI / 2, -side * 0.25); g.add(sc);
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.015, 0.32), dark); base.position.set(x + side * 0.06, 0.785, dz); g.add(base);
    }));
  });
  // screen on a stand at the back with code on it
  const code = canvasTex((c) => {
    c.fillStyle = '#0b0f16'; c.fillRect(0, 0, 512, 288);
    c.font = '500 22px Menlo, Consolas, monospace';
    ['import pandas as pd', '', "df = pd.read_csv('bicis.csv')", "df.groupby('barrio')['viajes'].sum()", '  .sort_values(ascending=False)', '  .head(5)']
      .forEach((line, i) => { c.fillStyle = i === 0 ? '#d9b26a' : '#cfe3f2'; c.fillText(line, 24, 48 + i * 36); });
  }, 512, 288);
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.6, 0.08), dark); stand.position.set(0, 0.8, -D / 2 + 0.5); g.add(stand);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.1, 0.06), dark); panel.position.set(0, 1.9, -D / 2 + 0.5); g.add(panel);
  const codeMat = new THREE.MeshBasicNodeMaterial(); codeMat.colorNode = texture(code).rgb.mul(0.95);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.0), codeMat); face.position.set(0, 1.9, -D / 2 + 0.54); g.add(face);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.position.set(at.x, CITY.CURB, at.z);
  [-1.3, 1.3].forEach((x) => world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.4, 2.2).setTranslation(at.x + x, CITY.CURB + 0.4, at.z)));
  scene.add(mergeStatic(g, mergeGeometries));
}

function canvasTex(draw, w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'));
  const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 4; return tx;
}
