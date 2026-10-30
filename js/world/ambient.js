// Ambient life around the player: manholes that steam on cold nights and in the rain, papers and leaves carried by
// the wind, rain rings on puddles, spray from wet tyres, gulls over the bay, a plane crossing the sky now and then, a
// helicopter circling the tower, and the sound of all of it (traffic, crowd, waves, gusts) placed around the listener.
import * as THREE from 'three/webgpu';
import { positionLocal, vec3, sin, time, instanceIndex, hash, float, abs, instancedBufferAttribute, uv, normalView, positionView } from 'three/tsl';
import { CITY, roadAt, blockAt, rng } from './layout.js';
import { SHORE } from './landscape.js';
import { single } from './chunks.js';
import { AMBIENT } from './fx.js';

const LANE = 1.9;
const groundAt = (x, z) => {
  // blocks (sidewalks and plazas) sit on the kerb; roads are at 0
  const lx = ((x + CITY.HALF) % CITY.PITCH + CITY.PITCH) % CITY.PITCH, lz = ((z + CITY.HALF) % CITY.PITCH + CITY.PITCH) % CITY.PITCH;
  return lx >= CITY.ROAD && lz >= CITY.ROAD ? CITY.CURB : 0;
};

export class Ambient {
  constructor({ scene }, { fx, audio, tower }) {
    this.fx = fx; this.audio = audio; this.tower = tower;
    const r = this.rand = rng(91);
    this.v = new THREE.Vector3(); this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.s = new THREE.Vector3();

    // manhole covers in the lanes, between crossings; about one in five breathes steam
    this.manholes = [];
    for (let i = 0; i <= CITY.N; i++) for (let j = 0; j < CITY.N; j++) {
      for (const along of [true, false]) {
        if (r() > 0.3) continue;
        const across = roadAt(i) + (r() < 0.5 ? -LANE : LANE), at = blockAt(j) + (r() - 0.5) * 30;
        this.manholes.push({ x: along ? across : at, z: along ? at : across, steam: r() < 0.22, acc: r() });
      }
    }
    const coverMat = new THREE.MeshStandardNodeMaterial({ color: 0x2a2b2e, roughness: 0.55, metalness: 0.7 });
    const cover = new THREE.CylinderGeometry(0.42, 0.42, 0.03, 18);
    const covers = single(cover, coverMat, this.manholes, (h, p) => p.set(h.x, 0.016, h.z));
    covers.receiveShadow = true;
    scene.add(covers);

    // papers and leaves: a few dozen around the player, recycled upwind when left behind
    const LITTER = 44;
    const leaf = new THREE.PlaneGeometry(1, 1);
    const litterMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, side: THREE.DoubleSide });
    this.litter = new THREE.InstancedMesh(leaf, litterMat, LITTER);
    this.litter.frustumCulled = false; this.litter.castShadow = false;
    const paper = new THREE.Color(0xe8e6df), leaves = [0x8a5a2b, 0xa8742f, 0x6d4a22, 0x9b8a3a].map((c) => new THREE.Color(c));
    this.bits = Array.from({ length: LITTER }, (_, k) => {
      const isPaper = k % 3 === 0;
      this.litter.setColorAt(k, isPaper ? paper : leaves[k % leaves.length]);
      return { isPaper, size: isPaper ? 0.24 : 0.13, pos: new THREE.Vector3(1e4, 0, 0), vel: new THREE.Vector3(), rot: new THREE.Euler(-Math.PI / 2, r() * 6, 0), spin: new THREE.Vector3(), air: false };
    });
    scene.add(this.litter);
    this.windAngle = r() * Math.PI * 2;

    // rain rings on the ground around the camera
    const RINGS = 110;
    this.ringAlpha = new THREE.InstancedBufferAttribute(new Float32Array(RINGS), 1);
    const ringMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    ringMat.colorNode = vec3(0.75, 0.8, 0.88).mul(AMBIENT.max(0.35));
    ringMat.opacityNode = instancedBufferAttribute(this.ringAlpha);
    this.rings = new THREE.InstancedMesh(new THREE.RingGeometry(0.86, 1, 20).rotateX(-Math.PI / 2), ringMat, RINGS);
    this.rings.frustumCulled = false; this.rings.renderOrder = 1;
    this.ringList = Array.from({ length: RINGS }, () => ({ x: 0, y: -10, z: 0, age: 1, max: 1 }));
    this.nextRing = 0;
    scene.add(this.rings);

    // gulls over the shore: white, bigger than the city birds, gliding with an occasional flap
    const wing = new THREE.BufferGeometry();
    wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.45, -1.3, 0.12, -0.05, 0, 0, -0.35, 0, 0, 0.45, 1.3, 0.12, -0.05, 0, 0, -0.35], 3));
    wing.computeVertexNormals();
    const gullMat = new THREE.MeshStandardNodeMaterial({ color: 0xf2f2ee, roughness: 0.7, side: THREE.DoubleSide });
    const seed = hash(float(instanceIndex));
    const glide = sin(time.mul(0.6).add(seed.mul(30))).max(0);   // flap in bursts, glide in between
    gullMat.positionNode = positionLocal.add(vec3(0, abs(positionLocal.x).mul(sin(time.mul(9).add(seed.mul(20))).mul(0.5).mul(glide)), 0));
    this.gulls = new THREE.InstancedMesh(wing, gullMat, 9);
    this.gulls.frustumCulled = false;
    this.gullPaths = Array.from({ length: 9 }, () => ({ cx: (r() - 0.5) * 600, cz: SHORE - 20 + (r() - 0.5) * 60, rx: 40 + r() * 70, rz: 15 + r() * 25, h: 14 + r() * 22, speed: 0.12 + r() * 0.1, phase: r() * 6.3 }));
    scene.add(this.gulls);
    this.gullTimer = 4;

    // a plane at cruising height with its navigation lights
    this.plane = this.aircraft(scene, 'plane');
    this.planeState = { t: 30, active: false, from: new THREE.Vector3(), to: new THREE.Vector3(), dur: 80, age: 0 };
    // a helicopter circling the tower for a while, then leaving
    this.heli = this.aircraft(scene, 'heli');
    this.heliState = { t: 50, active: false, age: 0, dur: 70, angle: 0 };
  }

  aircraft(scene, kind) {
    const g = new THREE.Group();
    const body = new THREE.MeshStandardNodeMaterial({ color: kind === 'plane' ? 0xd9dde3 : 0x1d2a3a, roughness: 0.4, metalness: 0.5 });
    const lamp = (hex) => {
      const c = new THREE.Color(hex), m = new THREE.MeshBasicNodeMaterial();
      m.colorNode = vec3(c.r, c.g, c.b).mul(6);   // bright enough to bloom at night
      return new THREE.Mesh(new THREE.SphereGeometry(kind === 'plane' ? 0.9 : 0.25, 8, 6), m);
    };
    if (kind === 'plane') {
      const fus = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.6, 38, 10).rotateX(Math.PI / 2), body);
      const wings = new THREE.Mesh(new THREE.BoxGeometry(36, 0.5, 6), body);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 5), body); tail.position.set(0, 3.5, -17);
      const stab = new THREE.Mesh(new THREE.BoxGeometry(12, 0.4, 3.5), body); stab.position.set(0, 0.6, -17);
      const red = lamp(0xff2a2a), green = lamp(0x2aff5a), strobe = lamp(0xffffff);
      red.position.set(-18, 0, 0); green.position.set(18, 0, 0); strobe.position.set(0, -2, 2);
      g.add(fus, wings, tail, stab, red, green, strobe);
      g.userData.strobe = strobe;
    } else {
      const cabin = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 10).scale(1, 0.9, 1.6), body);
      const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 6, 8).rotateX(Math.PI / 2), body); boom.position.set(0, 0.3, -4.5);
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.5, 0.9), body); fin.position.set(0, 0.9, -7.3);
      const rotorMat = new THREE.MeshBasicNodeMaterial({ color: 0x111111, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
      const rotor = new THREE.Mesh(new THREE.CircleGeometry(5.5, 24).rotateX(-Math.PI / 2), rotorMat); rotor.position.y = 1.5;
      const beacon = lamp(0xff2a2a); beacon.position.set(0, -1.2, 0);
      // search light: a narrow beam towards the street, brightest at the lamp and fading with distance, with soft
      // edges (faint where the beam is seen side-on), so from afar it reads as light in the air, not a pale solid bell
      const coneMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const facing = abs(normalView.dot(positionView.normalize()));
      coneMat.colorNode = vec3(0.9, 0.92, 1);
      coneMat.opacityNode = uv().y.pow(2.2).mul(facing.pow(1.5)).mul(0.16);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(4.5, 55, 20, 1, true).translate(0, -27.5, 0), coneMat);
      cone.rotation.x = 0.35;
      g.add(cabin, boom, fin, rotor, beacon, cone);
      g.userData = { strobe: beacon, rotor, cone };
    }
    // visible at start so the warm-up in main.js compiles its materials; main.js hides it right after
    scene.add(g);
    return g;
  }

  update(dt, { camera, player, car, driving, weather, night, traffic, crowd, indoors, time: t }) {
    const rain = weather.p.rain, storm = weather.p.storm || 0;
    const wind = 1 + rain * 1.2 + storm * 3.5;
    this.windAngle += (Math.random() - 0.5) * dt * 0.1;
    const wx = Math.sin(this.windAngle), wz = Math.cos(this.windAngle);

    // steam: at night or when wet, only from covers near the player
    const steaming = Math.max(night, rain);
    if (steaming > 0.35) for (const h of this.manholes) {
      if (!h.steam || Math.abs(h.x - player.x) > 130 || Math.abs(h.z - player.z) > 130) continue;
      h.acc += dt * 2.6 * steaming;
      while (h.acc > 1) { h.acc -= 1; this.fx.steam(this.v.set(h.x + (Math.random() - 0.5) * 0.5, 0.1, h.z + (Math.random() - 0.5) * 0.5)); }
    }

    this.updateLitter(dt, player, wx, wz, wind, rain, car);
    this.updateRings(dt, player, indoors ? 0 : rain);

    // spray from the rear tyres of the player's car on a wet road
    if (driving && rain > 0.3 && Math.abs(car.speed) > 6) {
      const n = Math.min(3, Math.abs(car.speed) * 0.06 * rain);
      for (let k = 0; k < n; k++) for (const side of [-0.8, 0.8]) {
        this.v.copy(car.position).addScaledVector(car.forward, -1.5).addScaledVector(car.right, side); this.v.y = 0.25;
        this.fx.spray(this.v, car.forward.clone().negate(), Math.abs(car.speed));
      }
    }

    this.updateGulls(t, night, player);
    this.updatePlane(dt, t, night);
    this.updateHeli(dt, t, night);

    // sound of the surroundings, relative to the camera
    if (this.audio.ctx) {
      const right = this.v.set(1, 0, 0).applyQuaternion(camera.quaternion).setY(0).normalize();
      const panTo = (x, z) => { const dx = x - camera.position.x, dz = z - camera.position.z, d = Math.hypot(dx, dz) || 1; return THREE.MathUtils.clamp((dx * right.x + dz * right.z) / d, -1, 1); };
      let near = 0;
      for (let k = 0; k < traffic.count; k++) {
        const c = traffic.cars[k], d = Math.hypot(c.pos.x - player.x, c.pos.z - player.z);
        if (d < 70) near += (1 - d / 70) * (0.4 + Math.min(Math.abs(c.speed || 0) / 12, 1));
      }
      let people = 0;
      for (let k = 0; k < (crowd.visibleCount ?? crowd.count); k++) {
        const p = crowd.list[k]; if (!p) continue;
        const d = Math.hypot(p.pos.x - player.x, p.pos.z - player.z);
        if (d < 25) people += 1 - d / 25;
      }
      const shoreDist = Math.max(0, player.z - SHORE);
      const heliOn = this.heli.visible ? Math.max(0, 1 - this.heli.position.distanceTo(player) / 320) : 0;
      this.audio.setAmbient({
        traffic: Math.min(near / 3, 1) * (0.5 + 0.5 * (1 - night * 0.5)),
        crowd: Math.min(people / 4, 1),
        waves: Math.max(0, 1 - shoreDist / 140) * (0.7 + storm * 0.6), wavesPan: panTo(player.x, SHORE - 20),
        gust: Math.min(1, (wind - 0.6) / 3) * (driving ? 0.5 : 1),
        heli: heliOn, heliPan: this.heli.visible ? panTo(this.heli.position.x, this.heli.position.z) : 0,
      });
      if (shoreDist < 120 && night < 0.6) {
        this.gullTimer -= dt;
        if (this.gullTimer <= 0) { this.gullTimer = 5 + Math.random() * 9; this.audio.gull((Math.random() - 0.5) * 1.4); }
      }
    }
  }

  updateLitter(dt, player, wx, wz, wind, rain, car) {
    const wet = 1 - Math.min(rain, 1) * 0.65;   // wet paper sticks to the ground
    this.bits.forEach((b, k) => {
      const dx = b.pos.x - player.x, dz = b.pos.z - player.z;
      if (dx * dx + dz * dz > 42 * 42) {
        // recycle upwind of the player so it drifts past
        const a = Math.atan2(-wx, -wz) + (Math.random() - 0.5) * 2.4, d = 10 + Math.random() * 28;
        b.pos.set(player.x + Math.sin(a) * d, 0, player.z + Math.cos(a) * d); b.pos.y = groundAt(b.pos.x, b.pos.z) + 0.01;
        b.vel.set(0, 0, 0); b.air = false; b.rot.set(-Math.PI / 2, Math.random() * 6, 0);
      }
      const ground = groundAt(b.pos.x, b.pos.z) + 0.01;
      const lift = (b.isPaper ? 0.7 : 1) * wet;
      // gusts lift things off the ground; a passing car does too
      const carNear = car && Math.abs(car.speed) > 8 && Math.hypot(car.position.x - b.pos.x, car.position.z - b.pos.z) < 3;
      const gust = Math.sin(performance.now() * 0.0007 + k * 1.7) * 0.5 + 0.5;
      if (!b.air && (Math.random() < dt * gust * wind * 0.25 * lift || carNear)) {
        b.air = true; b.vel.y = 0.8 + Math.random() * 1.5 * lift + (carNear ? 1.5 : 0);
        b.spin.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 8);
        if (carNear) b.vel.addScaledVector(car.forward, Math.abs(car.speed) * 0.25);
      }
      const push = (b.air ? 1.4 : 0.35 * gust) * wind * lift;
      b.vel.x += (wx * push - b.vel.x) * dt * 1.5; b.vel.z += (wz * push - b.vel.z) * dt * 1.5;
      if (b.air) {
        b.vel.y -= 2.2 * dt; b.vel.y *= 1 - dt * 1.2;   // flutters down slowly
        b.rot.x += b.spin.x * dt; b.rot.y += b.spin.y * dt; b.rot.z += b.spin.z * dt;
      }
      b.pos.addScaledVector(b.vel, dt);
      if (b.pos.y <= ground) {
        b.pos.y = ground;
        if (b.air && b.vel.y < 0) { b.air = false; b.vel.y = 0; b.rot.x = -Math.PI / 2; b.rot.z = 0; }
        b.vel.x *= 1 - dt * 3; b.vel.z *= 1 - dt * 3;
        if (!b.air) b.rot.y += (Math.abs(b.vel.x) + Math.abs(b.vel.z)) * dt * 2;   // tumbling along the pavement
      }
      this.q.setFromEuler(b.rot); this.s.set(b.size, b.size * (b.isPaper ? 1.3 : 1), 1);
      this.m.compose(b.pos, this.q, this.s); this.litter.setMatrixAt(k, this.m);
    });
    this.litter.instanceMatrix.needsUpdate = true;
  }

  updateRings(dt, player, rain) {
    let spawn = rain > 0.15 ? rain * 140 * dt : 0;
    while (spawn > 0) {
      if (spawn < 1 && Math.random() > spawn) break;
      spawn -= 1;
      const ring = this.ringList[this.nextRing++ % this.ringList.length];
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * 18;
      ring.x = player.x + Math.sin(a) * d; ring.z = player.z + Math.cos(a) * d; ring.y = groundAt(ring.x, ring.z) + 0.03;
      ring.age = 0; ring.max = 0.35 + Math.random() * 0.25;
    }
    this.ringList.forEach((ring, k) => {
      ring.age += dt;
      const f = Math.min(ring.age / ring.max, 1);
      this.ringAlpha.setX(k, f < 1 ? (1 - f) * 0.3 : 0);
      this.s.setScalar(f < 1 ? 0.02 + f * 0.11 : 0);   // a drop's ring: a few centimetres
      this.m.compose(this.v.set(ring.x, ring.y, ring.z), this.q.identity(), this.s);
      this.rings.setMatrixAt(k, this.m);
    });
    this.rings.instanceMatrix.needsUpdate = true; this.ringAlpha.needsUpdate = true;
  }

  updateGulls(t, night, player) {
    // only by day and only when the shore is not too far, so they cost nothing elsewhere
    this.gulls.visible = night < 0.6 && player.z - SHORE < 400;
    if (!this.gulls.visible) return;
    this.gullPaths.forEach((g, k) => {
      const a = t * g.speed + g.phase;
      const x = g.cx + Math.sin(a) * g.rx, z = g.cz + Math.sin(a * 2) * g.rz;
      const dx = Math.cos(a) * g.rx, dz = Math.cos(a * 2) * 2 * g.rz;
      this.q.setFromEuler(this.e.set(0, Math.atan2(dx, dz), -Math.sign(dx * dz) * 0.25));
      this.m.compose(this.v.set(x, g.h + Math.sin(a * 3) * 2, z), this.q, this.s.setScalar(1));
      this.gulls.setMatrixAt(k, this.m);
    });
    this.gulls.instanceMatrix.needsUpdate = true;
  }

  updatePlane(dt, t, night) {
    const st = this.planeState, p = this.plane;
    if (!st.active) {
      st.t -= dt; p.visible = false;
      if (st.t > 0) return;
      // a straight line across the sky between two far points
      const a = Math.random() * Math.PI * 2, off = (Math.random() - 0.5) * 900, h = 520 + Math.random() * 200;
      const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a)), side = new THREE.Vector3(dir.z, 0, -dir.x);
      st.from.copy(dir).multiplyScalar(-1800).addScaledVector(side, off).setY(h);
      st.to.copy(dir).multiplyScalar(1800).addScaledVector(side, off).setY(h);
      st.age = 0; st.dur = 85 + Math.random() * 30; st.active = true;
      p.visible = true; p.position.copy(st.from); p.lookAt(st.to);
    }
    st.age += dt;
    p.position.lerpVectors(st.from, st.to, st.age / st.dur);
    // strobe: two short white flashes per second; wing lights are always on
    const ph = (t * 1.0) % 1;
    p.userData.strobe.visible = ph < 0.05 || (ph > 0.15 && ph < 0.2);
    if (st.age >= st.dur) { st.active = false; p.visible = false; st.t = 90 + Math.random() * 120; }
  }

  updateHeli(dt, t, night) {
    const st = this.heliState, h = this.heli, u = h.userData;
    if (!st.active) {
      st.t -= dt; h.visible = false;
      if (st.t > 0) return;
      st.active = true; st.age = 0; st.dur = 60 + Math.random() * 40; st.angle = Math.random() * Math.PI * 2;
      h.visible = true;
    }
    st.age += dt;
    // arrive from far away, circle the tower, then fly off
    const R = 150, H = 105, tx = this.tower.x, tz = this.tower.z;
    st.angle += dt * 0.11;
    const inF = Math.min(st.age / 12, 1), outF = Math.max(0, (st.age - st.dur + 12) / 12);
    const far = (1 - inF) * 900 + outF * 900;
    const x = tx + Math.cos(st.angle) * (R + far), z = tz + Math.sin(st.angle) * (R + far);
    h.position.set(x, H + far * 0.15 + Math.sin(t * 0.6) * 2, z);
    // nose along the circle, leaning into the turn
    h.rotation.set(0, Math.atan2(-Math.sin(st.angle), Math.cos(st.angle)), 0.12);
    u.rotor.rotation.y += dt * 40;
    u.strobe.visible = (t % 1.2) < 0.15;
    u.cone.visible = night > 0.5;
    if (st.age >= st.dur) { st.active = false; h.visible = false; st.t = 120 + Math.random() * 150; }
  }
}
