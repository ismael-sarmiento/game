// Street trees from CC0 scans (see CREDITS.md): a bark-textured trunk that forks into limbs and branches, and a crown
// of leafy twig cards (alpha-tested) whose normals point out of the crown, so the light reads one leafy volume instead
// of flat cards. Two species: a round linden and a taller maple. Every card is built twice, once per winding, so both
// faces keep the crown's normals (a double-sided material would flip them on the back face).
import * as THREE from 'three/webgpu';
import { positionLocal, vec3, vec4, sin, time, instanceIndex, hash, float, mix, uniform, texture, uv, attribute, normalLocal } from 'three/tsl';
import { NIGHT, WET } from './timeofday.js';

const SPECIES = {
  linden: { trunk: 2.5, lean: 0.12, r0: 0.19, crown: new THREE.Vector3(0, 5.0, 0), radius: new THREE.Vector3(2.5, 2.1, 2.5), limbs: 5, cards: 120, card: 1.45, u0: 0, seed: 3 },
  maple: { trunk: 2.8, lean: 0.08, r0: 0.16, crown: new THREE.Vector3(0, 5.5, 0), radius: new THREE.Vector3(1.9, 2.6, 1.9), limbs: 4, cards: 110, card: 1.35, u0: 0.5, seed: 11 },
};
export const SPECIES_NAMES = Object.keys(SPECIES);

function random(seed) {
  let a = seed * 9301 + 49297;
  return () => ((a = (a * 1103515245 + 12345) % 2147483648) / 2147483648);
}

// a tapered tube along a curve, with bark UVs about 0.6 m wide around and 0.8 m along
function tube(points, r0, r1, radial, segs, out) {
  const curve = new THREE.CatmullRomCurve3(points);
  const frames = curve.computeFrenetFrames(segs, false);
  const length = curve.getLength();
  const wraps = Math.max(1, Math.round((Math.PI * 2 * r0) / 0.6));
  const base = out.pos.length / 3;
  const n = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, p = curve.getPointAt(t), r = r0 + (r1 - r0) * t;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      n.copy(frames.normals[i]).multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a));
      out.pos.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r);
      out.nrm.push(n.x, n.y, n.z);
      out.uv.push((j / radial) * wraps, (t * length) / 0.8);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = base + i * (radial + 1) + j, b = a + radial + 1;
    out.idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
}

function geometry({ pos, nrm, uv, idx, shade }) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (shade) g.setAttribute('shade', new THREE.Float32BufferAttribute(shade, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function buildWood(def) {
  const rand = random(def.seed);
  const out = { pos: [], nrm: [], uv: [], idx: [] };
  const top = new THREE.Vector3(def.lean, def.trunk, def.lean * 0.4);
  tube([new THREE.Vector3(0, -0.1, 0), new THREE.Vector3(def.lean * 0.2, def.trunk * 0.5, 0), top], def.r0, def.r0 * 0.62, 8, 6, out);
  const C = def.crown, R = def.radius;
  for (let k = 0; k < def.limbs; k++) {
    const a = (k / def.limbs) * Math.PI * 2 + rand() * 0.8;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const end = C.clone().add(new THREE.Vector3(dir.x * R.x * 0.7, (rand() - 0.2) * R.y * 0.6, dir.z * R.z * 0.7));
    const start = top.clone().add(new THREE.Vector3(0, -0.15 - rand() * 0.3, 0));
    const mid = start.clone().lerp(end, 0.45).add(new THREE.Vector3(0, 0.45, 0));
    tube([start, mid, end], def.r0 * 0.55, 0.03, 5, 5, out);
    // two thinner branches leaving the limb towards the edge of the crown
    for (let b = 0; b < 2; b++) {
      const from = new THREE.CatmullRomCurve3([start, mid, end]).getPointAt(0.45 + b * 0.25);
      const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(b ? 1 : -1);
      const to = C.clone().add(dir.clone().multiplyScalar(0.6).add(side.multiplyScalar(0.6)).normalize().multiply(R).multiplyScalar(0.85)).add(new THREE.Vector3(0, (rand() - 0.3) * R.y * 0.7, 0));
      tube([from, from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, 0.25, 0)), to], 0.045, 0.012, 3, 3, out);
    }
  }
  return geometry(out);
}

