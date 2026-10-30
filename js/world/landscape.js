// Beyond the streets: a bay to the north with a promenade wall, distant mountains all around, flocks of birds that
// wheel over the city by day and pigeons on the campus that take off when someone walks through them.
import * as THREE from 'three/webgpu';
import { positionLocal, positionWorld, vec3, float, sin, time, instanceIndex, hash, mx_noise_float, mix, smoothstep, abs, bumpMap, uniform, pmremTexture, cameraPosition } from 'three/tsl';
import { CITY, blockAt, rng } from './layout.js';
import { NIGHT } from './timeofday.js';

export const SHORE = -CITY.HALF - 30;            // the bay starts north of the last road
const HAZE = uniform(new THREE.Color(0x9fb6d4));   // the fog colour, copied every frame for the mountains' haze

export function buildLandscape({ scene, world, RAPIER }) {
  // bay: deep water with moving ripples; reflections come from the sky map and SSR
  const water = new THREE.Mesh(new THREE.PlaneGeometry(6000, 2600).rotateX(-Math.PI / 2), new THREE.MeshStandardNodeMaterial({ roughness: 0.06, metalness: 0.2 }));
  const ripples = mx_noise_float(positionWorld.xz.mul(0.08).add(vec3(time.mul(0.05), 0, time.mul(0.03)).xz)).mul(0.5)
    .add(mx_noise_float(positionWorld.xz.mul(0.31).sub(vec3(time.mul(0.11), 0, 0).xz)).mul(0.25));
  water.material.colorNode = mix(vec3(0.02, 0.07, 0.1), vec3(0.04, 0.12, 0.15), ripples.add(0.5));
  water.material.normalNode = bumpMap(ripples, float(0.6));
  water.position.set(0, 0.05, SHORE - 1300);
  water.receiveShadow = true;
  scene.add(water);

  // promenade: stone sea wall with a railing along the shore
  const stone = new THREE.MeshStandardNodeMaterial({ color: 0x9a948a, roughness: 0.85 });
  const wall = new THREE.Mesh(new THREE.BoxGeometry(CITY.SIZE + 400, 2.2, 4), stone);
  wall.position.set(0, -0.6, SHORE + 2); wall.receiveShadow = true; scene.add(wall);
  const rail = new THREE.Mesh(new THREE.BoxGeometry(CITY.SIZE + 400, 0.08, 0.08), new THREE.MeshStandardNodeMaterial({ color: 0x2a2d33, metalness: 0.8, roughness: 0.4 }));
  rail.position.set(0, 1.25, SHORE + 0.6); scene.add(rail);
  // a lighthouse and a few boats so the bay feels alive
  const light = new THREE.Group();
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(3, 4.2, 34, 20), new THREE.MeshStandardNodeMaterial({ color: 0xe8e2d6, roughness: 0.6 }));
  tower.position.y = 17; tower.castShadow = true;
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 10), new THREE.MeshBasicNodeMaterial());
  lamp.material.colorNode = vec3(1, 0.9, 0.6).mul(sin(time.mul(1.4)).mul(0.5).add(0.5).mul(4).mul(NIGHT).add(0.3));
  lamp.position.y = 36;
  light.add(tower, lamp); light.position.set(260, 0, SHORE - 380); scene.add(light);
  const boats = [];
  const hull = new THREE.BoxGeometry(4, 1.6, 12).translate(0, 0.6, 0);
  const cabin = new THREE.BoxGeometry(2.6, 1.8, 4).translate(0, 2.2, -1);
  const r = rng(88);
  for (let k = 0; k < 7; k++) {
    const b = new THREE.Group();
    const h = new THREE.Mesh(hull, new THREE.MeshStandardNodeMaterial({ color: ['#e9e6df', '#1f3550', '#8a2c22'][k % 3], roughness: 0.5 }));
    const c = new THREE.Mesh(cabin, new THREE.MeshStandardNodeMaterial({ color: 0xf0eee8, roughness: 0.5 }));
    b.add(h, c);
    b.userData = { x: (r() - 0.5) * 1400, z: SHORE - 150 - r() * 900, speed: 1.5 + r() * 3, phase: r() * 6 };
    b.rotation.y = r() * Math.PI * 2;
    scene.add(b); boats.push(b);
  }

  // mountains: a ring of hazy ridges far away (fog blends them into the sky)
  const ridge = new THREE.CylinderGeometry(2600, 2600, 1, 256, 24, true);
  const pos = ridge.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i) + 0.5;     // y: 0 bottom … 1 top of the band
    const a = Math.atan2(z, x);
    const north = Math.max(0, -Math.sin(a));                          // lower behind the bay
    const h = (180 + 260 * Math.abs(Math.sin(a * 3.1) * Math.cos(a * 7.3 + 1)) + 90 * Math.sin(a * 23)) * (1 - north * 0.55);
    const inward = 1 - y * 0.25;                                       // slopes lean towards the city
    pos.setXYZ(i, x * inward, y * h - 20, z * inward);
  }
  ridge.computeVertexNormals();
  // distant silhouettes, unlit, in the colour of the sky right behind them and a little darker, so they always read
  // as mountains against the sky (scene fog and lighting made them pale domes at dusk). Snow on the peaks by day.
  // Until the sky's reflection map exists (sky.js), the fog colour stands in.
  const rock = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false });
  const n = mx_noise_float(positionWorld.mul(0.004)).mul(0.5).add(0.5);
  const snow = smoothstep(380, 430, positionWorld.y.add(n.mul(60))).mul(float(1).sub(NIGHT)).mul(0.2);
  const shade = mix(float(0.8), float(0.6), NIGHT).mul(n.mul(0.12).add(0.94));
  rock.colorNode = HAZE.mul(shade).add(snow);
  const skyBehind = () => {
    const dir = positionWorld.sub(cameraPosition).normalize();
    rock.colorNode = pmremTexture(scene.environment, vec3(dir.x, dir.y.max(0.02), dir.z), float(0.3)).rgb.mul(shade).add(snow);
    rock.needsUpdate = true;
  };
  const mountains = new THREE.Mesh(ridge, rock);
  scene.add(mountains);

  // birds: three flocks circling at different heights; wings flap in the vertex shader
  const wing = new THREE.BufferGeometry();
  wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.35, -0.9, 0.05, -0.1, 0, 0, -0.25, 0, 0, 0.35, 0.9, 0.05, -0.1, 0, 0, -0.25], 3));
  wing.computeVertexNormals();
  const birdMat = new THREE.MeshStandardNodeMaterial({ color: 0x2b2c30, roughness: 0.8, side: THREE.DoubleSide });
  const flap = sin(time.mul(14).add(hash(float(instanceIndex)).mul(20))).mul(0.6);
  birdMat.positionNode = positionLocal.add(vec3(0, abs(positionLocal.x).mul(flap), 0));
  const FLOCKS = 3, PER = 26;
  const birds = new THREE.InstancedMesh(wing, birdMat, FLOCKS * PER);
  birds.frustumCulled = false;
  scene.add(birds);
  const flocks = Array.from({ length: FLOCKS }, (_, f) => ({ cx: (f - 1) * 260, cz: (f - 1) * 180, r: 120 + f * 60, h: 55 + f * 35, speed: 0.08 + f * 0.02, phase: f * 2 }));
  const offsets = Array.from({ length: FLOCKS * PER }, () => new THREE.Vector3((r() - 0.5) * 30, (r() - 0.5) * 10, (r() - 0.5) * 30));

  // pigeons on the campus plaza
  const PIGEONS = 22;
  const pigeonGeo = new THREE.SphereGeometry(0.16, 8, 6).scale(1, 0.8, 1.5);
  const pigeons = new THREE.InstancedMesh(pigeonGeo, new THREE.MeshStandardNodeMaterial({ color: 0x5e6068, roughness: 0.8 }), PIGEONS);
  pigeons.frustumCulled = false; pigeons.castShadow = true;
  scene.add(pigeons);
  const pg = Array.from({ length: PIGEONS }, () => ({ x: blockAt(6) - 10 + (r() - 0.5) * 30, z: blockAt(5) + (r() - 0.5) * 30, y: CITY.CURB + 0.12, vy: 0, fly: 0, yaw: r() * 6.3, peck: r() * 6 }));

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  return {
    update(dt, t, player, night) {
      if (scene.fog) HAZE.value.copy(scene.fog.color);
      if (scene.environment && !rock.userData.sky) { rock.userData.sky = true; skyBehind(); }
      // boats drift slowly and bob
      boats.forEach((b) => {
        const u = b.userData;
        b.position.set(u.x + Math.sin(t * 0.01 * u.speed + u.phase) * 120, Math.sin(t * 0.8 + u.phase) * 0.25, u.z + Math.cos(t * 0.013 * u.speed + u.phase) * 80);
        b.rotation.z = Math.sin(t * 0.9 + u.phase) * 0.03;
      });
      // birds rest at night
      birds.visible = night < 0.6;
      if (birds.visible) {
        flocks.forEach((f, fi) => {
          const a = t * f.speed + f.phase;
          const cx = f.cx + Math.cos(a) * f.r, cz = f.cz + Math.sin(a * 1.3) * f.r * 0.7;
          const yaw = Math.atan2(-Math.sin(a) * f.r, Math.cos(a * 1.3) * f.r * 0.91);
          for (let k = 0; k < PER; k++) {
            const o = offsets[fi * PER + k];
            const wob = Math.sin(t * 0.7 + k) * 3;
            v.set(cx + o.x + wob, f.h + o.y + Math.sin(t * 0.5 + k * 0.3) * 2, cz + o.z);
            q.setFromEuler(e.set(0, yaw, Math.sin(t + k) * 0.2));
            s.setScalar(0.9);
            m.compose(v, q, s); birds.setMatrixAt(fi * PER + k, m);
          }
        });
        birds.instanceMatrix.needsUpdate = true;
      }
      // pigeons peck around and take off when the player comes close, landing again later
      pg.forEach((p, k) => {
        const d = Math.hypot(player.x - p.x, player.z - p.z);
        if (p.fly <= 0 && d < 3.5) { p.fly = 5 + Math.random() * 3; p.vy = 4; p.yaw = Math.atan2(p.x - player.x, p.z - player.z); }
        if (p.fly > 0) {
          p.fly -= dt;
          p.x += Math.sin(p.yaw) * 6 * dt; p.z += Math.cos(p.yaw) * 6 * dt;
          p.y += p.vy * dt; p.vy = Math.max(p.vy - dt * 2, 0.4);
          if (p.fly <= 0) { p.x = blockAt(6) - 10 + (Math.random() - 0.5) * 30; p.z = blockAt(5) + (Math.random() - 0.5) * 30; p.y = CITY.CURB + 0.12; }
        } else {
          p.peck += dt;
          if (Math.random() < dt * 0.3) p.yaw += (Math.random() - 0.5) * 2;
          const walk = Math.sin(p.peck * 0.7) > 0.3 ? 0.35 : 0;
          p.x += Math.sin(p.yaw) * walk * dt; p.z += Math.cos(p.yaw) * walk * dt;
        }
        const bob = p.fly > 0 ? 0 : Math.max(0, Math.sin(p.peck * 5)) * 0.06;
        q.setFromEuler(e.set(p.fly > 0 ? -0.3 : bob * 4, p.yaw, 0));
        s.setScalar(night > 0.7 ? 0 : 1);
        m.compose(v.set(p.x, p.y - bob, p.z), q, s); pigeons.setMatrixAt(k, m);
      });
      pigeons.instanceMatrix.needsUpdate = true;
    },
  };
}
