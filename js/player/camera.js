// Third-person camera: orbit with mouse/stick/touch, recentres behind the car, widens the field of view with speed,
// shakes on impacts and pulls in when a wall would block the view.
import * as THREE from 'three/webgpu';

const DISTANCES = { car: [7.5, 10, 14], foot: [4.6, 6.2, 8.5] };

export class ChaseCamera {
  constructor(camera, { world, RAPIER }) {
    this.camera = camera; this.world = world; this.RAPIER = RAPIER;
    this.yaw = 0; this.pitch = 0.26; this.zoomIndex = 0; this.zoomExtra = 0;
    this.idle = 0; this.shake = 0; this.dist = 7;
    this.target = new THREE.Vector3(); this.pos = new THREE.Vector3();
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    this.mode = 'foot';
  }

  cycle() { this.zoomIndex = (this.zoomIndex + 1) % 3; }
  bump(amount) { this.shake = Math.min(1, this.shake + amount); }
  snap(yaw) { this.yaw = yaw; this.idle = 0; }

  // focus: point to look at; heading: yaw of the car or avatar; speed: m/s; exclude: rigid body to ignore
  update(dt, look, { mode, focus, heading, speed, exclude }) {
    if (mode !== this.mode) { this.mode = mode; this.zoomExtra = 0; }
    const active = Math.abs(look.x) + Math.abs(look.y) > 0.0001;
    this.yaw -= look.x; this.pitch = THREE.MathUtils.clamp(this.pitch + look.y, -0.1, 1.2);
    this.zoomExtra = THREE.MathUtils.clamp(this.zoomExtra + look.zoom * 0.8, -2, 10);
    this.idle = active ? 0 : this.idle + dt;

    if (mode === 'car') {
      // after a moment without input, swing back behind the car (faster when going fast)
      const wantYaw = heading + (speed < -2 ? Math.PI : 0);
      if (this.idle > 0.9 && Math.abs(speed) > 1.5) {
        let d = wantYaw - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
        this.yaw += d * Math.min(1, dt * (1.4 + Math.abs(speed) * 0.06));
        this.pitch = THREE.MathUtils.damp(this.pitch, 0.2, 1.5, dt);
      }
    }

    const portrait = this.camera.aspect < 1;   // phones held upright: pull back so the car does not fill the screen
    const base = (DISTANCES[mode][this.zoomIndex] + this.zoomExtra) * (portrait ? 1.3 : 1) + (mode === 'car' ? Math.min(Math.abs(speed) * 0.05, 2.5) : 0);
    this.target.lerp(focus, 1 - Math.exp(-dt * (mode === 'car' ? 14 : 18)));
    if (this.target.distanceToSquared(focus) > 400) this.target.copy(focus);

    const dir = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    // keep walls out of the way: cast from the focus point back towards the camera
    this.ray.origin = { x: this.target.x, y: this.target.y, z: this.target.z };
    this.ray.dir = { x: -dir.x, y: dir.y, z: -dir.z };
    const hit = this.world.castRay(this.ray, base, true, undefined, undefined, undefined, exclude);
    const allowed = hit ? Math.max(1.2, hit.timeOfImpact - 0.4) : base;
    this.dist = allowed < this.dist ? allowed : THREE.MathUtils.damp(this.dist, allowed, 3, dt);

    this.pos.set(this.target.x - dir.x * this.dist, Math.max(this.target.y + dir.y * this.dist, 0.4), this.target.z - dir.z * this.dist);
    this.camera.position.copy(this.pos);
    if (this.shake > 0.001) {
      const s = this.shake * this.shake * 0.35;
      this.camera.position.x += (Math.random() - 0.5) * s; this.camera.position.y += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 2.2);
    }
    this.camera.lookAt(this.target.x, this.target.y + (mode === 'car' ? 0.6 : 0.2), this.target.z);
    const fov = (mode === 'car' ? 62 + Math.min(Math.abs(speed) * 0.42, 22) : 60) + (portrait ? 14 : 0);
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, fov, 4, dt);
    this.camera.updateProjectionMatrix();
  }

  // forward/right of the camera on the ground plane, for on-foot movement
  basis() {
    const f = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    return { f, r: new THREE.Vector3(-f.z, 0, f.x) };
  }
}
