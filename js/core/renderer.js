// Renderer (WebGPU, or WebGL2 through the same API) and the cinematic post-processing chain. One scene pass writes
// colour, normals, metalness/roughness and velocity (MRT); on top of it, depending on the settings: screen-space
// reflections, ambient occlusion, colour grading, bloom, motion blur, temporal or FXAA anti-aliasing, vignette and grain.
import * as THREE from 'three/webgpu';
import {
  pass, mrt, output, normalView, directionToColor, colorToDirection, sample, metalness, roughness, velocity, vec2, vec3, vec4,
  screenUV, float, luminance, mix, smoothstep, uniform, renderOutput,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { film } from 'three/addons/tsl/display/FilmNode.js';
import { motionBlur } from 'three/addons/tsl/display/MotionBlur.js';
import { NIGHT, DUSK } from '../world/timeofday.js';

export async function createRenderer(container, preset) {
  const params = new URLSearchParams(location.search);
  const forceWebGL = params.get('renderer') === 'webgl' || !('gpu' in navigator);
  // no MSAA: anti-aliasing happens in post-processing (TRAA or FXAA)
  const renderer = new THREE.WebGPURenderer({ antialias: false, forceWebGL, powerPreference: 'high-performance' });
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
    this.camera = camera;
    this.pipeline = new THREE.RenderPipeline(renderer);
    const scenePass = this.scenePass = pass(scene, camera);
    scenePass.setMRT(mrt({ output, normal: directionToColor(normalView), metalrough: vec2(metalness, roughness), velocity }));
    this.color = scenePass.getTextureNode('output');
    this.depth = scenePass.getTextureNode('depth');
    this.velocity = scenePass.getTextureNode('velocity');
    const normalTex = scenePass.getTextureNode('normal');
    this.normal = sample((uv) => colorToDirection(normalTex.sample(uv)));
    this.cameraWorld = uniform(this.camera.matrixWorld);   // view → world for the normals (the post passes use their own camera)
    this.metalRough = scenePass.getTextureNode('metalrough');

    this.bloomNode = bloom(this.color, 0.6, 0.38, 0.82);
    // darker corners pull the eye to the centre of the street
    this.vignette = float(1).sub(screenUV.sub(0.5).length().mul(1.25).pow(2.4).mul(0.55));
    this.grain = uniform(0.03);
    this.blur = uniform(0.6);
    this.options = null;
  }

  // heavy effects are created on first use and kept when the settings change
  get ssrNode() {
    if (!this._ssr) {
      this._ssr = ssr(this.color, this.depth, this.normal, { metalnessNode: this.metalRough.r, roughnessNode: this.metalRough.g, reflectNonMetals: true, camera: this.camera });
      this._ssr.maxDistance.value = 40; this._ssr.thickness.value = 1.2; this._ssr.quality.value = 0.5;
      this._ssr.resolutionScale = 0.5;
    }
    return this._ssr;
  }
  get aoNode() {
    if (!this._ao) {
      this._ao = ao(this.depth, this.normal, this.camera);
      this._ao.radius.value = 1.2; this._ao.scale.value = 1.1; this._ao.resolutionScale = 0.5;
    }
    return this._ao;
  }

  // options: { reflections, occlusion, aa: 'traa' | 'fxaa' | 'off', bloom, motionBlur, grain }
  configure(options) {
    const key = JSON.stringify(options);
    if (key === this.options) return;
    this.options = key;
    let c = this.color;
    if (options.reflections) {
      // only glossy surfaces facing up (wet asphalt, puddles, polished floors) take the reflection: on glass facades
      // the screen has too little of what they would mirror, and the missing rays smear into streaks
      // SSR returns premultiplied colour: add it
      const up = this.cameraWorld.mul(vec4(this.normal.xyz, 0)).y;
      const strength = smoothstep(0.6, 0.08, this.metalRough.g).mul(smoothstep(0.75, 0.95, up)).mul(0.9);
      c = vec4(c.rgb.add(this.ssrNode.rgb.mul(strength)), c.a);
    }
    if (options.occlusion) c = vec4(c.rgb.mul(mix(float(1), this.aoNode.getTextureNode().r, 0.85)), c.a);
    c = vec4(grade(c.rgb), c.a);
    if (options.bloom) c = c.add(this.bloomNode);
    if (options.motionBlur) c = motionBlur(c, this.velocity.mul(this.blur));
    if (options.aa === 'traa') c = traa(c, this.depth, this.velocity, this.camera);
    c = vec4(c.rgb.mul(this.vignette), 1);
    if (options.aa === 'fxaa' || options.grain) {
      // FXAA and grain work on display colours: tone-map here instead of at the very end
      this.pipeline.outputColorTransform = false;
      c = renderOutput(c);
      if (options.aa === 'fxaa') c = fxaa(c);
      if (options.grain) c = film(c, this.grain);
    } else {
      this.pipeline.outputColorTransform = true;
    }
    this.pipeline.outputNode = c;
    this.pipeline.needsUpdate = true;
  }

  // neon glows at night; by day only the brightest highlights bloom
  setNight(n) {
    this.bloomNode.strength.value = 0.15 + 0.45 * n;
    this.bloomNode.threshold.value = 1.4 - 0.58 * n;
  }
  render() { this.pipeline.render(); }
}

// Filmic grade in linear light: gentle S-curve, a touch more saturation, cool shadows and warm highlights at dusk,
// deeper blue shadows at night.
function grade(rgb) {
  const lum = luminance(rgb);
  const sat = mix(vec3(lum), rgb, float(1.1));
  const curve = sat.mul(sat.add(0.12)).div(sat.add(0.08)).mul(0.94);   // lifts mids, keeps blacks deep
  const shadows = mix(vec3(1), vec3(0.9, 0.97, 1.1), float(1).sub(smoothstep(0, 0.25, lum)).mul(DUSK.mul(0.6).add(NIGHT.mul(0.5))));
  const highlights = mix(vec3(1), vec3(1.08, 1.0, 0.9), smoothstep(0.3, 1.2, lum).mul(DUSK.mul(0.8)));
  return mix(sat, curve, 0.4).mul(shadows).mul(highlights);
}
