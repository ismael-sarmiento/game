// Humanoid androids built from primitives with procedural animation (walk, run, idle, talk, wave) — used for the
// player and the mentors — and the player's on-foot controller (Rapier kinematic character controller).
import * as THREE from 'three/webgpu';
import { normalView, positionViewDirection, dot, pow, float, vec3 } from 'three/tsl';
import { neonMaterial } from '../world/materials.js';
import { PersonRig } from '../world/people.js';

// soft coloured rim so dark suits still read against the night city
const rim = (color, strength) => { const c = new THREE.Color(color); return vec3(c.r, c.g, c.b).mul(pow(float(1).sub(dot(normalView, positionViewDirection).abs()), 2.6)).mul(strength); };

const capsule = (r, len) => new THREE.CapsuleGeometry(r, len, 6, 12);

export function buildAndroid({ suit = '#1a2142', trim = '#e2b25c', visor = '#3fe0ff', scale = 1 } = {}) {
  const root = new THREE.Group();
  const suitMat = new THREE.MeshPhysicalNodeMaterial({ color: suit, metalness: 0.45, roughness: 0.4, clearcoat: 0.6 });
  suitMat.emissiveNode = rim(visor, 1.1);
  const skinMat = new THREE.MeshPhysicalNodeMaterial({ color: '#d5d9ea', metalness: 0.6, roughness: 0.25, clearcoat: 1 });
  skinMat.emissiveNode = rim(trim, 0.7);
  const trimMat = neonMaterial(new THREE.Color(trim), 2.4);
  const visorMat = neonMaterial(new THREE.Color(visor), 3.2);
  const part = (geo, mat, parent, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };

  const hips = new THREE.Group(); hips.position.y = 0.98; root.add(hips);
  const torso = new THREE.Group(); hips.add(torso);
  part(capsule(0.24, 0.42), suitMat, torso, 0, 0.36, 0).scale.set(1.08, 1, 0.72);
  part(new THREE.BoxGeometry(0.06, 0.5, 0.02), trimMat, torso, 0, 0.38, 0.19);           // chest light line
  part(new THREE.TorusGeometry(0.2, 0.018, 6, 24).rotateX(Math.PI / 2), trimMat, torso, 0, 0.08, 0).scale.set(1.15, 1, 0.8);
  const neck = new THREE.Group(); neck.position.y = 0.74; torso.add(neck);
  const head = new THREE.Group(); head.position.y = 0.16; neck.add(head);
  part(new THREE.SphereGeometry(0.17, 20, 16), skinMat, head).scale.set(0.95, 1.12, 1);
  part(new THREE.BoxGeometry(0.26, 0.06, 0.06), visorMat, head, 0, 0.03, 0.15);
  part(new THREE.SphereGeometry(0.035, 8, 6), trimMat, head, 0.17, 0.02, 0);
  part(new THREE.SphereGeometry(0.035, 8, 6), trimMat, head, -0.17, 0.02, 0);

  const limb = (x, y, upperLen, lowerLen, r, parent) => {
    const top = new THREE.Group(); top.position.set(x, y, 0); parent.add(top);
    part(capsule(r, upperLen), suitMat, top, 0, -upperLen / 2 - r, 0);
    const joint = new THREE.Group(); joint.position.y = -upperLen - r * 1.6; top.add(joint);
    part(capsule(r * 0.9, lowerLen), skinMat, joint, 0, -lowerLen / 2 - r, 0);
    part(new THREE.TorusGeometry(r * 1.05, 0.012, 6, 16).rotateX(Math.PI / 2), trimMat, joint, 0, 0, 0);
    return { top, joint };
  };
  const armL = limb(0.3, 0.62, 0.24, 0.22, 0.07, torso), armR = limb(-0.3, 0.62, 0.24, 0.22, 0.07, torso);
  const legL = limb(0.12, 0, 0.36, 0.34, 0.09, hips), legR = limb(-0.12, 0, 0.36, 0.34, 0.09, hips);
  root.scale.setScalar(scale);

  let phase = 0, wave = 0;
  return {
    root, head, visorMat,
    // speed in m/s; talking 0..1 adds gestures; airborne tucks the legs
    animate(dt, speed, { talking = 0, airborne = false, waving = false, t = performance.now() / 1000 } = {}) {
      const run = Math.min(speed / 7, 1);
      phase += dt * (speed > 0.2 ? 4 + speed * 1.15 : 0);
      const s = Math.sin(phase), c = Math.cos(phase);
      const amp = speed > 0.2 ? 0.45 + run * 0.5 : 0;
      legL.top.rotation.x = s * amp; legR.top.rotation.x = -s * amp;
      legL.joint.rotation.x = Math.max(0, -c) * amp * 1.4; legR.joint.rotation.x = Math.max(0, c) * amp * 1.4;
      armL.top.rotation.x = -s * amp * 0.8; armR.top.rotation.x = s * amp * 0.8;
      armL.joint.rotation.x = -0.3 - run * 0.9; armR.joint.rotation.x = -0.3 - run * 0.9;
      armL.top.rotation.z = 0.08; armR.top.rotation.z = -0.08;
      hips.position.y = 0.98 + Math.abs(s) * 0.05 * amp + (speed < 0.2 ? Math.sin(t * 1.6) * 0.012 : 0);
      torso.rotation.x = run * 0.22;
      torso.rotation.y = s * 0.08 * amp;
      if (airborne) { legL.top.rotation.x = 0.7; legR.top.rotation.x = -0.2; legL.joint.rotation.x = 1.1; legR.joint.rotation.x = 0.6; armL.top.rotation.z = 0.8; armR.top.rotation.z = -0.8; }
      if (talking > 0) {
        armR.top.rotation.x = -0.5 + Math.sin(t * 3.1) * 0.25 * talking; armR.joint.rotation.x = -1.1 + Math.sin(t * 4.3) * 0.3;
        head.rotation.z = Math.sin(t * 2.3) * 0.06 * talking;
      }
      wave = THREE.MathUtils.damp(wave, waving ? 1 : 0, 6, dt);
      if (wave > 0.01) { armL.top.rotation.z = 0.08 + wave * 2.6; armL.joint.rotation.z = Math.sin(t * 9) * 0.5 * wave; armL.joint.rotation.x = 0; }
      else armL.joint.rotation.z = 0;
    },
  };
}

