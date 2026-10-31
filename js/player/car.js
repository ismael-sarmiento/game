// The player's car: a Rapier ray-cast vehicle (suspension, grip, drift with the handbrake) dressed as a low
// electric coupé with headlights that really light the street and brake lights.
import * as THREE from 'three/webgpu';
import { uniform, vec3, float, mix, step, attribute, vertexColor } from 'three/tsl';
import { buildVehicle } from '../world/vehicles.js';
import { GROUPS } from '../world/people.js';

const WHEELS = [   // [x, z] of each wheel; 0–1 front (steer), 2–3 rear (drive)
  [-0.84, 1.33], [0.84, 1.33], [-0.84, -1.3], [0.84, -1.3],
];
const RADIUS = 0.36, REST = 0.3, CONNECT_Y = -0.12;
const GROUND_OFFSET = CONNECT_Y - REST - RADIUS + 0.06;   // chassis origin → road surface at rest
const ENGINE = 4300, BRAKE = 95, MAX_SPEED = 56, REVERSE = 2200;

// Body from the same lofted shell as the traffic (see vehicles.js), as a coupé: paint, glass and black plastic from
// the `part` attribute, chrome-free trim, shaped head and tail lamps (the tail ones brighten when braking).
export function buildCarModel({ paint = '#d9dcea', lights = true } = {}) {
  const model = new THREE.Group();
  const v = buildVehicle('coupe');
  // the shell stands on y = 0 with its wheels at ±wheelbase/2; here the road is at y = −0.06 and the axles at z 1.33/−1.3
  const place = (g) => g.translate(0, -0.06, 0.015);
  const part = attribute('part', 'float'), plastic = step(0.5, part).mul(step(part, 1.5)), glassy = step(1.5, part);
  const shell = new THREE.MeshPhysicalNodeMaterial({ clearcoatRoughness: 0.05 });
  shell.colorNode = mix(mix(uniform(new THREE.Color(paint)), vec3(0.025, 0.027, 0.03), plastic), vec3(0.02, 0.025, 0.035), glassy);
  shell.metalnessNode = mix(mix(float(0.35), float(0), plastic), float(0.1), glassy);
  shell.roughnessNode = mix(mix(float(0.3), float(0.62), plastic), float(0.04), glassy);
  shell.clearcoatNode = float(1).sub(plastic);
  const body = new THREE.Mesh(place(v.body), shell);
  const trim = new THREE.Mesh(place(v.trim), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3 }));
  body.castShadow = trim.castShadow = true;
  model.add(body, trim);   // the body must stay the first child: crashes dent its vertices
  const brake = uniform(1);
  const lampMat = new THREE.MeshBasicNodeMaterial();
  const vc = vertexColor(), red = step(0.8, vc.r).mul(step(vc.g, 0.3));
  lampMat.colorNode = mix(vc.mul(3.2), vec3(1.0, 0.08, 0.15).mul(brake), red);
  model.add(new THREE.Mesh(place(v.lights), lampMat));

  const wheelGeo = new THREE.CylinderGeometry(RADIUS, RADIUS, 0.3, 24).rotateZ(Math.PI / 2);
  const tyre = new THREE.MeshStandardNodeMaterial({ color: 0x0b0b10, roughness: 0.85 });
  // alloy rims: a dished face with five spokes
  const alloy = new THREE.MeshStandardNodeMaterial({ color: 0xb9bec6, metalness: 1, roughness: 0.28 });
  const hubMat = new THREE.MeshStandardNodeMaterial({ color: 0x3a3d44, metalness: 0.8, roughness: 0.4 });
  const lip = new THREE.TorusGeometry(0.235, 0.022, 8, 28).rotateY(Math.PI / 2);
  const face = new THREE.CylinderGeometry(0.075, 0.075, 0.04, 16).rotateZ(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(0.03, 0.2, 0.05).translate(0, 0.12, 0);
  const wheels = WHEELS.map(([x]) => {
    const w = new THREE.Group();
    const t = new THREE.Mesh(wheelGeo, tyre); t.castShadow = true;
    const out = x < 0 ? -0.155 : 0.155;
    const rim = new THREE.Mesh(lip, alloy); rim.position.x = out;
    const hub = new THREE.Mesh(face, hubMat); hub.position.x = out;
    w.add(t, rim, hub);
    for (let k = 0; k < 5; k++) {
      const spoke = new THREE.Mesh(spokeGeo, alloy);
      spoke.position.x = out; spoke.rotation.x = (k / 5) * Math.PI * 2;
      w.add(spoke);
    }
    model.add(w);
    return w;
  });

  let spot = null;
  if (lights) {
    spot = new THREE.SpotLight(0xdff2ff, 260, 70, 0.55, 0.55, 1.6);
    spot.position.set(0, 0.7, 2.0);
    spot.target.position.set(0, -1.5, 22);
    model.add(spot, spot.target);
  }
  return { model, wheels, brake, spot };
}

