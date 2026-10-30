// Quality presets and the automatic choice: start from the device class, then step down while frames are slow.
export const PRESETS = {
  high:   { pixelRatio: 1.5,  shadows: 2048, bloom: true, reflections: true, occlusion: true, aa: 'traa', rain: 2600, traffic: 34, walkers: 70, drawDistance: 900, detail: 1, lights: true },
  medium: { pixelRatio: 1.25, shadows: 1024, bloom: true, reflections: false, occlusion: true, aa: 'fxaa', rain: 1400, traffic: 24, walkers: 48, drawDistance: 650, detail: 0.75, lights: true },
  low:    { pixelRatio: 1,    shadows: 0,    bloom: false, reflections: false, occlusion: false, aa: 'fxaa', rain: 600, traffic: 14, walkers: 26, drawDistance: 420, detail: 0.55, lights: false },
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

// Watches frame times and asks for relief after a sustained slow stretch (under about 50 fps on average for 120
// frames); the caller decides what to give up first.
export class AutoQuality {
  constructor(onSlow) { this.onSlow = onSlow; this.samples = []; this.cooldown = 4; this.enabled = true; }
  sample(dt) {
    if (!this.enabled) return;
    this.cooldown -= dt;
    this.samples.push(dt);
    if (this.samples.length > 120) this.samples.shift();
    if (this.cooldown > 0 || this.samples.length < 120) return;
    const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    if (avg > 1 / 50) { this.samples.length = 0; this.cooldown = 6; this.onSlow(); }
  }
}

// Effects for the post-processing chain: the preset decides, unless the player forced an option in Settings. On Auto,
// the WebGL2 fallback keeps to the light effects (each of reflections, ambient occlusion and TRAA drops busy views to
// about 45 fps there), and `relief` holds the effects the automatic quality has switched off.
export function effects(preset, gfx, { backend = 'WebGPU', relief = {} } = {}) {
  const lite = backend === 'WebGL2';
  const auto = (key) => preset[key] && !relief[key] && !lite;
  const pick = (key) => (gfx[key] === 'on' ? true : gfx[key] === 'off' ? false : auto(key));
  return {
    reflections: pick('reflections'), occlusion: pick('occlusion'), bloom: preset.bloom || gfx.bloom === 'on',
    aa: gfx.aa !== 'auto' ? gfx.aa : lite && preset.aa === 'traa' ? 'fxaa' : preset.aa,
    motionBlur: Boolean(gfx.motionBlur), grain: Boolean(gfx.grain),
  };
}
