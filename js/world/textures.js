// CC0 surface textures from ambientCG (see CREDITS.md): colour and roughness at 1K/512 px. Relief comes from bump
// mapping on the colour, so no tangents are needed for the world-space UVs used by the city. Trees get their leafy
// twigs (built by tools/make_foliage.py) and a bark colour and normal map.
import * as THREE from 'three/webgpu';

const SETS = ['asphalt', 'concrete', 'bricks', 'plaster', 'tiles'];

export async function loadTextures(renderer, onProgress) {
  const loader = new THREE.TextureLoader();
  const aniso = Math.min(8, renderer.getMaxAnisotropy ? renderer.getMaxAnisotropy() : 4);
  const load = (url, srgb) => loader.loadAsync(url).then((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
  const out = {};
  let done = 0;
  await Promise.all(SETS.map(async (name) => {
    const [color, rough] = await Promise.all([load(`assets/textures/${name}/color.jpg`, true), load(`assets/textures/${name}/rough.jpg`, false)]);
    out[name] = { color, rough };
    onProgress?.(++done / (SETS.length + 1));
  }));
  const [leaves, barkColor, barkNormal] = await Promise.all([load('assets/textures/foliage/leaves.png', true), load('assets/textures/bark/color.jpg', true), load('assets/textures/bark/normal.jpg', false)]);
  leaves.wrapS = leaves.wrapT = THREE.ClampToEdgeWrapping;
  out.leaves = leaves;
  out.bark = { color: barkColor, normal: barkNormal };
  onProgress?.(1);
  return out;
}
