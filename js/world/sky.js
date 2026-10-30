// Sky and light for every hour and weather: physical sky with clouds (SkyMesh), stars and moon at night, a sun/moon
// light with shadows that follow the player, sky/ground fill, fog, exposure, a reflection map refreshed every few
// seconds, lightning and rain around the camera.
import * as THREE from 'three/webgpu';
import { uniform, vec3, vec4, float, normalize, positionWorld, cameraPosition, smoothstep, pow, max, dot, hash, floor, step, sin, time } from 'three/tsl';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { NIGHT } from './timeofday.js';

const c = (hex) => new THREE.Color(hex);
const lerpColor = (out, a, b, t) => out.copy(a).lerp(b, THREE.MathUtils.clamp(t, 0, 1));

function makeSky(withStars) {
  const sky = new SkyMesh();
  sky.scale.setScalar(3000);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  sky.rayleigh.value = 1.6; sky.mieCoefficient.value = 0.004; sky.mieDirectionalG.value = 0.86;
  sky.cloudScale.value = 0.00025; sky.cloudSpeed.value = 0.00003; sky.cloudElevation.value = 0.55;
  const base = sky.material.colorNode;
  sky.gain = uniform(1);
  sky.moonDir = uniform(new THREE.Vector3(0, 1, 0));
  sky.flash = uniform(0);
  let extra = vec3(0, 0, 0);
  if (withStars) {
    const dir = normalize(positionWorld.sub(cameraPosition));
    const cell = floor(dir.mul(420));
    const star = step(0.9975, hash(cell.x.add(cell.y.mul(57)).add(cell.z.mul(113)))).mul(smoothstep(0.06, 0.3, dir.y));
    const twinkle = sin(time.mul(3).add(hash(cell.x.add(cell.z)).mul(40))).mul(0.35).add(0.65);
    const md = dot(dir, normalize(sky.moonDir));
    // a disc of about 1.2° (a little larger than the real 0.5°, so it reads on screen) inside a soft halo
    const moon = smoothstep(0.99994, 0.99996, md).mul(3.0).add(pow(max(md, 0), 900).mul(0.18));
    const nightGlow = vec3(0.012, 0.018, 0.05).add(vec3(0.12, 0.06, 0.18).mul(pow(max(float(1).sub(dir.y.mul(5)), 0), 3)));
    extra = vec3(1, 1, 1).mul(star).mul(twinkle).mul(1.4).add(vec3(0.85, 0.9, 1).mul(moon)).add(nightGlow).mul(NIGHT);
  }
  sky.material.colorNode = vec4(base.rgb.mul(sky.gain).add(extra).add(vec3(0.6, 0.65, 0.9).mul(sky.flash)), 1);
  return sky;
}

