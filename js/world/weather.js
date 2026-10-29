// Weather: clear, cloudy, rain and storm, blended smoothly. Rain wets the streets (WET uniform) and they dry slowly
// afterwards; storms add lightning with the thunder arriving later. 'auto' changes the weather every few game hours.
import * as THREE from 'three/webgpu';
import { WET } from './timeofday.js';

export const STATES = {
  clear:  { cover: 0.12, density: 0.3, turbidity: 2.2, rain: 0, fog: 1, sun: 1, wet: 0, storm: 0 },
  cloudy: { cover: 0.62, density: 0.6, turbidity: 5, rain: 0, fog: 1.35, sun: 0.5, wet: 0, storm: 0 },
  rain:   { cover: 0.85, density: 0.78, turbidity: 8, rain: 1, fog: 1.9, sun: 0.28, wet: 1, storm: 0 },
  storm:  { cover: 0.96, density: 0.92, turbidity: 11, rain: 1.6, fog: 2.5, sun: 0.16, wet: 1, storm: 1 },
};
const AUTO = [['clear', 0.42], ['cloudy', 0.3], ['rain', 0.2], ['storm', 0.08]];

export class Weather {
  constructor(state = 'rain') {
    this.mode = 'auto';
    this.state = state;
    this.p = { ...STATES[state] };
    this.wet = STATES[state].wet;
    this.nextChange = 2.5;           // game hours until the automatic weather changes
    this.flash = 0; this.lightningTimer = 8; this.thunder = [];
  }

  set(mode) {
    this.mode = mode;
    if (STATES[mode]) this.state = mode;
  }

  pickAuto() {
    let r = Math.random();
    for (const [name, w] of AUTO) { if ((r -= w) <= 0) return name; }
    return 'clear';
  }

  // dt real seconds; gameHours advanced this frame; onThunder(delay, strength)
  update(dt, gameHours, onThunder) {
    if (this.mode === 'auto') {
      this.nextChange -= gameHours;
      if (this.nextChange <= 0) { this.state = this.pickAuto(); this.nextChange = 2 + Math.random() * 4; }
    }
    const target = STATES[this.state];
    const k = 1 - Math.exp(-dt / 6);     // ~20 s to settle
    for (const key of Object.keys(target)) this.p[key] += (target[key] - this.p[key]) * k;
    // streets get wet quickly in the rain and dry in about two minutes
    this.wet = THREE.MathUtils.clamp(this.wet + (this.p.rain > 0.3 ? dt / 25 : -dt / 140), 0, 1);
    WET.value = this.wet;

    this.flash = Math.max(0, this.flash - dt * 5);
    if (this.p.storm > 0.6) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 6 + Math.random() * 14;
        this.flash = 1;
        const distance = 0.4 + Math.random() * 2.6;
        onThunder?.(distance, 1 - distance / 3.2);
      }
    }
  }

  get icon() { return { clear: '☀', cloudy: '☁', rain: '☂', storm: '⚡' }[this.state]; }
}
