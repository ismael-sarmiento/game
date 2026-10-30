// Detailed CC0 buildings and street props from Quaternius' Downtown City MegaKit (see CREDITS.md). Models are loaded
// once and drawn as instanced meshes (one per material); "fake interior" windows light up at night.
import * as THREE from 'three/webgpu';
import { texture } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { NIGHT } from './timeofday.js';

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
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (const part of model.parts) {
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, placements.length);
    placements.forEach((p, i) => {
      q.setFromAxisAngle(up, p.rot || 0);
      m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(1, 1, 1)).multiply(part.matrix);
      mesh.setMatrixAt(i, m);
    });
    mesh.castShadow = !part.material.transparent; mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }
}