export class Avatar {
  constructor({ scene, world, RAPIER }, at, people, variant = 'man_beach') {
    this.RAPIER = RAPIER; this.world = world;
    this.look = new PersonRig(people[variant] || people.man_beach);
    this.root = this.look.root;
    scene.add(this.root);
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(at.x, at.y + 1, at.z));
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(0.55, 0.32).setTranslation(0, 0, 0), this.body);
    const c = this.controller = world.createCharacterController(0.03);
    c.setUp({ x: 0, y: 1, z: 0 });
    c.enableAutostep(0.45, 0.25, true);
    c.enableSnapToGround(0.45);
    c.setMaxSlopeClimbAngle(50 * Math.PI / 180);
    c.setApplyImpulsesToDynamicBodies(true);
    this.vy = 0; this.grounded = true; this.facing = 0; this.speed = 0; this.stepTimer = 0;
    this.velocity = new THREE.Vector3();
  }

  get position() { const t = this.body.translation(); return new THREE.Vector3(t.x, t.y - 0.87, t.z); }

  setEnabled(on) {
    this.collider.setEnabled(on);
    this.root.visible = on;
  }

  place(x, y, z, facing = this.facing) {
    this.body.setTranslation({ x, y: y + 0.9, z }, true);
    this.body.setNextKinematicTranslation({ x, y: y + 0.9, z });
    this.facing = facing; this.vy = 0;
  }

  // move: world-space direction (x, z) already relative to the camera, length 0..1
  update(dt, move, { sprint, jump }, onStep) {
    const len = Math.min(1, Math.hypot(move.x, move.z));
    const target = len * (sprint ? 8.2 : 4.4);
    this.speed = THREE.MathUtils.damp(this.speed, target, 10, dt);
    if (len > 0.05) {
      const want = Math.atan2(move.x, move.z);
      let d = want - this.facing; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.facing += d * Math.min(1, dt * 12);
    }
    if (this.grounded && jump && !this.jumpHeld) this.vy = 7.2;
    this.jumpHeld = jump;
    this.vy -= 24 * dt;
    const dir = len > 0.05 ? { x: move.x / len, z: move.z / len } : { x: Math.sin(this.facing), z: Math.cos(this.facing) };
    const desired = { x: dir.x * this.speed * dt, y: this.vy * dt, z: dir.z * this.speed * dt };
    this.controller.computeColliderMovement(this.collider, desired);
    const mv = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.vy < 0) this.vy = -1;
    const t = this.body.translation();
    const next = { x: t.x + mv.x, y: Math.max(t.y + mv.y, 0.95), z: t.z + mv.z };
    this.body.setNextKinematicTranslation(next);
    this.velocity.set(mv.x / dt, mv.y / dt, mv.z / dt);
    const ground = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.grounded && ground > 1) {
      this.stepTimer -= dt * ground;
      if (this.stepTimer <= 0) { this.stepTimer = 1.6; onStep?.(); }
    }
  }

  sync(dt) {
    const t = this.body.translation();
    this.root.position.set(t.x, t.y - 0.87 - 0.05, t.z);
    this.root.rotation.y = this.facing;
    this.look.animate(dt, Math.hypot(this.velocity.x, this.velocity.z));
  }
}