// Drivetrain: six-speed automatic gearbox, a torque curve and aerodynamic drag decide the pull at every speed.
const GEARS = [3.6, 2.4, 1.75, 1.33, 1.05, 0.85], FINAL = 4.1, REDLINE = 6800, IDLE_RPM = 850;
const torqueAt = (rpm) => 330 * (rpm < 4800 ? 0.72 + 0.28 * Math.min(1, (rpm - 1000) / 3800) : 1 - 0.35 * Math.max(0, (rpm - 4800) / 2000));

export class Car {
  constructor({ scene, world, RAPIER }, at, heading) {
    this.RAPIER = RAPIER; this.world = world;
    const look = buildCarModel();
    this.root = new THREE.Group();
    look.model.position.y = GROUND_OFFSET;
    this.root.add(look.model);
    this.model = look.model;
    this.bodyMesh = look.model.children[0];
    this.restPositions = this.bodyMesh.geometry.attributes.position.array.slice();
    Object.assign(this, { wheels: look.wheels, brakeLight: look.brake, spot: look.spot });
    scene.add(this.root);

    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(at.x, at.y + 1.2, at.z).setRotation(q).setCanSleep(false)
      .setLinearDamping(0.02).setAngularDamping(0.6).setCcdEnabled(true));
    // collider = lower body (chassis space −0.48…0.24); a low centre of mass keeps it planted in corners
    const desc = RAPIER.ColliderDesc.cuboid(0.94, 0.36, 2.2).setTranslation(0, -0.12, 0)
      .setMassProperties(1250, { x: 0, y: -0.2, z: 0.05 }, { x: 1950, y: 2300, z: 520 }, { w: 1, x: 0, y: 0, z: 0 })
      .setFriction(0.35).setRestitution(0.15).setCollisionGroups(GROUPS.vehicle)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(9000);
    this.collider = world.createCollider(desc, this.body);

    const v = this.vehicle = world.createVehicleController(this.body);
    v.indexUpAxis = 1;
    v.setIndexForwardAxis = 2;
    WHEELS.forEach(([x, z], i) => {
      v.addWheel({ x, y: CONNECT_Y, z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, REST, RADIUS);
      v.setWheelSuspensionStiffness(i, 30);
      v.setWheelSuspensionCompression(i, 3.2);
      v.setWheelSuspensionRelaxation(i, 3.8);
      v.setWheelMaxSuspensionTravel(i, 0.3);
      v.setWheelMaxSuspensionForce(i, 60000);
    });

    this.steer = 0; this.speed = 0; this.slip = 0; this.braking = false;
    this.upsideDown = 0; this.lastVel = new THREE.Vector3(); this.impact = 0; this.impactPeak = 0; this.impactDir = new THREE.Vector3();
    this.forward = new THREE.Vector3(); this.right = new THREE.Vector3(); this.velocity = new THREE.Vector3();
    this.gear = 1; this.rpm = IDLE_RPM; this.shiftTimer = 0; this.stall = 0;
    this.accel = new THREE.Vector2(); this.lastForward = 0; this.damage = 0; this.lean = new THREE.Vector2();
    this.lastContacts = [null, null, null, null];
    this.occupied = false; this.fx = null;
  }

