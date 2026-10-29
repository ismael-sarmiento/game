// Night sky (gradient, stars, moon), fog, moonlight with shadows that follow the player, the environment map that
// makes wet surfaces reflect neon, and rain around the camera.
import * as THREE from 'three/webgpu';
import { positionLocal, normalize, vec3, float, mix, smoothstep, pow, max, dot, hash, floor, step, time, sin } from 'three/tsl';

export function buildSky({ scene, renderer, preset }) {
  // sky dome
  const dir = normalize(positionLocal);
  const h = dir.y;
  const horizon = vec3(0.16, 0.09, 0.26), mid = vec3(0.03, 0.05, 0.13), top = vec3(0.008, 0.012, 0.04);
  let sky = mix(horizon, mid, smoothstep(0.0, 0.18, h));
  sky = mix(sky, top, smoothstep(0.18, 0.75, h));
  const glow = vec3(0.25, 0.75, 0.95).mul(pow(max(float(1).sub(h.mul(6)), 0), 3)).mul(0.18);
  const cell = floor(dir.mul(420));
  const star = step(0.9975, hash(cell.x.add(cell.y.mul(57)).add(cell.z.mul(113)))).mul(smoothstep(0.08, 0.3, h));
  const twinkle = sin(time.mul(3).add(hash(cell.x.add(cell.z)).mul(40))).mul(0.35).add(0.65);
  const moonDir = normalize(vec3(-0.45, 0.42, -0.78));
  const md = dot(dir, moonDir);
  const moon = smoothstep(0.9993, 0.99955, md).mul(2.6).add(pow(max(md, 0), 180).mul(0.35));
  const skyMat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  skyMat.colorNode = sky.add(glow).add(vec3(1, 1, 1).mul(star).mul(twinkle).mul(1.6)).add(vec3(0.85, 0.9, 1.0).mul(moon));
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1800, 48, 24), skyMat);
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  scene.add(dome);

  scene.fog = new THREE.FogExp2(0x0c1330, 0.0021);

  // lights: cool moon, sky/ground fill
  const hemi = new THREE.HemisphereLight(0x3a4a9a, 0x0b0e1f, 0.9);
  scene.add(hemi);
  const moonLight = new THREE.DirectionalLight(0x9db4ff, 1.1);
  moonLight.position.set(-180, 260, -320);
  moonLight.castShadow = preset.shadows > 0;
  moonLight.shadow.mapSize.set(preset.shadows || 512, preset.shadows || 512);
  const sc = moonLight.shadow.camera;
  sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 10; sc.far = 900;
  moonLight.shadow.bias = -0.0006; moonLight.shadow.normalBias = 0.6;
  scene.add(moonLight, moonLight.target);

  // environment for reflections: a small room of neon panels
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100), new THREE.MeshBasicMaterial({ color: 0x070b1d, side: THREE.BackSide })));
  const panel = (color, x, y, z, w, hgt, k = 1) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, y, 0); env.add(m);
  };
  const tints = ['#3fe0ff', '#e2b25c', '#a98bff', '#ff5c7a', '#ffd9a0', '#5dffa8'];
  for (let k = 0; k < 36; k++) {   // many small signs: reflections read as scattered city lights, not blobs
    const a = (k / 36) * Math.PI * 2 + (k % 3) * 0.2;
    panel(tints[k % tints.length], Math.cos(a) * 46, 1 + (k * 7) % 14, Math.sin(a) * 46, 3 + (k % 4), 0.8 + (k % 3) * 0.4, 2.2);
  }
  panel('#1c2a66', 0, 49, 0, 100, 100, 0.8);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(env, 0.02).texture;
  scene.environmentIntensity = 0.6;

  // rain: short streaks recycled around the camera
  const rain = makeRain(preset.rain);
  scene.add(rain.mesh);

  return {
    moonLight, dome, rain,
    follow(target, camera, dt) {
      moonLight.position.set(target.x - 180, 260, target.z - 320);
      moonLight.target.position.copy(target);
      dome.position.copy(camera.position);
      rain.update(camera, dt);
    },
    setShadows(size) {
      moonLight.castShadow = size > 0;
      if (size > 0) { moonLight.shadow.mapSize.set(size, size); moonLight.shadow.map?.dispose(); moonLight.shadow.map = null; }
    },
  };
}

function makeRain(count) {
  const max = 2600;
  const pos = new Float32Array(max * 6);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.LineBasicNodeMaterial({ color: new THREE.Color(0.55, 0.7, 1.0), transparent: true, opacity: 0.32, depthWrite: false });
  const mesh = new THREE.LineSegments(geo, mat);
  mesh.frustumCulled = false;
  const drops = [];
  for (let i = 0; i < max; i++) drops.push({ x: (Math.random() - 0.5) * 80, y: Math.random() * 40, z: (Math.random() - 0.5) * 80, v: 26 + Math.random() * 10 });
  let active = count, on = true;
  geo.setDrawRange(0, active * 2);
  return {
    mesh,
    setCount(n) { active = Math.min(n, max); geo.setDrawRange(0, on ? active * 2 : 0); },
    setOn(v) { on = v; mesh.visible = v; geo.setDrawRange(0, on ? active * 2 : 0); },
    update(camera, dt) {
      if (!on) return;
      const c = camera.position;
      for (let i = 0; i < active; i++) {
        const d = drops[i];
        d.y -= d.v * dt;
        if (d.y < c.y - 20 || d.y < 0) { d.y = c.y + 18 + Math.random() * 8; d.x = (Math.random() - 0.5) * 80; d.z = (Math.random() - 0.5) * 80; }
        const k = i * 6, x = c.x + d.x, z = c.z + d.z;
        pos[k] = x; pos[k + 1] = d.y; pos[k + 2] = z;
        pos[k + 3] = x + 0.12; pos[k + 4] = d.y + 0.9; pos[k + 5] = z + 0.06;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}