export function buildSky({ scene, renderer, preset }, clock, weather) {
  const sky = makeSky(true);
  scene.add(sky);
  scene.fog = new THREE.FogExp2(0x0c1330, 0.0021);

  const hemi = new THREE.HemisphereLight(0x3a4a9a, 0x0b0e1f, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.castShadow = preset.shadows > 0;
  sun.shadow.mapSize.set(preset.shadows || 512, preset.shadows || 512);
  const sc = sun.shadow.camera;
  sc.left = -75; sc.right = 75; sc.top = 75; sc.bottom = -75; sc.near = 10; sc.far = 900;
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.5;
  scene.add(sun, sun.target);

  // reflection map: a small scene with the same sky and a ring of city lights, re-rendered every few seconds
  const env = new THREE.Scene();
  const envSky = makeSky(false);
  env.add(envSky);
  const envLights = new THREE.Group();
  const tints = ['#3fe0ff', '#e2b25c', '#a98bff', '#ff5c7a', '#ffd9a0', '#5dffa8'];
  for (let k = 0; k < 36; k++) {
    const a = (k / 36) * Math.PI * 2 + (k % 3) * 0.2;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3 + (k % 4), 0.8 + (k % 3) * 0.4), new THREE.MeshBasicMaterial({ color: c(tints[k % tints.length]).multiplyScalar(2.2), side: THREE.DoubleSide }));
    m.position.set(Math.cos(a) * 46, 1 + (k * 7) % 14, Math.sin(a) * 46); m.lookAt(0, m.position.y, 0);
    envLights.add(m);
  }
  const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x15171f }));
  env.add(envLights, ground);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envTarget = null, envTimer = 0, envState = '';
  const refreshEnv = () => {
    envSky.sunPosition.value.copy(sky.sunPosition.value);
    ['turbidity', 'cloudCoverage', 'cloudDensity'].forEach((k) => { envSky[k].value = sky[k].value; });
    // the physical sky is very bright in HDR: as ambient light it would wash out every shadow
    envSky.gain.value = sky.gain.value * 0.12;
    envLights.visible = clock.night > 0.25;
    envLights.children.forEach((m, k) => m.material.color.copy(c(tints[k % tints.length])).multiplyScalar(2.2 * clock.night));
    ground.material.color.copy(lerpColor(new THREE.Color(), c('#5a5d66'), c('#0d0f16'), clock.night));
    // always render into the same target: a new texture would make every material recompile (seconds of freeze)
    envTarget = pmrem.fromScene(env, 0.03, 0.1, 100, { size: 128, renderTarget: envTarget });
    if (scene.environment !== envTarget.texture) scene.environment = envTarget.texture;
  };

  const rain = makeRain(preset.rain);
  scene.add(rain.mesh);

  const tmp = new THREE.Color(), tmp2 = new THREE.Color();
  const colors = {
    sunHigh: c('#fff3e2'), sunLow: c('#ff9a52'), moon: c('#8fa6ff'),
    skyDay: c('#9cc2ff'), skyNight: c('#33428f'), groundDay: c('#6b6152'), groundNight: c('#0b0e1f'),
    fogDay: c('#9fb6d4'), fogDusk: c('#c98a72'), fogNight: c('#0c1330'), fogStorm: c('#3c4352'),
  };

  return {
    sky, sun, rain, hemi,
    get rainOn() { return rain.mesh.visible; },
    setShadows(size) {
      sun.castShadow = size > 0;
      if (size > 0) { sun.shadow.mapSize.set(size, size); sun.shadow.map?.dispose(); sun.shadow.map = null; }
    },
    // per frame: lights, fog, exposure, sky and the reflection map
    update(dt, target, camera) {
      const w = weather.p, n = clock.night, d = clock.dusk;
      const dayLight = 1 - n;
      sky.sunPosition.value.copy(clock.sun).multiplyScalar(400000);
      sky.moonDir.value.copy(clock.moon);
      sky.turbidity.value = w.turbidity;
      sky.cloudCoverage.value = w.cover; sky.cloudDensity.value = w.density;
      sky.gain.value = THREE.MathUtils.lerp(0.55, 0.32, w.cover) * (1 - n * 0.8);
      sky.flash.value = weather.flash * 0.6;
      sky.position.copy(camera.position);

      // the main light is the sun by day and the moon by night
      const useSun = clock.sun.y > -0.04;
      const dir = useSun ? clock.sun : clock.moon;
      sun.position.copy(target).addScaledVector(dir, 400);
      sun.target.position.copy(target);
      if (useSun) {
        lerpColor(sun.color, colors.sunLow, colors.sunHigh, clock.sun.y / 0.35);
        sun.intensity = 3.4 * THREE.MathUtils.smoothstep(clock.sun.y, -0.04, 0.12) * w.sun;
      } else {
        sun.color.copy(colors.moon);
        sun.intensity = 0.35 * n * (0.4 + 0.6 * w.sun);
      }
      sun.intensity += weather.flash * 2.5;

      lerpColor(hemi.color, colors.skyDay, colors.skyNight, n);
      lerpColor(hemi.groundColor, colors.groundDay, colors.groundNight, n);
      // sky fill: enough by day that streets in a building's shadow keep their colour; little at night, when facades
      // should be lit by windows and lamps, not by a grey glow
      hemi.intensity = THREE.MathUtils.lerp(0.5, 0.36, n) * THREE.MathUtils.lerp(1, 1.4, w.cover * (1 - n)) + weather.flash * 1.5;

      lerpColor(tmp, colors.fogDay, colors.fogNight, n);
      tmp.lerp(colors.fogDusk, d * 0.55);
      lerpColor(tmp2, tmp, colors.fogStorm, (w.cover - 0.3) * (1 - n) * 0.9);
      scene.fog.color.copy(tmp2);
      scene.fog.density = THREE.MathUtils.lerp(0.00045, 0.0019, n) * w.fog;
      scene.environmentIntensity = THREE.MathUtils.lerp(0.55, 0.6, n);

      envTimer -= dt;
      const state = `${Math.round(clock.hour * 4)}|${weather.state}|${Math.round(w.cover * 10)}`;
      if (envTimer <= 0 && state !== envState) { envTimer = 3; envState = state; refreshEnv(); }

      rain.setIntensity(w.rain);
      rain.update(camera, dt);
    },
    exposure() { return THREE.MathUtils.lerp(0.72, 1.05, clock.night); },
  };
}

function makeRain(count) {
  const max = 4200;
  const pos = new Float32Array(max * 6);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.LineBasicNodeMaterial({ color: new THREE.Color(0.6, 0.72, 0.95), transparent: true, opacity: 0.3, depthWrite: false });
  const mesh = new THREE.LineSegments(geo, mat);
  mesh.frustumCulled = false;
  const drops = [];
  for (let i = 0; i < max; i++) drops.push({ x: (Math.random() - 0.5) * 80, y: Math.random() * 40, z: (Math.random() - 0.5) * 80, v: 26 + Math.random() * 10 });
  let budget = count, intensity = 0, on = true;
  const active = () => Math.round(Math.min(max, budget * intensity));
  return {
    mesh,
    setCount(n) { budget = n; },
    setOn(v) { on = v; },
    setIntensity(v) { intensity = v; },
    update(camera, dt) {
      const n = on ? active() : 0;
      mesh.visible = n > 0;
      geo.setDrawRange(0, n * 2);
      if (!n) return;
      const cp = camera.position, slant = 0.12 + intensity * 0.18;
      for (let i = 0; i < n; i++) {
        const d = drops[i];
        d.y -= d.v * dt * (0.9 + intensity * 0.3);
        if (d.y < cp.y - 20 || d.y < 0) { d.y = cp.y + 18 + Math.random() * 8; d.x = (Math.random() - 0.5) * 80; d.z = (Math.random() - 0.5) * 80; }
        const k = i * 6, x = cp.x + d.x, z = cp.z + d.z;
        pos[k] = x; pos[k + 1] = d.y; pos[k + 2] = z;
        pos[k + 3] = x + slant; pos[k + 4] = d.y + 0.9; pos[k + 5] = z + slant * 0.5;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

