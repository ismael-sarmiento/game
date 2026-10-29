// Neo Academia: ground, blocks, buildings, rooftop neon, street lamps, the IsAcademy tower, the skyline beyond the
// playable area and the static physics colliders. Everything is instanced: a handful of draw calls for the whole city.
import * as THREE from 'three/webgpu';
import { CITY, roadAt, blockAt, isCampus, districtAt, rng } from './layout.js';
import { buildingMaterial, groundMaterial, pavementMaterial, neonMaterial, NIGHT } from './materials.js';
import { texture } from 'three/tsl';

const unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

function instanced(geometry, material, items, write) {
  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  items.forEach((it, i) => { write(it, p, q, s); m.compose(p, q, s); mesh.setMatrixAt(i, m); });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

function radialTexture(inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, inner); grd.addColorStop(1, outer);
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildCity({ scene, world, RAPIER }) {
  const rand = rng(2026);
  const fixed = (hx, hy, hz, x, y, z) => world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(0.6));
  const buildings = [], slabs = [], plazas = [], strips = [], antennas = [], signAnchors = [];

  // ground and invisible bounds
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(3200, 3200).rotateX(-Math.PI / 2), groundMaterial());
  ground.receiveShadow = true;
  scene.add(ground);
  fixed(1600, 1, 1600, 0, -1, 0);
  const wall = CITY.HALF + 2;
  [[wall, 0, 1, 40, wall], [-wall, 0, 1, 40, wall], [0, wall, wall, 40, 1], [0, -wall, wall, 40, 1]].forEach(([x, z, hx, hy, hz]) => fixed(hx, hy, hz, x, hy, z));

  const accentOf = (x, z) => new THREE.Color(districtAt(x, z).color);
  const addBuilding = (x, z, w, d, h, y = CITY.CURB, collider = true) => {
    buildings.push({ x, y, z, w, d, h, accent: accentOf(x, z), seed: rand() });
    if (collider) fixed(w / 2, h / 2, d / 2, x, y + h / 2, z);
  };

  for (let i = 0; i < CITY.N; i++) {
    for (let j = 0; j < CITY.N; j++) {
      const cx = blockAt(i), cz = blockAt(j);
      const campus = isCampus(i, j);
      (campus ? plazas : slabs).push({ x: cx, z: cz });
      fixed(CITY.BLOCK / 2, CITY.CURB / 2, CITY.BLOCK / 2, cx, CITY.CURB / 2, cz);
      if (campus) continue;

      const inner = CITY.BLOCK - CITY.SIDEWALK * 2;
      const dist = Math.max(Math.abs(cx), Math.abs(cz)) / CITY.HALF;
      const hMax = THREE.MathUtils.lerp(150, 34, dist);
      const layout = rand();
      const lots = layout < 0.22 ? [[0, 0, 1, 1]]
        : layout < 0.5 ? [[-0.25, 0, 0.5, 1], [0.25, 0, 0.5, 1]]
        : layout < 0.72 ? [[0, -0.25, 1, 0.5], [-0.25, 0.25, 0.5, 0.5], [0.25, 0.25, 0.5, 0.5]]
        : [[-0.25, -0.25, 0.5, 0.5], [0.25, -0.25, 0.5, 0.5], [-0.25, 0.25, 0.5, 0.5], [0.25, 0.25, 0.5, 0.5]];
      for (const [ox, oz, fw, fd] of lots) {
        const w = inner * fw - 2.4 - rand() * 3, d = inner * fd - 2.4 - rand() * 3;
        const x = cx + ox * inner, z = cz + oz * inner;
        const h = Math.max(12, hMax * (0.3 + rand() * 0.7) * (fw * fd < 0.5 ? 0.85 : 1));
        addBuilding(x, z, w, d, h);
        const top = CITY.CURB + h;
        if (h > 45 && rand() < 0.55) {
          const h2 = h * (0.15 + rand() * 0.25);
          addBuilding(x, z, w * 0.66, d * 0.66, h2, top, false);
          if (rand() < 0.6) antennas.push({ x, z, y: top + h2, h: 8 + rand() * 18 });
        } else if (h > 30 && rand() < 0.3) antennas.push({ x, z, y: top, h: 6 + rand() * 10 });
        if (rand() < 0.5) {
          const c = accentOf(x, z);
          strips.push({ x, z: z - d / 2, y: top, sx: w, sz: 0.35, c }, { x, z: z + d / 2, y: top, sx: w, sz: 0.35, c },
            { x: x - w / 2, z, y: top, sx: 0.35, sz: d, c }, { x: x + w / 2, z, y: top, sx: 0.35, sz: d, c });
        }
        // facade that looks onto the nearest road: anchor for neon signs
        const sides = [
          { gap: (cx + CITY.BLOCK / 2) - (x + w / 2), nx: 1, nz: 0, px: x + w / 2, pz: z, span: d },
          { gap: (x - w / 2) - (cx - CITY.BLOCK / 2), nx: -1, nz: 0, px: x - w / 2, pz: z, span: d },
          { gap: (cz + CITY.BLOCK / 2) - (z + d / 2), nx: 0, nz: 1, px: x, pz: z + d / 2, span: w },
          { gap: (z - d / 2) - (cz - CITY.BLOCK / 2), nx: 0, nz: -1, px: x, pz: z - d / 2, span: w },
        ].sort((a, b) => a.gap - b.gap);
        signAnchors.push({ ...sides[0], h, district: districtAt(x, z).key });
      }
    }
  }

  // IsAcademy tower in the campus block (5, 5): three tiers and a golden crown
  const tx = blockAt(5), tz = blockAt(5);
  addBuilding(tx, tz, 34, 34, 70);
  addBuilding(tx, tz, 26, 26, 60, CITY.CURB + 70, false);
  addBuilding(tx, tz, 18, 18, 46, CITY.CURB + 130, false);
  const towerTop = CITY.CURB + 176;
  const gold = new THREE.Color('#f2d18b');
  [[34, 70], [26, 130], [18, towerTop]].forEach(([s, y]) => {
    strips.push({ x: tx, z: tz - s / 2, y, sx: s, sz: 0.5, c: gold }, { x: tx, z: tz + s / 2, y, sx: s, sz: 0.5, c: gold },
      { x: tx - s / 2, z: tz, y, sx: 0.5, sz: s, c: gold }, { x: tx + s / 2, z: tz, y, sx: 0.5, sz: s, c: gold });
  });
  antennas.push({ x: tx, z: tz, y: towerTop, h: 30 });

  // skyline beyond the playable area (no colliders; the fog sells the scale)
  const skyline = [];
  for (let k = 0; k < 220; k++) {
    const a = rand() * Math.PI * 2, r = 620 + rand() * 520;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const w = 30 + rand() * 50, h = 40 + rand() * rand() * 260;
    skyline.push({ x, y: 0, z, w, d: 30 + rand() * 50, h, accent: new THREE.Color(['#3fe0ff', '#e2b25c', '#a98bff', '#5dffa8'][k % 4]), seed: rand() });
  }

  // instanced meshes
  const all = buildings.concat(skyline);
  const seeds = new THREE.InstancedBufferAttribute(new Float32Array(all.length), 1);
  const accents = new THREE.InstancedBufferAttribute(new Float32Array(all.length * 3), 3);
  all.forEach((b, i) => { seeds.setX(i, b.seed); accents.setXYZ(i, b.accent.r, b.accent.g, b.accent.b); });
  const towers = instanced(unitBox, buildingMaterial(seeds, accents), all, (b, p, q, s) => { p.set(b.x, b.y, b.z); s.set(b.w, b.h, b.d); });
  towers.castShadow = true; towers.receiveShadow = true;
  scene.add(towers);

  const slabMesh = instanced(unitBox, pavementMaterial(false), slabs, (b, p, q, s) => { p.set(b.x, 0, b.z); s.set(CITY.BLOCK, CITY.CURB, CITY.BLOCK); });
  const plazaMesh = instanced(unitBox, pavementMaterial(true), plazas, (b, p, q, s) => { p.set(b.x, 0, b.z); s.set(CITY.BLOCK, CITY.CURB, CITY.BLOCK); });
  slabMesh.receiveShadow = plazaMesh.receiveShadow = true;
  scene.add(slabMesh, plazaMesh);

  const stripColors = new THREE.InstancedBufferAttribute(new Float32Array(strips.length * 3), 3);
  strips.forEach((st, i) => stripColors.setXYZ(i, st.c.r, st.c.g, st.c.b));
  scene.add(instanced(unitBox, neonMaterial(stripColors, 3.2, {}, 0.2), strips, (st, p, q, s) => { p.set(st.x, st.y, st.z); s.set(st.sx, 0.35, st.sz); }));

  const antennaMesh = instanced(new THREE.CylinderGeometry(0.12, 0.25, 1, 6).translate(0, 0.5, 0),
    new THREE.MeshStandardNodeMaterial({ color: 0x1a1f33, roughness: 0.5, metalness: 0.8 }), antennas,
    (a, p, q, s) => { p.set(a.x, a.y, a.z); s.set(1, a.h, 1); });
  scene.add(antennaMesh);
  scene.add(instanced(new THREE.SphereGeometry(0.45, 8, 6), neonMaterial(new THREE.Color('#ff3355'), 4), antennas,
    (a, p, q, s) => { p.set(a.x, a.y + a.h, a.z); s.set(1, 1, 1); }));

  // the tower's beacon: a slow golden light column visible from everywhere
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 2.2, 900, 16, 1, true).translate(0, 450, 0),
    new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(0.9, 0.65, 0.25), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  beacon.material.opacityNode = NIGHT.mul(0.07);
  beacon.position.set(tx, towerTop + 30, tz);
  scene.add(beacon);

  // street lamps along every road, both sides, skipping crossings
  const lamps = [];
  for (let i = 0; i <= CITY.N; i++) {
    const r = roadAt(i);
    for (let s = -CITY.HALF + 20; s < CITY.HALF - 10; s += 34) {
      const near = Math.abs(s - roadAt(Math.round((s + CITY.HALF - CITY.ROAD / 2) / CITY.PITCH)));
      if (near < 13) continue;
      const side = (Math.round(s / 34) % 2 === 0) ? 1 : -1;
      lamps.push({ x: r + side * (CITY.ROAD / 2 + 0.8), z: s, dx: -side, dz: 0 });
      lamps.push({ x: s, z: r - side * (CITY.ROAD / 2 + 0.8), dx: 0, dz: side });
    }
  }
  const poleMat = new THREE.MeshStandardNodeMaterial({ color: 0x151a2c, roughness: 0.4, metalness: 0.9 });
  scene.add(instanced(new THREE.CylinderGeometry(0.1, 0.16, 7.5, 6).translate(0, 3.75, 0), poleMat, lamps,
    (l, p, q, s) => { p.set(l.x, CITY.CURB, l.z); s.set(1, 1, 1); }));
  scene.add(instanced(new THREE.BoxGeometry(0.5, 0.18, 2.6), neonMaterial(new THREE.Color('#ffd9a0'), 3, {}, 0.04), lamps,
    (l, p, q, s) => { p.set(l.x + l.dx * 1.1, CITY.CURB + 7.5, l.z + l.dz * 1.1); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), l.dx ? Math.PI / 2 : 0); s.set(1, 1, 1); }));
  const poolMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const poolTex = texture(radialTexture('rgba(255,200,130,0.3)', 'rgba(255,200,130,0)'));
  poolMat.colorNode = poolTex.rgb; poolMat.opacityNode = poolTex.a.mul(NIGHT);   // lamps light the street only at night
  const pools = instanced(new THREE.PlaneGeometry(13, 13).rotateX(-Math.PI / 2), poolMat, lamps,
    (l, p, q, s) => { p.set(l.x + l.dx * 3.2, 0.03, l.z + l.dz * 3.2); s.set(1, 1, 1); });
  pools.renderOrder = 1;
  scene.add(pools);

  return { buildings, signAnchors, lamps, tower: { x: tx, z: tz, top: towerTop } };
}
