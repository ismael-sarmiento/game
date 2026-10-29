// Renderer (WebGPU, or WebGL2 through the same API) and the post-processing chain: bloom for the neon and a soft vignette.
import * as THREE from 'three/webgpu';
import { pass, screenUV, float, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

export async function createRenderer(container, preset) {
  const params = new URLSearchParams(location.search);
  const forceWebGL = params.get('renderer') === 'webgl' || !('gpu' in navigator);
  const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL, powerPreference: 'high-performance' });
  await renderer.init();
  renderer.setPixelRatio(Math.min(devicePixelRatio, preset.pixelRatio));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = preset.shadows > 0;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.setAttribute('tabindex', '0');
  container.appendChild(renderer.domElement);
  const backend = renderer.backend && renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
  return { renderer, backend };
}

export class Pipeline {
  constructor(renderer, scene, camera) {
    this.pipeline = new THREE.RenderPipeline(renderer);
    this.scenePass = pass(scene, camera);
    this.color = this.scenePass.getTextureNode('output');
    this.bloomNode = bloom(this.color, 0.6, 0.38, 0.82);
    // darker corners pull the eye to the centre of the street
    this.vignette = float(1).sub(screenUV.sub(0.5).length().mul(1.25).pow(2.4).mul(0.6));
    this.useBloom = null;
  }
  setBloom(on) {
    if (this.useBloom === on) return;
    this.useBloom = on;
    const out = on ? this.color.add(this.bloomNode) : this.color;
    this.pipeline.outputNode = vec4(out.rgb.mul(this.vignette), 1);
    this.pipeline.needsUpdate = true;
  }
  render() { this.pipeline.render(); }
}
