// Traffic: cars that drive on the right along the road grid, turn at crossings with their indicators on, keep their
// distance, stop at red lights, brake for the player (and honk if kept waiting) and buses that pull in at bus stops.
// Cars move as kinematic bodies; when the player is about to hit one it becomes a real dynamic body, so a crash
// shares momentum, pushes and spins it. Once it settles out of sight it rejoins the traffic elsewhere.
import * as THREE from 'three/webgpu';
import { CITY, roadAt, rng } from './layout.js';
import { vertexColor, instancedBufferAttribute, vec3, step, float } from 'three/tsl';
import { atNight } from './materials.js';
import { buildVehicle, pickType, TYPE_NAMES } from './vehicles.js';
import { GROUPS } from './people.js';

const PAINTS = ['#c9cde3', '#0e1430', '#2e3c74', '#7a5212', '#5a0f1f', '#1f4a44', '#3a3f55', '#e7e9f5', '#101010', '#4b2a70'];
const MASS = { sedan: 1350, suv: 1850, van: 2100, taxi: 1350, bus: 11000 };
const LANES = [1.9, 5.55];
const SEG = CITY.PITCH;
const MAX = 40;

export class Traffic {
  constructor({ scene, world, RAPIER }, count, busStops = []) {
    this.world = world; this.RAPIER = RAPIER; this.stops = busStops;
    this.rand = rng(9);
    const paint = new THREE.MeshPhysicalNodeMaterial({ metalness: 0.6, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
    const glass = new THREE.MeshPhysicalNodeMaterial({ color: 0x0a0f18, metalness: 0.85, roughness: 0.05 });
    const trim = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3 });
    this.types = {};
    for (const name of TYPE_NAMES) {
      const v = buildVehicle(name);
      // lights: headlights glow at night; the red tail lamps get brighter while braking (per-instance value)
      const brakeAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
      const lights = new THREE.MeshBasicNodeMaterial({ vertexColors: true });
      const vc = vertexColor(), red = step(0.8, vc.r).mul(step(vc.g, 0.3));
      lights.colorNode = vc.mul(atNight(0.45).mul(3)).add(vec3(1.2, 0.05, 0.08).mul(red).mul(instancedBufferAttribute(brakeAttr)).mul(float(3)));
      const parts = { body: new THREE.InstancedMesh(v.body, paint, MAX), glass: new THREE.InstancedMesh(v.glass, glass, MAX),
        trim: new THREE.InstancedMesh(v.trim, trim, MAX), lights: new THREE.InstancedMesh(v.lights, lights, MAX) };
      Object.values(parts).forEach((m) => { m.frustumCulled = false; m.count = 0; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); });
      parts.body.castShadow = true;
      this.types[name] = { ...v, parts, brakeAttr, used: 0 };
    }
    this.wheels = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 0.28, 16).rotateZ(Math.PI / 2), new THREE.MeshStandardNodeMaterial({ color: 0x0d0d10, roughness: 0.85 }), MAX * 4);
    this.wheels.frustumCulled = false; this.wheels.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(this.wheels);
    // indicators: two blinking amber lamps (front and rear corner) on the side the car is turning to
    const amber = new THREE.MeshBasicNodeMaterial(); amber.colorNode = vec3(1.0, 0.55, 0.05).mul(4);
    this.blinkers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.1, 0.06), amber, MAX * 2);
    this.blinkers.frustumCulled = false; this.blinkers.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(this.blinkers);

    this.cars = [];
    this.nodes = new Map();
    for (let k = 0; k < MAX; k++) {
      const type = pickType(this.rand());
      const t = this.types[type];
      const slot = t.used++;
      const c = t.collider;
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -50, 0).setLinearDamping(0.35).setAngularDamping(0.9));
      const collider = world.createCollider(RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz).setTranslation(0, c.hy, 0).setMass(MASS[type]).setFriction(0.6).setRestitution(0.1).setCollisionGroups(GROUPS.vehicle), body);
      t.parts.body.setColorAt(slot, new THREE.Color(t.def.paint || PAINTS[k % PAINTS.length]));
      this.cars.push(this.spawn({ id: k, type, slot, length: t.def.L, body, collider, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), heading: 0, spin: 0, honk: 0, dyn: 0 }));
    }
    for (const t of Object.values(this.types)) {
      Object.values(t.parts).forEach((m) => { m.count = t.used; });
      if (t.parts.body.instanceColor) t.parts.body.instanceColor.needsUpdate = true;
    }
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3(1, 1, 1); this.v = new THREE.Vector3();
    this.setCount(count);
  }

  // a fresh route; `avoid` keeps respawns away from the player
  spawn(car, avoid = null) {
    const r = this.rand;
    let i, j;
    for (let tries = 0; tries < 30; tries++) {
      i = Math.floor(r() * (CITY.N + 1)); j = Math.floor(r() * (CITY.N + 1));
      if (!avoid || Math.hypot(roadAt(i) - avoid.x, roadAt(j) - avoid.z) > 180) break;
    }
    const dirs = this.neighbours(i, j);
    const to = dirs[Math.floor(r() * dirs.length)];
    Object.assign(car, { from: [i, j], to, next: null, t: r() * 40 + 15, lane: car.type === 'bus' ? 1 : (r() < 0.6 ? 0 : 1), cruise: car.type === 'bus' ? 8.5 : 9 + r() * 6, speed: 8, wait: 0, blocked: 0, served: null, dyn: 0 });
    this.place(car, true);
    return car;
  }

  neighbours(i, j) {
    return [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]].filter(([a, b]) => a >= 0 && b >= 0 && a <= CITY.N && b <= CITY.N);
  }

  setCount(n) { this.count = Math.min(n, MAX); this.cars.forEach((c, k) => { if (k >= this.count && !c.dyn) c.body.setNextKinematicTranslation({ x: 0, y: -50, z: 0 }); }); }

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

  // switch a car to a free dynamic body moving at its current driving velocity
  makeDynamic(car, seconds) {
    if (!car.dyn) {
      car.body.setBodyType(this.RAPIER.RigidBodyType.Dynamic, true);
      const f = this.v.set(Math.sin(car.heading), 0, Math.cos(car.heading)).multiplyScalar(car.speed);
      car.body.setLinvel({ x: f.x, y: 0, z: f.z }, true);
      car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    car.dyn = Math.max(car.dyn, seconds);
  }

  makeKinematic(car, respawnAway) {
    car.body.setBodyType(this.RAPIER.RigidBodyType.KinematicPositionBased, true);
    car.dyn = 0; car.crashed = false;
    if (respawnAway) this.spawn(car, respawnAway);
    else this.place(car, true);
    car.quat.identity();
    car.body.setTranslation({ x: car.pos.x, y: 0, z: car.pos.z }, true);
    this.q.setFromAxisAngle(this.v.set(0, 1, 0), car.heading);
    car.body.setRotation({ x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w }, true);
  }

  update(dt, game) {
    const player = game.player, pmode = game.mode, pc = game.car;
    const pv = pc.body.linvel();
    for (let k = 0; k < this.count; k++) {
      const car = this.cars[k];

      // about to be hit by the player's car: become a real body so the crash shares momentum
      if (pmode === 'car') {
        const dx = car.pos.x - player.x, dz = car.pos.z - player.z, d = Math.hypot(dx, dz);
        const closing = d > 0.1 ? -((pv.x - Math.sin(car.heading) * car.speed) * -dx + (pv.z - Math.cos(car.heading) * car.speed) * -dz) / d : 0;
        if (d < 4 + car.length / 2 && closing > 3) this.makeDynamic(car, 1.2);
        if (car.dyn && !car.crashed) this.world.contactPair(pc.collider, car.collider, () => { car.crashed = true; car.dyn = 7; game.audio.play('horn'); });
      }
      if (car.dyn) {
        // physics drives the car: follow its body; when calm and out of the way, rejoin the traffic
        const tr = car.body.translation(), rot = car.body.rotation(), lv = car.body.linvel();
        car.pos.set(tr.x, tr.y - 0, tr.z); car.quat.set(rot.x, rot.y, rot.z, rot.w);
        car.heading = Math.atan2(2 * (rot.w * rot.y + rot.x * rot.z), 1 - 2 * (rot.y * rot.y + rot.x * rot.x));
        car.speed = Math.hypot(lv.x, lv.z);
        car.spin += car.speed * dt / this.types[car.type].def.r;
        car.dyn -= dt;
        if (car.dyn <= 0) {
          const far = car.pos.distanceTo(player) > 70;
          if (!car.crashed) this.makeKinematic(car, null);
          else if (far && car.speed < 0.5) this.makeKinematic(car, player);
          else car.dyn = 1;
        }
        car.braking = 1; car.blink = 0;
        continue;
      }

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
      if (pmode === 'foot') { const cp = pc.position; check(cp.x, cp.z, 2.4, 18); }   // the parked player car
      const blockedByPlayer = want < 1;
      for (let o = 0; o < this.count; o++) if (o !== k) check(this.cars[o].pos.x, this.cars[o].pos.z, 1.6, 15 + (this.cars[o].length + car.length) / 2 - 4.6);
      // people on the road (crossing, fleeing): stop for them
      const crowd = game.walkers;
      if (crowd) for (let o = 0; o < (crowd.visibleCount ?? crowd.count); o++) { const pp = crowd.list[o].pos; check(pp.x, pp.z, 1.8, 14); }
      // kept waiting by the player: honk after three seconds, then go round
      car.blocked = blockedByPlayer ? (car.blocked || 0) + dt : 0;
      if (car.blocked > 3 && !car.honked && car.pos.distanceTo(player) < 35) { car.honked = true; game.audio.play('horn'); }
      if (car.blocked > 5) { car.lane = 1 - car.lane; car.blocked = 0; car.honked = false; }

      // buses: pull in at the next stop on this segment and wait a few seconds
      if (car.type === 'bus') {
        for (const stop of this.stops) {
          const ddx = stop.x - car.pos.x, ddz = stop.z - car.pos.z;
          const ahead = ddx * fx + ddz * fz, lateral = ddx * s.rx + ddz * s.rz;
          if (lateral > 2 && lateral < 6 && ahead > -1 && ahead < 22 && car.served !== stop) {
            want = Math.min(want, Math.max(0, ahead * 0.6));
            if (ahead < 1.5 && car.speed < 0.5) { car.wait += dt; if (car.wait > 6) { car.served = stop; car.wait = 0; } }
          }
        }
      }

      // junction: reserve the crossing before entering, wait if another car holds it
      const remaining = SEG - car.t;
      const key = `${car.to[0]},${car.to[1]}`;
      car.blink = 0;
      if (remaining < 26) {
        if (!car.next) {
          const opts = this.neighbours(...car.to).filter(([a, b]) => a !== car.from[0] || b !== car.from[1]);
          const straight = opts.find(([a, b]) => a - car.to[0] === fx && b - car.to[1] === fz);
          car.next = straight && this.rand() < 0.55 ? straight : opts[Math.floor(this.rand() * opts.length)];
        }
        const nx = car.next[0] - car.to[0], nz = car.next[1] - car.to[1];
        const turning = nx !== fx || nz !== fz;
        if (turning) car.blink = (fx * nz - fz * nx) > 0 ? -1 : 1;   // -1 left, +1 right
        if (remaining < 14) {
          const held = this.nodes.get(key);
          if (held && held.car !== car && held.until > game.time) want = Math.min(want, Math.max(0, (remaining - 10) * 0.8));
          else if (!held || held.until <= game.time) this.nodes.set(key, { car, until: game.time + 4 });   // never renewed: no gridlock
          if (turning) want = Math.min(want, 6.5);
          // traffic light: stop at the line (≈12 m before the centre) unless it is green, or yellow and too close to stop
          if (game.lights && remaining > 9 && !game.lights.canGo(car.to[0], car.to[1], fx !== 0 ? 'x' : 'z', game.time, remaining)) {
            want = Math.min(want, Math.max(0, (remaining - 12.8) * 0.9));
          }
        }
      }

      const before = car.speed;
      car.speed = THREE.MathUtils.damp(car.speed, want, want < car.speed ? 5 : 1.4, dt);
      car.braking = car.speed < before - 0.02 || car.speed < 0.3 ? 1 : 0;
      car.t += car.speed * dt;
      if (car.t >= SEG) {
        car.t -= SEG;
        car.from = car.to; car.to = car.next || this.neighbours(...car.from)[0]; car.next = null;
        if (car.type !== 'bus') car.lane = this.rand() < 0.15 ? 1 - car.lane : car.lane;
      }
      this.place(car, false);
      const tg = car.target;
      car.pos.x = THREE.MathUtils.damp(car.pos.x, tg.x, 7, dt);
      car.pos.z = THREE.MathUtils.damp(car.pos.z, tg.z, 7, dt);
      car.pos.y = 0;
      let dh = tg.heading - car.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      car.heading += dh * Math.min(1, dt * 5);
      car.spin += car.speed * dt / this.types[car.type].def.r;
      this.q.setFromAxisAngle(this.v.set(0, 1, 0), car.heading);
      car.quat.copy(this.q);
      car.body.setNextKinematicTranslation({ x: car.pos.x, y: 0, z: car.pos.z });
      car.body.setNextKinematicRotation({ x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w });
      if (car.honk > 0) { car.honk -= dt; if (car.honk <= 0) game.audio.play('horn'); }
    }
    this.draw(game.time);
  }

  draw(time = 0) {
    const { m, s, v } = this;
    const local = new THREE.Vector3(), wq = new THREE.Quaternion(), axis = new THREE.Vector3(1, 0, 0), q = new THREE.Quaternion();
    const blinkOn = Math.floor(time * 3) % 2 === 0;
    for (let k = 0; k < MAX; k++) {
      const car = this.cars[k], on = k < this.count || car.dyn > 0, t = this.types[car.type];
      q.copy(car.quat);
      s.setScalar(on ? 1 : 0);
      // a dynamic body's origin sits at its collider centre line; kinematic cars ride on the road at y = 0
      m.compose(v.set(car.pos.x, car.dyn ? car.pos.y : 0, car.pos.z), q, s);
      for (const part of Object.values(t.parts)) part.setMatrixAt(car.slot, m);
      t.brakeAttr.setX(car.slot, car.braking ? 1 : 0);
      t.wheels.forEach(([x, z], w) => {
        wq.setFromAxisAngle(axis, car.spin).premultiply(q);
        local.set(x, t.def.r, z).applyQuaternion(q).add(v.set(car.pos.x, car.dyn ? car.pos.y : 0, car.pos.z));
        m.compose(local, wq, new THREE.Vector3(on ? t.def.r : 0, on ? t.def.r : 0, on ? t.def.r : 0)); this.wheels.setMatrixAt(k * 4 + w, m);
      });
      const show = on && car.blink && blinkOn;
      const L = t.def.L / 2 + 0.02, W = t.def.W / 2;
      [[L, 0.62], [-L, 0.72]].forEach(([z, y], b) => {
        local.set(car.blink * -(W - 0.05), y, z).applyQuaternion(q).add(v.set(car.pos.x, 0, car.pos.z));
        m.compose(local, q, new THREE.Vector3(show ? 1 : 0, show ? 1 : 0, show ? 1 : 0)); this.blinkers.setMatrixAt(k * 2 + b, m);
      });
    }
    for (const t of Object.values(this.types)) { for (const part of Object.values(t.parts)) part.instanceMatrix.needsUpdate = true; t.brakeAttr.needsUpdate = true; }
    this.wheels.instanceMatrix.needsUpdate = true; this.blinkers.instanceMatrix.needsUpdate = true;
  }
}
