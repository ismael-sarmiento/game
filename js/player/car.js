// The player's car: a Rapier ray-cast vehicle (suspension, grip, drift with the handbrake) dressed as a low
// electric coupé with headlights that really light the street, underglow and brake lights.
import * as THREE from 'three/webgpu';
import { uniform, vec3, texture } from 'three/tsl';
import { neonMaterial } from '../world/materials.js';

const WHEELS = [   // [x, z] of each wheel; 0–1 front (steer), 2–3 rear (drive)
  [-0.84, 1.33], [0.84, 1.33], [-0.84, -1.3], [0.84, -1.3],
];
const RADIUS = 0.36, REST = 0.3, CONNECT_Y = -0.12;
const GROUND_OFFSET = CONNECT_Y - REST - RADIUS + 0.06;   // chassis origin → road surface at rest
const ENGINE = 4300, BRAKE = 95, MAX_SPEED = 56, REVERSE = 2200;

function profileShape() {
  const s = new THREE.Shape();
  s.moveTo(-2.18, 0.24);
  s.lineTo(-1.76, 0.24); s.absarc(-1.3, 0.3, 0.46, Math.PI, 0, true);
  s.lineTo(0.87, 0.24); s.absarc(1.33, 0.3, 0.46, Math.PI, 0, true);
  s.lineTo(2.14, 0.24); s.lineTo(2.24, 0.42); s.lineTo(2.06, 0.6); s.lineTo(0.72, 0.76);
  s.lineTo(-1.55, 0.8); s.lineTo(-2.12, 0.74); s.lineTo(-2.24, 0.46); s.closePath();
  return s;
}
function cabinShape() {
  const s = new THREE.Shape();
  s.moveTo(-1.5, 0.78); s.lineTo(-0.95, 1.22); s.quadraticCurveTo(-0.3, 1.3, 0.35, 1.22); s.lineTo(1.0, 0.76); s.closePath();
  return s;
}
function extrude(shape, width, bevel) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 14 });
  g.rotateY(-Math.PI / 2);
  g.translate(width / 2, 0, 0);
  return g;
}
function glowTexture(rgba) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, rgba); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function buildCarModel({ paint = '#d9dcea', accent = '#e2b25c', glow = '#3fe0ff', lights = true } = {}) {
  const model = new THREE.Group();
  const body = new THREE.Mesh(extrude(profileShape(), 1.8, 0.07), new THREE.MeshPhysicalNodeMaterial({ color: paint, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.05 }));
  const cabin = new THREE.Mesh(extrude(cabinShape(), 1.5, 0.05), new THREE.MeshPhysicalNodeMaterial({ color: 0x05070f, metalness: 0.9, roughness: 0.05, clearcoat: 1 }));
  body.castShadow = cabin.castShadow = true;
  model.add(body, cabin);
  const stripe = neonMaterial(new THREE.Color(accent), 2.2);
  [-0.97, 0.97].forEach((x) => {
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 3.3), stripe);
    st.position.set(x, 0.55, 0.1); model.add(st);
  });
  const head = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.04), neonMaterial(new THREE.Color('#dff6ff'), 6));
  head.position.set(0, 0.52, 2.26); model.add(head);
  const brake = uniform(1);
  const tailMat = new THREE.MeshBasicNodeMaterial(); tailMat.colorNode = vec3(1.0, 0.08, 0.15).mul(brake);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.08, 0.04), tailMat);
  tail.position.set(0, 0.64, -2.27); model.add(tail);
  const under = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 5.6).rotateX(-Math.PI / 2), new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  const ug = texture(glowTexture('rgba(255,255,255,0.8)'));
  under.material.colorNode = ug.rgb.mul(new THREE.Color(glow).multiplyScalar(0.9));
  under.material.opacityNode = ug.a;
  under.position.y = 0.03; model.add(under);

  const wheelGeo = new THREE.CylinderGeometry(RADIUS, RADIUS, 0.3, 24).rotateZ(Math.PI / 2);
  const tyre = new THREE.MeshStandardNodeMaterial({ color: 0x0b0b10, roughness: 0.85 });
  const rimMat = neonMaterial(new THREE.Color(accent), 1.6);
  const wheels = WHEELS.map(([x]) => {
    const w = new THREE.Group();
    const t = new THREE.Mesh(wheelGeo, tyre); t.castShadow = true;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 6, 20).rotateY(Math.PI / 2), rimMat);
    rim.position.x = x < 0 ? -0.16 : 0.16;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.4, 0.05), rimMat); spoke.position.x = rim.position.x;
    w.add(t, rim, spoke);
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

