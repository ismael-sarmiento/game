// Instanced meshes split into 320 m tiles. One instanced mesh for the whole city has a bounding sphere as big as the
// city, so nothing is ever culled — not by the camera, nor by the sun's shadow camera (which then redraws the whole
// city every frame). Tiles let both passes skip everything out of view, and tiles with a draw distance are hidden
// once the camera is farther than that from their edge (cullTiles, every frame).
import * as THREE from 'three/webgpu';

const TILE = 320;
const LIMITED = [];   // tiles with a draw distance
let scale = 1;        // draw distances shrink on lower quality levels
export const setDrawScale = (k) => { scale = k; };

export function chunked(geometry, material, items, write, far = Infinity) {
  const group = new THREE.Group();
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), m = new THREE.Matrix4();
  const buckets = new Map();
  items.forEach((it) => {
    p.set(0, 0, 0); q.identity(); s.set(1, 1, 1);
    write(it, p, q, s);
    m.compose(p, q, s);
    const key = `${Math.floor(p.x / TILE)},${Math.floor(p.z / TILE)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(m.clone());
  });
  for (const [key, list] of buckets) {
    const mesh = new THREE.InstancedMesh(geometry, material, list.length);
    list.forEach((mm, i) => mesh.setMatrixAt(i, mm));
    mesh.computeBoundingSphere();
    group.add(mesh);
    if (far < Infinity) {
      const [tx, tz] = key.split(',').map(Number);
      LIMITED.push({ mesh, x0: tx * TILE, z0: tz * TILE, far2: far * far });
    }
  }
  // shadow flags and render order set on the group reach every tile
  for (const key of ['castShadow', 'receiveShadow', 'renderOrder']) {
    let value = key === 'renderOrder' ? 0 : false;
    Object.defineProperty(group, key, { configurable: true, get: () => value, set: (v) => { value = v; group.children.forEach((c) => { c[key] = v; }); } });
  }
  return group;
}

export function cullTiles(camera) {
  const { x, z } = camera.position;
  for (const t of LIMITED) {
    const dx = Math.max(t.x0 - x, 0, x - t.x0 - TILE), dz = Math.max(t.z0 - z, 0, z - t.z0 - TILE);
    t.mesh.visible = dx * dx + dz * dz < t.far2 * scale * scale;
  }
}

// One instanced mesh (no tiles) for cheap, low-polygon props: fewer objects to submit beats culling them.
export function single(geometry, material, items, write) {
  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), m = new THREE.Matrix4();
  items.forEach((it, i) => { p.set(0, 0, 0); q.identity(); s.set(1, 1, 1); write(it, p, q, s); m.compose(p, q, s); mesh.setMatrixAt(i, m); });
  mesh.computeBoundingSphere();
  return mesh;
}

// Merge every static, non-instanced mesh under `root` into one mesh per material (world transforms baked in).
export function mergeStatic(root, mergeGeometries) {
  root.updateMatrixWorld(true);
  const byMat = new Map();
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(o.matrixWorld);
    if (!byMat.has(o.material)) byMat.set(o.material, { geos: [], cast: false });
    const entry = byMat.get(o.material); entry.geos.push(g); entry.cast ||= o.castShadow;
  });
  const out = new THREE.Group();
  for (const [mat, { geos, cast }] of byMat) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
    mesh.castShadow = cast; mesh.receiveShadow = true;
    out.add(mesh);
  }
  return out;
}
