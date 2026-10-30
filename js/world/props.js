// Street life that is not alive: trees that sway, benches and bins on the sidewalks, traffic lights at every crossing
// (the traffic obeys them) and the campus park with lawns and a fountain.
import * as THREE from 'three/webgpu';
import { positionLocal, vec3, sin, time, instanceIndex, hash, float, mx_noise_float, positionWorld, mix, smoothstep, uniform } from 'three/tsl';
import { CITY, roadAt, blockAt, isCampus } from './layout.js';
import { NIGHT, WET } from './timeofday.js';

const LIGHT = { GREEN: 0, YELLOW: 1, RED: 2 };
const CYCLE = 26, GREEN = 10, YELLOW = 3;           // seconds: each axis gets 10 s green + 3 s yellow

function place(scene, geometry, material, items, write, { shadow = true } = {}) {
  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  items.forEach((it, i) => { s.set(1, 1, 1); q.identity(); write(it, p, q, s); m.compose(p, q, s); mesh.setMatrixAt(i, m); });
  mesh.castShadow = shadow; mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  scene.add(mesh);
  return mesh;
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

export function buildProps({ scene, world, RAPIER }, lamps) {
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

  // trees: trunk, a lumpy canopy that sways with the wind (stronger in storms) and a dark tree pit
  const wind = uniform(1);
  const trunkMat = new THREE.MeshStandardNodeMaterial({ color: 0x4a3a2c, roughness: 0.95 });
  const leafMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.85 });
  const seed = hash(float(instanceIndex).mul(1.37));
  const sway = sin(time.mul(1.4).add(seed.mul(30))).mul(0.12).mul(wind).mul(positionLocal.y.sub(2.4).max(0));
  leafMat.positionNode = positionLocal.add(vec3(sway, 0, sway.mul(0.6)));
  const leafNoise = mx_noise_float(positionWorld.mul(1.6)).mul(0.5).add(0.5);
  leafMat.colorNode = mix(vec3(0.06, 0.12, 0.035), vec3(0.2, 0.3, 0.07), leafNoise.mul(seed.mul(0.6).add(0.4))).mul(float(1).sub(WET.mul(0.25)));
  // light passing through the leaves keeps the shaded side from going black
  leafMat.emissiveNode = vec3(0.025, 0.045, 0.012).mul(float(1).sub(NIGHT));
  // canopy: five leafy clumps around the crown, each shaded as a soft ball (normals from its own centre)
  const clumps = [[0, 4.6, 0, 1.5], [1.0, 4.1, 0.4, 1.15], [-0.9, 4.2, -0.5, 1.2], [0.3, 3.8, -1.0, 1.05], [-0.4, 5.3, 0.6, 1.0]];
  const posArr = [], nrmArr = [];
  clumps.forEach(([cx, cy, cz, rr], ci) => {
    const g = new THREE.IcosahedronGeometry(rr, 1);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, k);
      const n = v.clone().normalize();
      const bump = 1 + 0.16 * Math.sin(v.x * 5.1 + ci) * Math.cos(v.z * 4.3 + v.y * 3.7);
      v.multiplyScalar(bump);
      posArr.push(v.x + cx, v.y * 0.9 + cy, v.z + cz);
      nrmArr.push(n.x, n.y, n.z);
    }
  });
  const canopy = new THREE.BufferGeometry();
  canopy.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
  canopy.setAttribute('normal', new THREE.Float32BufferAttribute(nrmArr, 3));
  const up = new THREE.Vector3(0, 1, 0);
  place(scene, new THREE.CylinderGeometry(0.13, 0.2, 3.6, 7).translate(0, 1.8, 0), trunkMat, trees, (t, p, q, s) => { p.set(t.x, CITY.CURB, t.z); s.setScalar(t.s); });
  place(scene, canopy, leafMat, trees, (t, p, q, s) => { p.set(t.x, CITY.CURB, t.z); q.setFromAxisAngle(up, t.rot); s.setScalar(t.s); });
  place(scene, new THREE.BoxGeometry(1.3, 0.04, 1.3), new THREE.MeshStandardNodeMaterial({ color: 0x1c1712, roughness: 1 }), trees, (t, p) => p.set(t.x, CITY.CURB + 0.02, t.z), { shadow: false });
  trees.forEach((t) => fixed(RAPIER.ColliderDesc.cylinder(1.8, 0.22), t.x, CITY.CURB + 1.8, t.z));

  // benches facing the road and litter bins
  const wood = new THREE.MeshStandardNodeMaterial({ color: 0x6b4a2f, roughness: 0.8 });
  const iron = new THREE.MeshStandardNodeMaterial({ color: 0x23262d, roughness: 0.5, metalness: 0.7 });
  place(scene, new THREE.BoxGeometry(1.8, 0.08, 0.5).translate(0, 0.46, 0), wood, benches, (b, p, q) => { p.set(b.x, CITY.CURB, b.z); q.setFromAxisAngle(up, b.rot); });
  place(scene, new THREE.BoxGeometry(1.8, 0.45, 0.06).translate(0, 0.78, -0.24), wood, benches, (b, p, q) => { p.set(b.x, CITY.CURB, b.z); q.setFromAxisAngle(up, b.rot); });
  place(scene, new THREE.BoxGeometry(1.7, 0.44, 0.4).translate(0, 0.22, 0), iron, benches, (b, p, q, s) => { p.set(b.x, CITY.CURB, b.z); q.setFromAxisAngle(up, b.rot); s.set(1, 1, 0.2); });
  place(scene, new THREE.CylinderGeometry(0.28, 0.24, 0.9, 10).translate(0, 0.45, 0), new THREE.MeshStandardNodeMaterial({ color: 0x1f3b2c, roughness: 0.6, metalness: 0.4 }), bins, (b, p) => p.set(b.x, CITY.CURB, b.z));
  benches.forEach((b) => fixed(RAPIER.ColliderDesc.cuboid(0.9, 0.45, 0.3), b.x, CITY.CURB + 0.45, b.z));

  buildPark(scene, world, RAPIER, trunkMat, leafMat, canopy, wood);
  return { trees: trees.length, benches: benches.length, wind };
}

// Campus park (block 5, 6): lawns with paths, trees, benches and a fountain with a lit pool at night.
function buildPark(scene, world, RAPIER, trunkMat, leafMat, canopy, wood) {
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
  place(scene, new THREE.CylinderGeometry(0.15, 0.24, 3.6, 7).translate(0, 1.8, 0), trunkMat, trees, (t, p, q, s) => { p.set(t.x, CITY.CURB, t.z); s.setScalar(t.s); });
  place(scene, canopy, leafMat, trees, (t, p, q, s) => { p.set(t.x, CITY.CURB, t.z); s.setScalar(t.s); });
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
