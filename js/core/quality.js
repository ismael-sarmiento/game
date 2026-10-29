// Quality presets and the automatic choice: start from the device class, then step down while frames are slow.
export const PRESETS = {
  high:   { pixelRatio: 2,    shadows: 2048, bloom: true, rain: 2600, traffic: 34, walkers: 70, drawDistance: 900, lights: true },
  medium: { pixelRatio: 1.5,  shadows: 1024, bloom: true, rain: 1400, traffic: 24, walkers: 48, drawDistance: 650, lights: true },
  low:    { pixelRatio: 1,    shadows: 0,    bloom: false, rain: 600, traffic: 14, walkers: 26, drawDistance: 420, lights: false },
};

export const isTouch = () => matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1 && !matchMedia('(pointer: fine)').matches;

export function initialLevel(setting) {
  const param = new URLSearchParams(location.search).get('quality');
  if (PRESETS[param]) return { level: param, auto: false };
  if (PRESETS[setting]) return { level: setting, auto: false };
  const cores = navigator.hardwareConcurrency || 4;
  const level = isTouch() ? (cores >= 8 ? 'medium' : 'low') : (cores >= 8 ? 'high' : 'medium');
  return { level, auto: true };
}

// Watches frame times and asks to step down once (per level) after a sustained slow stretch.
export class AutoQuality {
  constructor(onChange) { this.onChange = onChange; this.samples = []; this.cooldown = 4; this.enabled = true; }
  sample(dt, level) {
    if (!this.enabled) return;
    this.cooldown -= dt;
    this.samples.push(dt);
    if (this.samples.length > 120) this.samples.shift();
    if (this.cooldown > 0 || this.samples.length < 120) return;
    const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    if (avg > 1 / 38 && level !== 'low') {
      this.samples.length = 0; this.cooldown = 6;
      this.onChange(level === 'high' ? 'medium' : 'low');
    }
  }
}
