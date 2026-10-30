// City life: android pedestrians on the sidewalks (instanced, they hop aside from cars), drones overhead and the five
// mentors the player can talk to, each with a beacon, a marker and a name plate.
import * as THREE from 'three/webgpu';
import { CITY, blockAt, isCampus, rng } from './layout.js';
import { neonMaterial } from './materials.js';
import { PersonRig } from './people.js';

const MAX = 80;
const EDGE = CITY.BLOCK / 2 - 2.5;          // walkers stay 2.5 m inside the block edge, on the sidewalk
const PERIM = EDGE * 8;
const VISORS = ['#3fe0ff', '#e2b25c', '#a98bff', '#5dffa8', '#ff5c7a'];

export class Walkers {
  constructor({ scene }, count) {
    this.rand = rng(31);
    const suit = new THREE.MeshPhysicalNodeMaterial({ color: '#1b2247', metalness: 0.5, roughness: 0.4, clearcoat: 0.5 });
    const skin = new THREE.MeshPhysicalNodeMaterial({ color: '#b9bdd3', metalness: 0.7, roughness: 0.3 });
    const visorColors = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.parts = {
      torso: new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.22, 0.5, 4, 10), suit, MAX),
      head: new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 14, 10), skin, MAX),
      visor: new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.05, 0.05), neonMaterial(visorColors, 3), MAX),
      legs: new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.08, 0.62, 4, 8).translate(0, -0.39, 0), suit, MAX * 2),
      arms: new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.06, 0.5, 4, 8).translate(0, -0.3, 0), skin, MAX * 2),
    };
    Object.values(this.parts).forEach((m) => { m.frustumCulled = false; m.castShadow = true; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); });
    this.list = [];
    for (let k = 0; k < MAX; k++) {
      const c = new THREE.Color(VISORS[k % VISORS.length]);
      visorColors.setXYZ(k, c.r, c.g, c.b);
      this.list.push({ k, pos: new THREE.Vector3(), phase: this.rand() * 10, speed: 1.1 + this.rand() * 0.7, dir: this.rand() < 0.5 ? 1 : -1, hop: 0, push: 0, wave: 0 });
    }
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.s = new THREE.Vector3(1, 1, 1);
    this.count = 0; this.setCount(count);
    this.placed = false;
  }

  setCount(n) { this.count = Math.min(n, MAX); this.placed = false; }

  assign(w, centre, near) {
    let i, j;
    for (let tries = 0; tries < 20; tries++) {
      const span = near ? 2 : CITY.N;
      const ci = near ? Math.round((centre.x + CITY.HALF - CITY.ROAD - CITY.BLOCK / 2) / CITY.PITCH) : 0;
      const cj = near ? Math.round((centre.z + CITY.HALF - CITY.ROAD - CITY.BLOCK / 2) / CITY.PITCH) : 0;
      i = THREE.MathUtils.clamp(ci + Math.floor(this.rand() * (span * 2 + 1)) - span, 0, CITY.N - 1);
      j = THREE.MathUtils.clamp(cj + Math.floor(this.rand() * (span * 2 + 1)) - span, 0, CITY.N - 1);
      if (!isCampus(i, j) || this.rand() < 0.3) break;
    }
    w.bx = blockAt(i); w.bz = blockAt(j); w.s = this.rand() * PERIM;
  }

  // perimeter coordinate → point on the sidewalk loop and walking direction
  loop(w) {
    const s = ((w.s % PERIM) + PERIM) % PERIM, side = Math.floor(s / (EDGE * 2)), u = s % (EDGE * 2) - EDGE;
    const corners = [[u, -EDGE, 1, 0], [EDGE, u, 0, 1], [-u, EDGE, -1, 0], [-EDGE, -u, 0, -1]][side];
    return { x: w.bx + corners[0], z: w.bz + corners[1], fx: corners[2] * w.dir, fz: corners[3] * w.dir, nx: side === 1 ? 1 : side === 3 ? -1 : 0, nz: side === 0 ? -1 : side === 2 ? 1 : 0 };
  }

  scare(at, radius) {
    for (let k = 0; k < this.count; k++) { const w = this.list[k]; if (w.pos.distanceTo(at) < radius && w.hop <= 0) { w.hop = 0.6; w.push = 1.4; } }
  }

  update(dt, game) {
    const p = game.player;
    if (!this.placed) { this.list.forEach((w, k) => this.assign(w, p, k % 3 !== 0)); this.placed = true; }
    const fast = game.mode === 'car' && Math.abs(game.car.speed) > 4;
    const { m, q, e, s } = this;
    const v = new THREE.Vector3(), off = new THREE.Vector3();
    for (let k = 0; k < MAX; k++) {
      const w = this.list[k];
      if (k >= this.count) { s.setScalar(0); m.compose(v.set(0, -20, 0), q, s); ['torso', 'head', 'visor'].forEach((n) => this.parts[n].setMatrixAt(k, m)); [0, 1].forEach((x) => { this.parts.legs.setMatrixAt(k * 2 + x, m); this.parts.arms.setMatrixAt(k * 2 + x, m); }); continue; }
      if (w.pos.distanceToSquared(p) > 230 * 230) this.assign(w, p, true);
      const urgency = w.push > 0 ? 2.4 : 1;
      w.s += w.speed * w.dir * dt * urgency;
      const L = this.loop(w);
      if (fast && w.hop <= 0 && (L.x - p.x) ** 2 + (L.z - p.z) ** 2 < 49) { w.hop = 0.6; w.push = 1.2; game.audio.play('glitch'); }
      w.hop = Math.max(0, w.hop - dt); w.push = Math.max(0, w.push - dt * 0.5);
      // dodge: step towards the building side while scared
      const dodge = Math.min(w.push, 1) * 2;
      w.pos.set(L.x - L.nx * dodge, CITY.CURB + Math.sin((w.hop / 0.6) * Math.PI) * 0.7 * (w.hop > 0 ? 1 : 0), L.z - L.nz * dodge);
      w.phase += dt * w.speed * urgency * 5.5;
      const yaw = Math.atan2(L.fx, L.fz);
      const sw = Math.sin(w.phase) * 0.5, bob = Math.abs(Math.cos(w.phase)) * 0.04;
      s.setScalar(1);
      q.setFromEuler(e.set(0, yaw, 0));
      m.compose(v.set(w.pos.x, w.pos.y + 1.22 + bob, w.pos.z), q, s); this.parts.torso.setMatrixAt(k, m);
      m.compose(v.set(w.pos.x, w.pos.y + 1.72 + bob, w.pos.z), q, s); this.parts.head.setMatrixAt(k, m);
      off.set(0, 1.74 + bob, 0.14).applyQuaternion(q).add(w.pos); m.compose(off, q, s); this.parts.visor.setMatrixAt(k, m);
      [-1, 1].forEach((side, x) => {
        q.setFromEuler(e.set(sw * side, yaw, 0, 'YXZ'));
        off.set(side * 0.11, 0.9 + bob, 0).applyQuaternion(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)).add(w.pos);
        m.compose(off, q, s); this.parts.legs.setMatrixAt(k * 2 + x, m);
        q.setFromEuler(e.set(-sw * side * 0.8 - (w.hop > 0 ? 2.4 : 0), yaw, 0, 'YXZ'));
        off.set(side * 0.29, 1.5 + bob, 0).applyQuaternion(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)).add(w.pos);
        m.compose(off, q, s); this.parts.arms.setMatrixAt(k * 2 + x, m);
      });
    }
    Object.values(this.parts).forEach((x) => { x.instanceMatrix.needsUpdate = true; });
  }
}