  get position() { const t = this.body.translation(); return new THREE.Vector3(t.x, t.y, t.z); }
  get heading() { this.forward.set(0, 0, 1).applyQuaternion(this.root.quaternion); return Math.atan2(this.forward.x, this.forward.z); }

  // read once per frame: the strongest impact of every physics step since the last call
  takeImpact() { const k = this.impactPeak; this.impactPeak = 0; return k; }

  // input: { throttle, brake, steer, handbrake } (all 0..1 or −1..1); dt fixed physics step
  drive(input, dt, wet = 0) {
    const v = this.vehicle;
    const lv = this.body.linvel();
    this.velocity.set(lv.x, lv.y, lv.z);
    const r = this.body.rotation(), rq = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    this.forward.set(0, 0, 1).applyQuaternion(rq);
    this.right.set(-1, 0, 0).applyQuaternion(rq);
    const speed = this.speed = this.velocity.dot(this.forward);
    const lateral = this.velocity.dot(this.right);
    const abs = Math.abs(speed);

    // steering: less lock at speed, quick return to centre
    const maxSteer = 0.55 * (1 - Math.min(abs / 45, 0.7));
    let target = -input.steer * maxSteer;
    // grip limit: a road car holds about 0.95 g (less on a wet road); asking for more makes the front wash out
    const wetGrip = 1 - wet * 0.18;
    const wanted = abs * abs * Math.tan(Math.abs(target)) / 2.63;
    const maxLat = 11 * wetGrip * (input.handbrake ? 0.7 : 1);
    this.understeer = 0;
    if (abs > 5 && wanted > maxLat) {
      const k = maxLat / wanted;
      this.understeer = 1 - k;
      target *= k;   // the tyres cannot give more: the car runs wide (understeer) and squeals
    }
    this.steer += (target - this.steer) * Math.min(1, dt * (Math.abs(target) > Math.abs(this.steer) ? 3.6 : 7));
    v.setWheelSteering(0, this.steer); v.setWheelSteering(1, this.steer);

    // gearbox (automatic): rpm from the driven wheels, shift with a short torque cut
    const wheelRpm = (abs / (2 * Math.PI * RADIUS)) * 60;
    this.rpm = Math.max(IDLE_RPM, wheelRpm * GEARS[this.gear - 1] * FINAL);
    this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    if (speed >= -0.5 && this.shiftTimer <= 0) {
      if (this.rpm > 6300 && this.gear < GEARS.length && input.throttle > 0) { this.gear++; this.shiftTimer = 0.22; this.onShift?.(1); }
      else if (this.rpm < 2300 && this.gear > 1) { this.gear--; this.shiftTimer = 0.15; this.onShift?.(-1); }
    }
    this.stall = Math.max(0, this.stall - dt);

    let engine = 0, brake = 0;
    if (input.throttle > 0 && this.stall <= 0) {
      if (speed < -1) brake = input.throttle * BRAKE;
      else if (this.shiftTimer <= 0 && this.rpm < REDLINE && speed < MAX_SPEED) {
        // torque at the wheels, shared by the two rear wheels (simple traction control on a wet road)
        engine = input.throttle * torqueAt(this.rpm) * GEARS[this.gear - 1] * FINAL / RADIUS * 0.88 / 2 * (abs < 8 ? wetGrip : 1);
      }
    }
    if (input.brake > 0) {
      if (speed > 1) brake = input.brake * BRAKE;
      else if (speed > -14 && this.stall <= 0) engine = -input.brake * REVERSE;
    }
    if (!input.throttle && !input.brake && abs < 0.6) brake = 4;   // hold still on slopes
    if (!input.throttle && !input.brake && abs >= 0.6) brake = 1.5;   // engine braking

    // tyres: grip saturates — the front lets go first at speed (understeer); the handbrake unloads the rear (drift)
    const speedFactor = Math.min(abs / 40, 1);
    const frontSide = (1.0 - 0.55 * speedFactor) * wetGrip, rearSide = (input.handbrake ? 0.14 : 1.05 - 0.3 * speedFactor) * wetGrip;
    [0, 1].forEach((i) => { v.setWheelFrictionSlip(i, (2.6 - 0.9 * speedFactor) * wetGrip); v.setWheelSideFrictionStiffness(i, frontSide); v.setWheelEngineForce(i, 0); v.setWheelBrake(i, brake * 0.6); });
    [2, 3].forEach((i) => {
      v.setWheelFrictionSlip(i, (input.handbrake ? 1.1 : 2.4 - 0.6 * speedFactor) * wetGrip);
      v.setWheelSideFrictionStiffness(i, rearSide);
      v.setWheelEngineForce(i, engine);
      v.setWheelBrake(i, input.handbrake ? BRAKE * 0.22 : brake * 0.4);
    });
    this.braking = brake > 5 || input.handbrake;
    this.brakeLight.value = this.braking ? 4.5 : 1.3;

    // aerodynamics: drag against the motion and a little downforce
    const drag = 0.42 * abs * abs * dt;
    if (abs > 1) this.body.applyImpulse({ x: -lv.x / abs * drag, y: -0.9 * abs * abs * dt, z: -lv.z / abs * drag }, true);

    v.updateVehicle(dt);

    // slip: sideways speed in the car's own frame (drifts, understeer, sliding on the wet)
    this.slip = abs > 3 ? Math.min(1, Math.max(Math.max(0, Math.abs(lateral) - 1.0) / 4.5, abs > 12 ? this.understeer * 1.2 : 0)) : 0;

    // weight transfer (visual): pitch with braking and acceleration, roll with cornering
    const longA = (speed - this.lastForward) / dt; this.lastForward = speed;
    const yawRate = this.body.angvel().y;
    this.accel.x = THREE.MathUtils.damp(this.accel.x, longA, 6, dt);
    this.accel.y = THREE.MathUtils.damp(this.accel.y, speed * yawRate, 6, dt);

    // impacts: sudden velocity changes, strongest one kept until the frame reads it
    const dv = this.velocity.distanceTo(this.lastVel);
    this.impact = dv > 4 ? Math.min((dv - 4) / 12, 1) : 0;
    if (this.impact > this.impactPeak) { this.impactPeak = this.impact; this.impactDir.copy(this.lastVel).sub(this.velocity).normalize(); }
    this.lastVel.copy(this.velocity);
    if (this.impact > 0.55) this.stall = 1.0;   // a hard crash stalls the engine for a second
    if (this.impact > 0.15) this.dent(this.impactDir, this.impact);

    // stuck on its roof or side: flip back after a moment
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rq);
    this.upsideDown = up.y < 0.35 && abs < 3 ? this.upsideDown + dt : 0;
    if (this.upsideDown > 2) this.reset();
  }

  // dent the body where the hit came from (direction in world space), up to a limit
  dent(worldDir, strength) {
    if (this.damage >= 1) return;
    const local = worldDir.clone().applyQuaternion(this.root.quaternion.clone().invert()).normalize();
    const hit = new THREE.Vector3(local.x * 1.0, 0.5, local.z * 2.3);   // point on the body surface facing the hit
    const pos = this.bodyMesh.geometry.attributes.position, a = pos.array, push = Math.min(0.12, 0.05 + strength * 0.1);
    for (let i = 0; i < a.length; i += 3) {
      const dx = a[i] - hit.x, dy = a[i + 1] - hit.y, dz = a[i + 2] - hit.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 0.9) { const f = (1 - d / 0.9) * push; a[i] -= local.x * f; a[i + 2] -= local.z * f; a[i + 1] -= f * 0.25; }
    }
    pos.needsUpdate = true;
    this.bodyMesh.geometry.computeVertexNormals();
    this.damage = Math.min(1, this.damage + strength * 0.35);
  }

  repair() {
    this.bodyMesh.geometry.attributes.position.array.set(this.restPositions);
    this.bodyMesh.geometry.attributes.position.needsUpdate = true;
    this.bodyMesh.geometry.computeVertexNormals();
    this.damage = 0;
  }

  idle(dt) {
    [0, 1, 2, 3].forEach((i) => { this.vehicle.setWheelEngineForce(i, 0); this.vehicle.setWheelBrake(i, 10); });
    this.brakeLight.value = 0.6;
    this.vehicle.updateVehicle(dt);
    const lv = this.body.linvel(); this.velocity.set(lv.x, lv.y, lv.z);
    this.speed = this.velocity.length(); this.slip = 0; this.impact = 0; this.rpm = IDLE_RPM; this.gear = 1;
    this.lastVel.copy(this.velocity);
  }

  reset() {
    const t = this.body.translation();
    const yaw = this.heading;
    this.body.setTranslation({ x: t.x, y: Math.max(t.y, 0) + 1.4, z: t.z }, true);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true); this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.lastVel.set(0, 0, 0); this.upsideDown = 0;
    this.repair();
  }

  teleport(x, z, heading) {
    this.body.setTranslation({ x, y: 1.4, z }, true);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true); this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.lastVel.set(0, 0, 0);
  }

  // copy physics → visuals (called every rendered frame), plus lean, tyre smoke and skid marks
  sync(dt = 1 / 60, wet = 0) {
    const t = this.body.translation(), r = this.body.rotation();
    this.root.position.set(t.x, t.y, t.z);
    this.root.quaternion.set(r.x, r.y, r.z, r.w);
    this.lean.x = THREE.MathUtils.damp(this.lean.x, THREE.MathUtils.clamp(-this.accel.x * 0.006, -0.05, 0.05), 8, dt);
    this.lean.y = THREE.MathUtils.damp(this.lean.y, THREE.MathUtils.clamp(-this.accel.y * 0.007, -0.06, 0.06), 8, dt);
    this.model.rotation.set(this.lean.x, 0, this.lean.y);
    const v = this.vehicle;
    this.wheels.forEach((w, i) => {
      const len = v.wheelSuspensionLength(i) ?? REST;
      w.position.set(WHEELS[i][0], CONNECT_Y - len - GROUND_OFFSET, WHEELS[i][1]);
      w.rotation.set(0, 0, 0);
      w.rotateY(v.wheelSteering(i) || 0);
      w.rotateX(v.wheelRotation(i) || 0);
    });
    if (!this.fx) return;
    // rear tyres: smoke and rubber marks while sliding or spinning
    const spin = this.slip > 0.3 || (Math.abs(this.speed) < 6 && this.rpm > 5000);
    [2, 3].forEach((i) => {
      const cp = v.wheelIsInContact(i) ? v.wheelContactPoint(i) : null;
      const p = cp ? new THREE.Vector3(cp.x, cp.y, cp.z) : null;
      if (spin && p) {
        if (Math.random() < 0.6) this.fx.smoke(p, this.slip, wet);
        if (this.lastContacts[i]) this.fx.marks.add(this.lastContacts[i], p, 0.24, Math.min(1, this.slip + 0.3) * (1 - wet * 0.6));
      }
      this.lastContacts[i] = spin ? p : null;
    });
    if (this.damage > 0.65 && Math.random() < 0.3) this.fx.engineSmoke(new THREE.Vector3(0, 0.6, 1.6).applyQuaternion(this.root.quaternion).add(this.root.position));
  }
}