export class Car {
  constructor({ scene, world, RAPIER }, at, heading) {
    this.RAPIER = RAPIER; this.world = world;
    const look = buildCarModel();
    this.root = new THREE.Group();
    look.model.position.y = GROUND_OFFSET;
    this.root.add(look.model);
    Object.assign(this, { wheels: look.wheels, brakeLight: look.brake, spot: look.spot });
    scene.add(this.root);

    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(at.x, at.y + 1.2, at.z).setRotation(q).setCanSleep(false)
      .setLinearDamping(0.08).setAngularDamping(0.9).setCcdEnabled(true));
    // collider = lower body (chassis space −0.48…0.24); a low centre of mass keeps it planted in corners
    const desc = RAPIER.ColliderDesc.cuboid(0.94, 0.36, 2.2).setTranslation(0, -0.12, 0)
      .setMassProperties(1250, { x: 0, y: -0.2, z: 0.05 }, { x: 1950, y: 2300, z: 520 }, { w: 1, x: 0, y: 0, z: 0 })
      .setFriction(0.35).setRestitution(0.1)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(9000);
    this.collider = world.createCollider(desc, this.body);

    const v = this.vehicle = world.createVehicleController(this.body);
    v.indexUpAxis = 1;
    v.setIndexForwardAxis = 2;
    WHEELS.forEach(([x, z], i) => {
      v.addWheel({ x, y: CONNECT_Y, z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, REST, RADIUS);
      v.setWheelSuspensionStiffness(i, 34);
      v.setWheelSuspensionCompression(i, 3.6);
      v.setWheelSuspensionRelaxation(i, 4.2);
      v.setWheelMaxSuspensionTravel(i, 0.28);
      v.setWheelMaxSuspensionForce(i, 60000);
      v.setWheelFrictionSlip(i, i < 2 ? 3.2 : 2.9);
      v.setWheelSideFrictionStiffness(i, 1.0);
    });

    this.steer = 0; this.speed = 0; this.slip = 0; this.braking = false;
    this.upsideDown = 0; this.lastVel = new THREE.Vector3(); this.impact = 0;
    this.forward = new THREE.Vector3(); this.velocity = new THREE.Vector3();
    this.occupied = false;
  }

  get position() { const t = this.body.translation(); return new THREE.Vector3(t.x, t.y, t.z); }
  get heading() { this.forward.set(0, 0, 1).applyQuaternion(this.root.quaternion); return Math.atan2(this.forward.x, this.forward.z); }

  // input: { throttle, brake, steer, handbrake } (all 0..1 or −1..1); dt fixed physics step
  drive(input, dt) {
    const v = this.vehicle;
    const lv = this.body.linvel();
    this.velocity.set(lv.x, lv.y, lv.z);
    const rot = this.body.rotation();
    this.forward.set(0, 0, 1).applyQuaternion(new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w));
    const speed = this.speed = this.velocity.dot(this.forward);
    const abs = Math.abs(speed);

    const maxSteer = 0.52 * (1 - Math.min(abs / 42, 0.72));
    const target = -input.steer * maxSteer;
    this.steer += (target - this.steer) * Math.min(1, dt * (Math.abs(target) > Math.abs(this.steer) ? 3.6 : 7));
    v.setWheelSteering(0, this.steer); v.setWheelSteering(1, this.steer);