// Mentor definitions: position on a sidewalk of their district, colours and mission.
export const MENTORS = [
  { id: 'iris', variant: 'woman_formal', x: 24, z: 26, face: Math.PI * 1.25, suit: '#2a2150', trim: '#f2d18b', visor: '#f2d18b', color: '#f2d18b', district: 'campus' },
  { id: 'byte', variant: 'woman_casual', x: blockAt(8) - EDGE, z: blockAt(3), face: -Math.PI / 2, suit: '#3a2a10', trim: '#e2b25c', visor: '#e2b25c', color: '#e2b25c', district: 'data', mission: 'route' },
  { id: 'kernel', variant: 'man_worker', x: blockAt(9) - EDGE, z: blockAt(8), face: -Math.PI / 2, suit: '#0f3326', trim: '#5dffa8', visor: '#5dffa8', color: '#5dffa8', district: 'sec', mission: 'debug' },
  { id: 'nova', variant: 'woman_suit', x: blockAt(3) + EDGE, z: blockAt(3), face: Math.PI / 2, suit: '#0d2c3a', trim: '#3fe0ff', visor: '#3fe0ff', color: '#3fe0ff', district: 'ia', mission: 'train' },
  { id: 'lia', variant: 'woman_suit', reach: 4.8, noMarker: true, x: blockAt(5) + 4.2, z: blockAt(5), face: Math.PI / 2, suit: '#14182c', trim: '#f2d18b', visor: '#f2d18b', color: '#f2d18b', district: 'campus' },
  { id: 'echo', variant: 'man_suit', x: blockAt(3) + EDGE, z: blockAt(8), face: Math.PI / 2, suit: '#24164a', trim: '#a98bff', visor: '#a98bff', color: '#a98bff', district: 'net' },
];

