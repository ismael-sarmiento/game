// Detailed CC0 buildings and street props from Quaternius' Downtown City MegaKit (see CREDITS.md). Models are loaded
// once and drawn as instanced meshes (one per material); "fake interior" windows light up at night.
import * as THREE from 'three/webgpu';
import { texture } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { NIGHT } from './timeofday.js';
import { chunked } from './chunks.js';

const BUILDINGS = ['building_small', 'building_medium', 'building_large'];
const PROPS = ['planter', 'bollard', 'manhole'];

function convert(material) {
  const name = material.name || '';
  if (name.includes('FakeInterior')) {
    const m = new THREE.MeshStandardNodeMaterial({ map: material.map, roughness: 0.35, metalness: 0.1 });
    m.emissiveNode = texture(material.map).rgb.mul(NIGHT.mul(1.25).add(0.04));   // rooms behind the glass light up at night
    return m;
  }
  if (name.includes('Glass')) return new THREE.MeshPhysicalNodeMaterial({ color: 0xa9c0d4, metalness: 0.2, roughness: 0.04, transparent: true, opacity: 0.32, depthWrite: false });
  return material;
}

export async function loadKit(onProgress) {
  THREE.Cache.enabled = true;   // the models share their textures
  const loader = new GLTFLoader();
  const out = { buildings: {}, props: {} };
  const names = BUILDINGS.concat(PROPS);
  let done = 0;
  await Promise.all(names.map(async (name) => {
    const gltf = await loader.loadAsync(`assets/kit/${name}.gltf`);
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
    const recentre = new THREE.Matrix4().makeTranslation(-centre.x, -box.min.y, -centre.z);
    const parts = [];
    root.traverse((o) => { if (o.isMesh) parts.push({ geometry: o.geometry, material: convert(o.material), matrix: recentre.clone().multiply(o.matrixWorld) }); });
    const model = { name, parts, w: size.x, h: size.y, d: size.z };
    (BUILDINGS.includes(name) ? out.buildings : out.props)[name] = model;
    onProgress?.(++done / names.length);
  }));
  return out;
}

// placements: [{ x, y, z, rot }] → one InstancedMesh per material of the model
export function placeModel(scene, model, placements) {
  if (!placements.length) return;
  const up = new THREE.Vector3(0, 1, 0), m = new THREE.Matrix4(), base = new THREE.Matrix4();
  for (const part of model.parts) {
    // tiles of the city (chunks.js) so buildings out of view are skipped by the camera and the sun's shadow pass
    // details only matter up close: rooms seen through the windows, then window frames and trims
    const name = part.material.name || '';
    const far = name.includes('Interior') && !name.includes('Fake') ? 170 : name.includes('Trim') ? 480 : Infinity;
    const group = chunked(part.geometry, part.material, placements, (pl, p, q, s) => {
      base.compose(new THREE.Vector3(pl.x, pl.y, pl.z), new THREE.Quaternion().setFromAxisAngle(up, pl.rot || 0), new THREE.Vector3(1, 1, 1));
      m.copy(base).multiply(part.matrix);
      m.decompose(p, q, s);
    }, far);
    group.castShadow = !part.material.transparent; group.receiveShadow = true;
    scene.add(group);
  }
}
