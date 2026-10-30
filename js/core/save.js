// Progress and settings in this browser only (localStorage can be blocked: every access is guarded).
const KEY = 'isgame.v1';

const DEFAULTS = {
  settings: {
    lang: '', quality: 'auto', music: 0.55, sfx: 0.8, sens: 1, time: 'auto', cycle: 24, weather: 'auto', fps: false, character: 'man_beach',
    gfx: { scale: 1, reflections: 'auto', occlusion: 'auto', aa: 'auto', motionBlur: false, grain: true },
  },
  missions: {},        // id -> 'done'
  facts: [],           // collected fact ids
  intro: false,        // first talk with the guide done
  graduated: false,
};

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}

export const save = {
  data: structuredClone(DEFAULTS),
  load() {
    const stored = read();
    if (stored && typeof stored === 'object') {
      const settings = { ...DEFAULTS.settings, ...(stored.settings || {}) };
      settings.gfx = { ...DEFAULTS.settings.gfx, ...((stored.settings || {}).gfx || {}) };
      this.data = { ...structuredClone(DEFAULTS), ...stored, settings };
      if (!Array.isArray(this.data.facts)) this.data.facts = [];
    }
    return this.data;
  },
  write() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* private mode: progress lives only this session */ }
  },
  reset() {
    const settings = this.data.settings;
    this.data = { ...structuredClone(DEFAULTS), settings };
    this.write();
  },
};