function labelTexture(text, color) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.font = '700 64px "Space Grotesk", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = color; g.shadowBlur = 18; g.fillStyle = color; g.fillText(text, 256, 64);
  g.shadowBlur = 0; g.fillStyle = '#ffffff'; g.fillText(text, 256, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Mentors {
  constructor({ scene, world, RAPIER }, people) {
    this.list = MENTORS.map((def) => {
      const look = new PersonRig(people[def.variant]);
      look.root.position.set(def.x, CITY.CURB, def.z);
      look.root.rotation.y = def.face;
      scene.add(look.root);
      world.createCollider(RAPIER.ColliderDesc.capsule(0.55, 0.3).setTranslation(def.x, CITY.CURB + 0.9, def.z));
      const color = new THREE.Color(def.color);
      const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.32), neonMaterial(color, 3.5));
      marker.scale.y = 1.5; scene.add(marker);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.15, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicNodeMaterial({ color: color.clone().multiplyScalar(2), transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
      ring.position.set(def.x, CITY.CURB + 0.03, def.z); scene.add(ring);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 120, 12, 1, true).translate(0, 60, 0),
        new THREE.MeshBasicNodeMaterial({ color: color.clone().multiplyScalar(0.9), transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
      beam.position.set(def.x, CITY.CURB, def.z); scene.add(beam);
      const label = new THREE.Sprite(new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false }));
      label.material.map = labelTexture(def.id === 'lia' ? 'Lía' : def.id[0].toUpperCase() + def.id.slice(1), def.color);
      label.material.color.setScalar(0.7);   // readable without blooming into a blob
      label.scale.set(1.8, 0.45, 1); label.position.set(def.x, CITY.CURB + 2.75, def.z); scene.add(label);
      return { ...def, look, marker, ring, beam, label, yaw: def.face, waved: false, talking: 0, state: 'idle' };
    });
  }

  byId(id) { return this.list.find((m) => m.id === id); }

  // state: 'offer' (has something for you: tall beam), 'active', 'done', 'idle'
  setState(id, state) { const m = this.byId(id); if (m) m.state = state; }

  nearest(p, radius = 3.4) {
    let best = null, bd = radius;
    for (const m of this.list) { const d = Math.hypot(m.x - p.x, m.z - p.z) - (m.reach ? m.reach - radius : 0); if (d < bd) { bd = d; best = m; } }
    return best;
  }

  update(dt, game) {
    const p = game.player, t = game.time;
    for (const m of this.list) {
      const d = Math.hypot(p.x - m.x, p.z - m.z);
      const facing = d < 9 ? Math.atan2(p.x - m.x, p.z - m.z) : m.face;
      let dy = facing - m.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      m.yaw += dy * Math.min(1, dt * 3);
      m.look.root.rotation.y = m.yaw;
      const waving = d < 11 && d > 3.5 && !m.waved && game.mode === 'foot';
      if (d < 3.5) m.waved = true;
      if (d > 30) m.waved = false;
      m.talking = THREE.MathUtils.damp(m.talking, game.dialogue.open && game.dialogue.mentor === m ? 1 : 0, 4, dt);
      m.look.animate(dt, 0, { talking: m.talking, waving, t: t + m.x });
      m.marker.position.set(m.x, CITY.CURB + 3.4 + Math.sin(t * 2 + m.z) * 0.12, m.z);
      m.marker.rotation.y += dt * 1.6;
      const show = m.state === 'offer' || m.state === 'active';
      m.marker.visible = !m.noMarker && (m.state !== 'done' || m.id === 'iris' || m.id === 'echo');
      m.beam.visible = show && d > 12;
      m.beam.material.opacity = 0.12 + Math.sin(t * 2) * 0.04;
      m.ring.scale.setScalar(1 + Math.sin(t * 3) * 0.06);
      m.label.visible = d > 5 && d < 30;   // close up the dialogue box already names them
    }
  }
}