    let engine = 0, brake = 0;
    if (input.throttle > 0) {
      if (speed < -1) brake = input.throttle * BRAKE;
      else if (speed < MAX_SPEED) engine = input.throttle * ENGINE * (1 - Math.max(0, speed - 30) / 40);
    }
    if (input.brake > 0) {
      if (speed > 1) brake = input.brake * BRAKE;
      else if (speed > -14) engine = -input.brake * REVERSE;
    }
    if (!input.throttle && !input.brake && abs < 0.6) brake = 4;   // hold still on slopes
    [2, 3].forEach((i) => v.setWheelEngineForce(i, engine));
    [0, 1].forEach((i) => v.setWheelBrake(i, brake * 0.6));
    [2, 3].forEach((i) => {
      v.setWheelBrake(i, input.handbrake ? BRAKE * 0.9 : brake * 0.4);
      v.setWheelSideFrictionStiffness(i, input.handbrake ? 0.38 : 1.0);
    });
    this.braking = brake > 5 || input.handbrake;
    this.brakeLight.value = this.braking ? 4.5 : 1.3;

    // grip at speed: a little downforce
    this.body.applyImpulse({ x: 0, y: -0.9 * speed * speed * dt, z: 0 }, true);

    v.updateVehicle(dt);

    // slip: how much the car moves sideways
    const side = Math.abs(this.velocity.clone().sub(this.forward.clone().multiplyScalar(speed)).setY(0).length());
    this.slip = Math.min(1, Math.max(0, side - 2.5) / 6) * (abs > 4 ? 1 : 0);

    // impacts from sudden changes of velocity
    const dv = this.velocity.distanceTo(this.lastVel);
    this.impact = dv > 5 ? Math.min((dv - 5) / 12, 1) : 0;
    this.lastVel.copy(this.velocity);

    // stuck on its roof or side: flip back after a moment
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w));
    this.upsideDown = up.y < 0.35 && abs < 3 ? this.upsideDown + dt : 0;
    if (this.upsideDown > 2) this.reset();
  }

  idle(dt) {
    [0, 1, 2, 3].forEach((i) => { this.vehicle.setWheelEngineForce(i, 0); this.vehicle.setWheelBrake(i, 10); });
    this.brakeLight.value = 0.6;
    this.vehicle.updateVehicle(dt);
    const lv = this.body.linvel(); this.velocity.set(lv.x, lv.y, lv.z);
    this.speed = this.velocity.length(); this.slip = 0; this.impact = 0;
  }

  reset() {
    const t = this.body.translation();
    const yaw = this.heading;
    this.body.setTranslation({ x: t.x, y: Math.max(t.y, 0) + 1.4, z: t.z }, true);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true); this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.upsideDown = 0;
  }

  teleport(x, z, heading) {
    this.body.setTranslation({ x, y: 1.4, z }, true);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true); this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  // copy physics → visuals (called every rendered frame)
  sync() {
    const t = this.body.translation(), r = this.body.rotation();
    this.root.position.set(t.x, t.y, t.z);
    this.root.quaternion.set(r.x, r.y, r.z, r.w);
    const v = this.vehicle;
    this.wheels.forEach((w, i) => {
      const len = v.wheelSuspensionLength(i) ?? REST;
      w.position.set(WHEELS[i][0], CONNECT_Y - len - GROUND_OFFSET, WHEELS[i][1]);
      w.rotation.set(0, 0, 0);
      w.rotateY(v.wheelSteering(i) || 0);
      w.rotateX(v.wheelRotation(i) || 0);
    });
  }
}

// Body and cabin geometry shared with the traffic (instanced, no lights).
export function carGeometries() {
  return { body: extrude(profileShape(), 1.8, 0.07), cabin: extrude(cabinShape(), 1.5, 0.05), wheel: new THREE.CylinderGeometry(RADIUS, RADIUS, 0.3, 14).rotateZ(Math.PI / 2) };
}
export const CAR_GROUND_OFFSET = GROUND_OFFSET;
