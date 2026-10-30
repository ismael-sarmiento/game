// Traffic: cars that drive on the right along the road grid, turn at crossings, keep their distance, give way at
// junctions and brake for the player. Instanced visuals; kinematic colliders so the player can bump into them.
import * as THREE from 'three/webgpu';
import { CITY, roadAt, rng } from './layout.js';
import { vertexColor } from 'three/tsl';
import { atNight } from './materials.js';
import { buildVehicle, pickType, TYPE_NAMES } from './vehicles.js';

const PAINTS = ['#c9cde3', '#0e1430', '#2e3c74', '#7a5212', '#5a0f1f', '#1f4a44', '#3a3f55', '#e7e9f5', '#101010', '#4b2a70'];
const LANES = [1.9, 5.55];
const SEG = CITY.PITCH;
const MAX = 40;

export class Traffic {
  constructor({ scene, world, RAPIER }, count) {
    this.rand = rng(9);
    // one set of instanced meshes per vehicle type; every car slot owns one instance in its type's set
    const paint = new THREE.MeshPhysicalNodeMaterial({ metalness: 0.6, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
    const glass = new THREE.MeshPhysicalNodeMaterial({ color: 0x0a0f18, metalness: 0.85, roughness: 0.05 });
    const trim = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3 });
    const lights = new THREE.MeshBasicNodeMaterial({ vertexColors: true });
    lights.colorNode = vertexColor().mul(atNight(0.45).mul(3));
    this.types = {};
    for (const name of TYPE_NAMES) {
      const v = buildVehicle(name);
      const parts = { body: new THREE.InstancedMesh(v.body, paint, MAX), glass: new THREE.InstancedMesh(v.glass, glass, MAX),
        trim: new THREE.InstancedMesh(v.trim, trim, MAX), lights: new THREE.InstancedMesh(v.lights, lights, MAX) };
      Object.values(parts).forEach((m) => { m.frustumCulled = false; m.count = 0; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); });
      parts.body.castShadow = true;
      this.types[name] = { ...v, parts, used: 0 };
    }
    this.wheels = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 0.28, 16).rotateZ(Math.PI / 2), new THREE.MeshStandardNodeMaterial({ color: 0x0d0d10, roughness: 0.85 }), MAX * 4);
    this.wheels.frustumCulled = false; this.wheels.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(this.wheels);

    this.cars = [];
    this.nodes = new Map();
    for (let k = 0; k < MAX; k++) {
      const type = pickType(this.rand());
      const t = this.types[type];
      const slot = t.used++;
      const c = t.collider;
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -50, 0));
      world.createCollider(RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz).setTranslation(0, c.hy + 0.15, 0), body);
      const col = new THREE.Color(t.def.paint || PAINTS[k % PAINTS.length]);
      t.parts.body.setColorAt(slot, col);
      this.cars.push(this.spawn({ id: k, type, slot, length: t.def.L, body, pos: new THREE.Vector3(), heading: 0, spin: 0, honk: 0 }));
    }
    for (const t of Object.values(this.types)) {
      Object.values(t.parts).forEach((m) => { m.count = t.used; });
      if (t.parts.body.instanceColor) t.parts.body.instanceColor.needsUpdate = true;
    }
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3(1, 1, 1); this.v = new THREE.Vector3();
    this.setCount(count);
  }

  spawn(car) {
    const r = this.rand;
    const i = Math.floor(r() * (CITY.N + 1)), j = Math.floor(r() * (CITY.N + 1));
    const dirs = this.neighbours(i, j);
    const to = dirs[Math.floor(r() * dirs.length)];
    Object.assign(car, { from: [i, j], to, t: r() * 40 + 15, lane: r() < 0.6 ? 0 : 1, cruise: 9 + r() * 6, speed: 8, wait: 0 });
    this.place(car, true);
    return car;
  }

  neighbours(i, j) {
    return [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]].filter(([a, b]) => a >= 0 && b >= 0 && a <= CITY.N && b <= CITY.N);
  }

  setCount(n) { this.count = Math.min(n, MAX); this.cars.forEach((c, k) => { if (k >= this.count) c.body.setNextKinematicTranslation({ x: 0, y: -50, z: 0 }); }); }

  segment(car) {
    const ax = roadAt(car.from[0]), az = roadAt(car.from[1]), bx = roadAt(car.to[0]), bz = roadAt(car.to[1]);
    const dx = Math.sign(bx - ax), dz = Math.sign(bz - az);
    return { ax, az, dx, dz, rx: -dz, rz: dx };   // right-hand side of the direction of travel
  }

  place(car, snap) {
    const s = this.segment(car), off = LANES[car.lane];
    const x = s.ax + s.dx * car.t + s.rx * off, z = s.az + s.dz * car.t + s.rz * off;
    const heading = Math.atan2(s.dx, s.dz);
    if (snap) { car.pos.set(x, 0, z); car.heading = heading; return; }
    car.target = { x, z, heading };
  }

  honk(at) {
    const near = this.cars.slice(0, this.count).find((c) => c.pos.distanceTo(at) < 26);
    if (near) near.honk = 0.5;
  }

  update(dt, game) {
    const player = game.player, pmode = game.mode;
    for (let k = 0; k < this.count; k++) {
      const car = this.cars[k];
      const s = this.segment(car);
      const fx = s.dx, fz = s.dz;
      let want = car.cruise;

      // keep distance from whatever is ahead in the lane: other cars and the player
      const check = (px, pz, lateralMax, gap) => {
        const ddx = px - car.pos.x, ddz = pz - car.pos.z;
        const ahead = ddx * fx + ddz * fz, lateral = Math.abs(ddx * s.rx + ddz * s.rz);
        if (ahead > 0 && ahead < gap && lateral < lateralMax) want = Math.min(want, Math.max(0, (ahead - 5.5) * 0.9));
      };
      check(player.x, player.z, pmode === 'car' ? 2.4 : 1.6, 18);
      if (pmode === 'foot') { const pc = game.car.position; check(pc.x, pc.z, 2.4, 18); }   // the parked player car
      const blockedByPlayer = want < 1;
      for (let o = 0; o < this.count; o++) if (o !== k) check(this.cars[o].pos.x, this.cars[o].pos.z, 1.6, 15 + (this.cars[o].length + car.length) / 2 - 4.6);
      // stuck behind the player for a while: change lane and go round
      car.blocked = blockedByPlayer ? (car.blocked || 0) + dt : 0;
      if (car.blocked > 2.5) { car.lane = 1 - car.lane; car.blocked = 0; }

      // junction: reserve the crossing before entering, wait if another car holds it
      const remaining = SEG - car.t;
      const key = `${car.to[0]},${car.to[1]}`;
      if (remaining < 14) {
        const held = this.nodes.get(key);
        if (held && held.car !== car && held.until > game.time) want = Math.min(want, Math.max(0, (remaining - 10) * 0.8));
        else if (!held || held.until <= game.time) this.nodes.set(key, { car, until: game.time + 4 });   // never renewed: no gridlock
        if (!car.next) {
          const opts = this.neighbours(...car.to).filter(([a, b]) => a !== car.from[0] || b !== car.from[1]);
          const straight = opts.find(([a, b]) => a - car.to[0] === fx && b - car.to[1] === fz);
          car.next = straight && this.rand() < 0.55 ? straight : opts[Math.floor(this.rand() * opts.length)];
        }
        const turning = car.next && (car.next[0] - car.to[0] !== fx || car.next[1] - car.to[1] !== fz);
        if (turning) want = Math.min(want, 6.5);
        // traffic light: stop at the line (≈12 m before the centre) unless it is green, or yellow and too close to stop
        if (game.lights && remaining > 9 && !game.lights.canGo(car.to[0], car.to[1], fx !== 0 ? 'x' : 'z', game.time, remaining)) {
          want = Math.min(want, Math.max(0, (remaining - 12.8) * 0.9));
        }
      }

      car.speed = THREE.MathUtils.damp(car.speed, want, want < car.speed ? 5 : 1.4, dt);
      car.t += car.speed * dt;
      if (car.t >= SEG) {
        car.t -= SEG;
        car.from = car.to; car.to = car.next || this.neighbours(...car.from)[0]; car.next = null;
        car.lane = this.rand() < 0.15 ? 1 - car.lane : car.lane;
      }
      this.place(car, false);
      const tg = car.target;
      car.pos.x = THREE.MathUtils.damp(car.pos.x, tg.x, 7, dt);
      car.pos.z = THREE.MathUtils.damp(car.pos.z, tg.z, 7, dt);
      let dh = tg.heading - car.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      car.heading += dh * Math.min(1, dt * 5);
      car.spin += car.speed * dt / this.types[car.type].def.r;
      this.q.setFromAxisAngle(this.v.set(0, 1, 0), car.heading);
      car.body.setNextKinematicTranslation({ x: car.pos.x, y: 0, z: car.pos.z });
      car.body.setNextKinematicRotation({ x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w });
      if (car.honk > 0) { car.honk -= dt; if (car.honk <= 0) game.audio.play('horn'); }
    }
    this.draw();
  }

  draw() {
    const { m, q, s, v } = this;
    const up = new THREE.Vector3(0, 1, 0), local = new THREE.Vector3(), wq = new THREE.Quaternion(), axis = new THREE.Vector3(1, 0, 0);
    for (let k = 0; k < MAX; k++) {
      const car = this.cars[k], on = k < this.count, t = this.types[car.type];
      q.setFromAxisAngle(up, car.heading);
      s.setScalar(on ? 1 : 0);
      m.compose(v.set(car.pos.x, 0, car.pos.z), q, s);
      for (const part of Object.values(t.parts)) part.setMatrixAt(car.slot, m);
      t.wheels.forEach(([x, z], w) => {
        wq.setFromAxisAngle(axis, car.spin).premultiply(q);
        local.set(x, t.def.r, z).applyQuaternion(q).add(car.pos);
        m.compose(local, wq, v.set(on ? t.def.r : 0, on ? t.def.r : 0, on ? t.def.r : 0)); this.wheels.setMatrixAt(k * 4 + w, m);
      });
    }
    for (const t of Object.values(this.types)) for (const part of Object.values(t.parts)) part.instanceMatrix.needsUpdate = true;
    this.wheels.instanceMatrix.needsUpdate = true;
  }
}