function buildCrown(def) {
  const rand = random(def.seed + 100);
  const out = { pos: [], nrm: [], uv: [], idx: [], shade: [] };
  const C = def.crown, R = def.radius;
  const up = new THREE.Vector3(0, 1, 0);
  const o = new THREE.Vector3(), n = new THREE.Vector3(), t = new THREE.Vector3(), w = new THREE.Vector3(), anchor = new THREE.Vector3();
  const corner = new THREE.Vector3(), nn = new THREE.Vector3();
  for (let k = 0; k < def.cards; k++) {
    // a point in the crown's shell, fewer underneath
    o.set(rand() * 2 - 1, rand() * 1.6 - 0.6, rand() * 2 - 1).normalize();
    const depth = 0.45 + Math.sqrt(rand()) * 0.5;
    anchor.copy(o).multiply(R).multiplyScalar(depth).add(C);
    // the card lies across the shell (facing out, tilted at random); its twig grows outwards and upwards
    n.copy(o).addScaledVector(t.set(rand() - 0.5, rand() - 0.5, rand() - 0.5), 1.1).normalize();
    t.copy(o).multiplyScalar(0.6).addScaledVector(up, 0.5).add(w.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.9));
    t.addScaledVector(n, -t.dot(n)).normalize();
    w.crossVectors(t, n).normalize();
    const size = def.card * (0.8 + rand() * 0.4);
    const base = out.pos.length / 3;
    const quad = [[-0.5, -0.1], [0.5, -0.1], [0.5, 0.9], [-0.5, 0.9]];
    for (const [a, b] of quad) {
      corner.copy(anchor).addScaledVector(w, a * size).addScaledVector(t, b * size);
      out.pos.push(corner.x, corner.y, corner.z);
      // normal of the ellipsoid through this corner, with a little of the card's own
      nn.copy(corner).sub(C).divide(R).divide(R).normalize().multiplyScalar(0.75).addScaledVector(n, 0.25).normalize();
      out.nrm.push(nn.x, nn.y, nn.z);
      out.uv.push(def.u0 + (a + 0.5) * 0.5, b < 0 ? 0 : 1);
      // open to the sky on the outside and on top, shaded inside and underneath
      const r = corner.clone().sub(C).divide(R).length();
      out.shade.push(THREE.MathUtils.clamp(0.3 + 0.62 * r + 0.25 * nn.y, 0.28, 1.15));
    }
    out.idx.push(base, base + 1, base + 2, base, base + 2, base + 3, base, base + 2, base + 1, base, base + 3, base + 2);
  }
  return geometry(out);
}

export function buildTreeKit(textures) {
  const wind = uniform(1);
  const seed = hash(float(instanceIndex).mul(1.37));
  // the whole tree leans with the wind (more the higher up); the leaves flutter on top of that
  const sway = sin(time.mul(1.3).add(seed.mul(30))).mul(0.045).mul(wind).mul(positionLocal.y.sub(2).max(0));
  const bend = vec3(sway, 0, sway.mul(0.6));

  const woodMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.95 });
  const bark = textures.bark;
  woodMat.colorNode = texture(bark.color, uv()).rgb.mul(mix(float(0.85), float(1.05), seed)).mul(float(1).sub(WET.mul(0.35)));
  woodMat.normalMap = bark.normal;
  woodMat.normalScale = new THREE.Vector2(1.2, 1.2);
  woodMat.positionNode = positionLocal.add(bend);

  const leafMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.72, alphaTest: 0.5 });
  const leaf = texture(textures.leaves, uv());
  const shade = attribute('shade', 'float');
  // a little deeper green than the scans, varying from tree to tree; darker when wet
  const tint = mix(vec3(0.62, 0.78, 0.5), vec3(0.78, 0.9, 0.58), seed).mul(float(1).sub(WET.mul(0.2)));
  const rgb = leaf.rgb.mul(tint).mul(shade);
  leafMat.colorNode = vec4(rgb, leaf.a);
  // sunlight through the leaves keeps the shaded side green instead of black
  leafMat.emissiveNode = rgb.mul(0.16).mul(float(1).sub(NIGHT));
  const flutter = sin(time.mul(4.2).add(positionLocal.x.mul(3.1)).add(positionLocal.z.mul(2.3)).add(seed.mul(17))).mul(0.035).mul(wind);
  leafMat.positionNode = positionLocal.add(bend).add(normalLocal.mul(flutter));

  const species = {};
  for (const name of SPECIES_NAMES) species[name] = { wood: buildWood(SPECIES[name]), leaves: buildCrown(SPECIES[name]) };
  return { species, woodMat, leafMat, wind };
}
