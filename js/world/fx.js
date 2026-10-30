// Particle effects and road marks: tyre smoke, crash sparks, steam from manholes and skid marks that fade.
// Particles are instanced camera-facing quads from fixed pools, so the cost does not grow with the action.
import * as THREE from 'three/webgpu';
import { instancedBufferAttribute, texture, vec3, float } from 'three/tsl';

function softDot() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.45)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

class Pool {
  constructor(scene, size, { additive = false, glow = 1 } = {}) {
    this.size = size; this.next = 0;
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(size), 1);
    this.tint = new THREE.InstancedBufferAttribute(new Float32Array(size * 3), 3);
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    const tex = texture(softDot());
    mat.colorNode = instancedBufferAttribute(this.tint).mul(glow);
    mat.opacityNode = tex.a.mul(instancedBufferAttribute(this.alpha));
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, size);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 3;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.p = Array.from({ length: size }, () => ({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, max: 1, size: 1, grow: 0, gravity: 0, drag: 0, alpha: 1 }));
    scene.add(this.mesh);
    this.m = new THREE.Matrix4(); this.s = new THREE.Vector3();
  }
  spawn(pos, vel, { life = 1, size = 1, grow = 0, gravity = 0, drag = 0, color = [1, 1, 1], alpha = 1 } = {}) {
    const k = this.next++ % this.size, p = this.p[k];
    p.pos.copy(pos); p.vel.copy(vel); p.life = p.max = life; p.size = size; p.grow = grow; p.gravity = gravity; p.drag = drag; p.alpha = alpha;
    this.tint.setXYZ(k, color[0], color[1], color[2]);
  }
  update(dt, camera) {
    const q = camera.quaternion;
    for (let k = 0; k < this.size; k++) {
      const p = this.p[k];
      if (p.life > 0) {
        p.life -= dt;
        p.vel.y -= p.gravity * dt; p.vel.multiplyScalar(1 - Math.min(1, p.drag * dt));
        p.pos.addScaledVector(p.vel, dt); p.size += p.grow * dt;
      }
      const t = Math.max(0, p.life / p.max);
      this.alpha.setX(k, p.life > 0 ? p.alpha * Math.min(1, t * 2.5) : 0);
      this.s.setScalar(p.life > 0 ? p.size : 0);
      this.m.compose(p.pos, q, this.s); this.mesh.setMatrixAt(k, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true; this.alpha.needsUpdate = true; this.tint.needsUpdate = true;
  }
}

// skid marks: dark rubber strips laid on the asphalt, recycled oldest first
class Marks {
  constructor(scene, size = 700) {
    this.size = size; this.next = 0;
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(size), 1);
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    mat.colorNode = vec3(0.02, 0.02, 0.022);
    mat.opacityNode = instancedBufferAttribute(this.alpha).mul(float(0.6));
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat, size);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 1;
    this.age = new Float32Array(size).fill(1e9);
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.up = new THREE.Vector3(0, 1, 0);
    for (let k = 0; k < size; k++) { this.m.makeScale(0, 0, 0); this.mesh.setMatrixAt(k, this.m); }
    scene.add(this.mesh);
  }
  add(a, b, width, strength) {
    const len = a.distanceTo(b);
    if (len < 0.05 || len > 3) return;
    const k = this.next++ % this.size;
    this.q.setFromAxisAngle(this.up, Math.atan2(b.x - a.x, b.z - a.z));
    this.m.compose(new THREE.Vector3((a.x + b.x) / 2, Math.max(a.y, b.y) + 0.025, (a.z + b.z) / 2), this.q, new THREE.Vector3(width, 1, len + 0.04));
    this.mesh.setMatrixAt(k, this.m);
    this.age[k] = 0; this.alpha.setX(k, strength);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  update(dt) {
    for (let k = 0; k < this.size; k++) {
      if (this.age[k] > 40) continue;
      this.age[k] += dt;
      if (this.age[k] > 25) this.alpha.setX(k, Math.max(0, this.alpha.getX(k) - dt * 0.08));
    }
    this.alpha.needsUpdate = true;
  }
}

export class FX {
  constructor({ scene }) {
    this.smokePool = new Pool(scene, 180);
    this.sparkPool = new Pool(scene, 120, { additive: true, glow: 4 });
    this.marks = new Marks(scene);
    this.v = new THREE.Vector3();
  }
  smoke(pos, amount = 1, wet = 0) {
    const grey = wet > 0.5 ? 0.85 : 0.7;
    this.smokePool.spawn(pos, this.v.set((Math.random() - 0.5) * 1.2, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 1.2),
      { life: 1.4 + Math.random(), size: 0.5, grow: 1.6 * amount, drag: 1.5, color: [grey, grey, grey + 0.03], alpha: 0.35 * amount });
  }
  sparks(pos, dir, strength = 1) {
    const n = Math.round(10 + strength * 30);
    for (let i = 0; i < n; i++) {
      this.v.copy(dir).multiplyScalar(-2 - Math.random() * 6).add(new THREE.Vector3((Math.random() - 0.5) * 7, Math.random() * 5, (Math.random() - 0.5) * 7));
      this.sparkPool.spawn(pos, this.v, { life: 0.3 + Math.random() * 0.5, size: 0.06 + Math.random() * 0.05, gravity: 14, drag: 0.6, color: [1, 0.62, 0.22], alpha: 1 });
    }
  }
  steam(pos) {
    this.smokePool.spawn(pos, this.v.set((Math.random() - 0.5) * 0.3, 1.2 + Math.random() * 0.6, (Math.random() - 0.5) * 0.3),
      { life: 3 + Math.random() * 2, size: 0.8, grow: 1.1, drag: 0.4, color: [0.92, 0.93, 0.96], alpha: 0.22 });
  }
  engineSmoke(pos) {
    this.smokePool.spawn(pos, this.v.set((Math.random() - 0.5) * 0.4, 1 + Math.random() * 0.5, (Math.random() - 0.5) * 0.4),
      { life: 1.6, size: 0.35, grow: 0.9, drag: 0.6, color: [0.25, 0.25, 0.27], alpha: 0.45 });
  }
  update(dt, camera) {
    this.smokePool.update(dt, camera);
    this.sparkPool.update(dt, camera);
    this.marks.update(dt);
  }
}
