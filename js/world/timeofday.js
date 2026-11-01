// Game clock and celestial positions. One full day lasts `cycleMinutes` real minutes (24 by default); a fixed
// setting (dawn, day, dusk, night) stops the clock. NIGHT and DUSK are shared TSL uniforms (0..1) that materials read
// to switch on windows, neon and lamps; SKY tints the sky reflected by windows.
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

export const NIGHT = uniform(1);
export const DUSK = uniform(0);
export const WET = uniform(1);
export const SKY = uniform(new THREE.Color(0.6, 0.7, 0.85));   // colour of the sky near the horizon, for glass reflections

export const FIXED_HOURS = { dawn: 6.35, day: 13, dusk: 17.65, night: 23.2 };
const smooth = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export class TimeOfDay {
  constructor(hour = 18.7) {
    this.hour = hour;
    this.mode = 'auto';
    this.cycleMinutes = 24;
    this.sun = new THREE.Vector3();
    this.moon = new THREE.Vector3();
    this.update(0);
  }

  set(mode, cycleMinutes) {
    this.mode = mode;
    if (cycleMinutes) this.cycleMinutes = cycleMinutes;
    if (FIXED_HOURS[mode] != null) this.hour = FIXED_HOURS[mode];
  }

  update(dt) {
    if (this.mode === 'auto') this.hour = (this.hour + dt * (24 / (this.cycleMinutes * 60))) % 24;
    const h = this.hour;
    // the sun rises at 6:00 in the east (+x), peaks at noon (≈ 62°) and sets at 18:00 in the west
    const day = ((h - 6) / 12) * Math.PI;
    const elevation = Math.sin(day) * THREE.MathUtils.degToRad(62);
    const azimuth = day + Math.PI * 0.08;
    this.sun.set(Math.cos(azimuth) * Math.cos(elevation), Math.sin(elevation), -0.35 * Math.cos(elevation)).normalize();
    this.moon.set(-this.sun.x * 0.8, Math.max(0.35, -this.sun.y), -this.sun.z - 0.4).normalize();
    this.night = smooth(0.06, -0.14, this.sun.y);      // 1 when the sun is ~8° below the horizon
    this.dusk = Math.max(0, 1 - Math.abs(this.sun.y) / 0.22) * (1 - this.night * 0.6);
    NIGHT.value = this.night;
    DUSK.value = this.dusk;
  }

  get label() {
    const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
