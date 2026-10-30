// All sound is synthesised with Web Audio: a slow synthwave score, engine, tyres, wind, rain and interface cues, plus
// the city around the player: traffic rumble, crowd murmur, waves, gusts and a helicopter, panned towards their source.
// The context starts on the first user gesture (browser autoplay rules).
const CHORDS = [   // A minor – F – C – G, voiced low for the pad
  [57, 60, 64, 69], [53, 57, 60, 65], [48, 55, 60, 64], [55, 59, 62, 67],
];
const ARP = [0, 2, 3, 1, 2, 3, 1, 2];
// Radio stations: Neo Synth (default), Lo-fi Datos (slower, softer) and off (only the city sounds).
const LOFI = [[50, 57, 62, 65], [55, 59, 62, 66], [52, 55, 59, 64], [57, 60, 64, 67]];
export const STATIONS = [
  { id: 'neo', bpm: 92, chords: CHORDS, pad: 'sawtooth', lead: 'triangle', bass: 0.12 },
  { id: 'lofi', bpm: 72, chords: LOFI, pad: 'triangle', lead: 'sine', bass: 0.09 },
  { id: 'off' },
];
const midi = (n) => 440 * 2 ** ((n - 69) / 12);

export class Audio {
  constructor() { this.ctx = null; this.music = 0.55; this.sfx = 0.8; this.muted = false; this.station = 0; }

  nextStation() { this.station = (this.station + 1) % STATIONS.length; return STATIONS[this.station].id; }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4;
    this.master = ctx.createGain(); this.master.gain.value = 0.9;
    this.master.connect(comp).connect(ctx.destination);
    this.musicBus = ctx.createGain(); this.musicBus.connect(this.master);
    this.sfxBus = ctx.createGain(); this.sfxBus.connect(this.master);
    this.ambBus = ctx.createGain(); this.ambBus.connect(this.master);
    this.setVolumes(this.music, this.sfx);

    // a short stereo echo shared by the score
    const delay = ctx.createDelay(1); delay.delayTime.value = 0.49;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    const wet = ctx.createGain(); wet.gain.value = 0.35;
    delay.connect(fb).connect(delay); delay.connect(wet).connect(this.musicBus);
    this.echo = delay;

    this.noise = this.makeNoise();
    this.buildEngine(); this.buildBeds(); this.buildAmbient();
    this.step = 0; this.nextTime = ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 60);
  }

  setVolumes(music, sfx, master = this.masterLevel ?? 0.9, ambience = this.ambience ?? 0.8) {
    this.music = music; this.sfx = sfx; this.masterLevel = master; this.ambience = ambience;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(master, t, 0.1);
    this.ambBus.gain.setTargetAtTime(this.muted ? 0 : ambience, t, 0.2);
    this.musicBus.gain.setTargetAtTime(this.muted ? 0 : music * 0.5, t, 0.2);
    this.sfxBus.gain.setTargetAtTime(this.muted ? 0 : sfx, t, 0.1);
  }
  toggleMute() { this.muted = !this.muted; this.setVolumes(this.music, this.sfx); return this.muted; }
  suspend(on) { if (this.ctx) (on ? this.ctx.suspend() : this.ctx.resume()); }

  makeNoise() {
    const ctx = this.ctx, len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate), data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }
  noiseSource() { const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; s.start(); return s; }

  buildEngine() {
    const ctx = this.ctx;
    const a = ctx.createOscillator(); a.type = 'sawtooth';
    const b = ctx.createOscillator(); b.type = 'square';
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600; f.Q.value = 3;
    const g = ctx.createGain(); g.gain.value = 0;
    const bg = ctx.createGain(); bg.gain.value = 0.5;
    a.connect(f); b.connect(bg).connect(f); f.connect(g).connect(this.sfxBus);
    a.start(); b.start();
    this.eng = { a, b, f, g };
    // tyres and wind
    const sk = this.noiseSource(), skf = ctx.createBiquadFilter(); skf.type = 'bandpass'; skf.frequency.value = 1400; skf.Q.value = 1.2;
    const skg = ctx.createGain(); skg.gain.value = 0; sk.connect(skf).connect(skg).connect(this.sfxBus);
    const wn = this.noiseSource(), wnf = ctx.createBiquadFilter(); wnf.type = 'lowpass'; wnf.frequency.value = 500;
    const wng = ctx.createGain(); wng.gain.value = 0; wn.connect(wnf).connect(wng).connect(this.sfxBus);
    this.skid = skg; this.wind = { g: wng, f: wnf };
  }

  buildBeds() {
    const ctx = this.ctx;
    const rn = this.noiseSource(), hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2200;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 9000;
    this.rainGain = ctx.createGain(); this.rainGain.gain.value = 0;
    rn.connect(hp).connect(lp).connect(this.rainGain).connect(this.ambBus);
    // city hum: a low drone that sits under everything
    const hum = ctx.createOscillator(); hum.type = 'sine'; hum.frequency.value = 55;
    const hg = ctx.createGain(); hg.gain.value = 0.035; hum.connect(hg).connect(this.musicBus); hum.start();
  }

  // looping noise beds for the surroundings; setAmbient() fades each one with the distance to its source
  buildAmbient() {
    const ctx = this.ctx;
    // noise → filter → level → optional slow tremolo (in series, so silence stays silent) → optional panner
    const bed = (type, freq, q, { pan = false, wobble = 0, depth = 0 } = {}) => {
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      let out = this.noiseSource().connect(f).connect(g);
      if (wobble) { const w = ctx.createGain(); w.gain.value = 1 - depth; lfo(wobble, depth, w.gain); out = out.connect(w); }
      const p = pan ? ctx.createStereoPanner() : null;
      (p ? out.connect(p) : out).connect(this.ambBus);
      return { f, g, p };
    };
    const lfo = (freq, depth, target) => { const o = ctx.createOscillator(), d = ctx.createGain(); o.frequency.value = freq; d.gain.value = depth; o.connect(d).connect(target); o.start(); return o; };
    this.amb = {
      traffic: bed('lowpass', 240, 0.7),
      crowd: bed('bandpass', 850, 0.6, { wobble: 0.35, depth: 0.4 }),   // murmur rises and falls
      waves: bed('lowpass', 520, 0.5, { pan: true, wobble: 0.11, depth: 0.7 }),   // swell
      gust: bed('bandpass', 420, 1.4),
      heli: bed('lowpass', 170, 0.8, { pan: true }),
    };
    lfo(0.07, 260, this.amb.gust.f.frequency);   // gusts sweep in pitch
    // rotor blades chop the air: a square wave added to the level, scaled with it
    const chop = ctx.createGain(); chop.gain.value = 0; chop.connect(this.amb.heli.g.gain);
    const blades = ctx.createOscillator(); blades.type = 'square'; blades.frequency.value = 17; blades.connect(chop); blades.start();
    this.amb.chop = chop;
  }

  // levels 0…1 and pans -1…1 for the beds of buildAmbient()
  setAmbient({ traffic = 0, crowd = 0, waves = 0, wavesPan = 0, gust = 0, heli = 0, heliPan = 0 }) {
    if (!this.amb) return;
    const t = this.ctx.currentTime, a = this.amb, set = (param, v, tc = 0.6) => param.setTargetAtTime(v, t, tc);
    set(a.traffic.g.gain, traffic * 0.09);
    set(a.crowd.g.gain, crowd * 0.04);
    set(a.waves.g.gain, waves * 0.05); set(a.waves.p.pan, wavesPan, 0.3);
    set(a.gust.g.gain, gust * 0.05, 1.2);
    set(a.heli.g.gain, heli * 0.07, 0.3); set(a.chop.gain, heli * 0.06, 0.3); set(a.heli.p.pan, heliPan, 0.2);
  }

  // a gull's cry: two or three falling squeals from one side
  gull(pan = 0) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, p = ctx.createStereoPanner(); p.pan.value = pan; p.connect(this.ambBus);
    const base = 1250 + Math.random() * 300;
    for (let k = 0; k < 2 + Math.floor(Math.random() * 2); k++) {
      const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + k * 0.32;
      o.type = 'triangle';
      o.frequency.setValueAtTime(base, t); o.frequency.exponentialRampToValueAtTime(base * 0.62, t + 0.26);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.02, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      o.connect(g).connect(p); o.start(t); o.stop(t + 0.3);
    }
  }

  // rain: 0 (dry) … 1.6 (storm)
  setRain(level) {
    if (!this.ctx || Math.abs(level - (this.rainLevel ?? -1)) < 0.02) return;
    this.rainLevel = level;
    this.rainGain.gain.setTargetAtTime(Math.min(level, 1.6) * 0.045, this.ctx.currentTime, 0.8);
  }
  setNight(n) { this.night = n; }

  // speed in m/s, throttle 0..1, slip 0..1, driving: whether the engine is running
  updateVehicle(driving, speed, throttle, slip, rpm = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, e = this.eng;
    // engine tone follows the real rpm of the gearbox (850 idle … 6800 redline)
    const n = Math.min(1, Math.max(0, (rpm - 850) / 5950));
    const base = 34 + n * 150;
    e.a.frequency.setTargetAtTime(base, t, 0.04); e.b.frequency.setTargetAtTime(base / 2, t, 0.04);
    e.f.frequency.setTargetAtTime(280 + n * 1500 + throttle * 700, t, 0.06);
    e.g.gain.setTargetAtTime(driving ? 0.045 + throttle * 0.065 + n * 0.02 : 0, t, 0.1);
    this.skid.gain.setTargetAtTime(driving ? Math.min(slip, 1) * 0.16 : 0, t, 0.05);
    const w = Math.min(speed / 50, 1);
    this.wind.g.gain.setTargetAtTime(w * w * 0.12, t, 0.2);
    this.wind.f.frequency.setTargetAtTime(300 + w * 1400, t, 0.2);
  }

  schedule() {
    const ctx = this.ctx, st = STATIONS[this.station], beat = 60 / (st.bpm || 92) / 2;   // eighth notes
    while (this.nextTime < ctx.currentTime + 0.3) {
      const s = this.step;
      if (st.chords) {
        const chord = st.chords[Math.floor(s / 32) % st.chords.length];
        if (s % 32 === 0) this.pad(chord, this.nextTime, beat * 32, st.pad);
        if (s % 2 === 0) this.pluck(midi(chord[0] - 24), this.nextTime, 0.22, 'sine', st.bass);
        if (st.id !== 'lofi' || s % 2 === 0) this.pluck(midi(chord[ARP[s % 8]] + 12), this.nextTime, st.id === 'lofi' ? 0.45 : 0.18, st.lead, s % 8 === 0 ? 0.05 : 0.03, true);
      }
      // ambience between notes: birds by day, crickets at night
      const n = this.night ?? 1;
      if (n < 0.4 && Math.random() < 0.05) this.chirp(this.nextTime);
      if (n > 0.7 && s % 4 === 2 && Math.random() < 0.6) this.cricket(this.nextTime);
      this.nextTime += beat; this.step++;
    }
  }
  pad(chord, at, dur, type = 'sawtooth') {
    const ctx = this.ctx, g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.setValueAtTime(500, at); f.frequency.linearRampToValueAtTime(1400, at + dur / 2); f.frequency.linearRampToValueAtTime(500, at + dur);
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(0.05, at + 2); g.gain.setValueAtTime(0.05, at + dur - 2); g.gain.linearRampToValueAtTime(0, at + dur + 0.5);
    f.connect(g).connect(this.musicBus);
    chord.forEach((n) => [-6, 6].forEach((cents) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = midi(n); o.detune.value = cents;
      o.connect(f); o.start(at); o.stop(at + dur + 0.6);
    }));
  }
  pluck(freq, at, len, type, vol, echo) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    o.connect(g).connect(this.musicBus); if (echo) g.connect(this.echo);
    o.start(at); o.stop(at + len + 0.05);
  }

  chirp(at) {
    const ctx = this.ctx, base = 2600 + Math.random() * 1600;
    for (let k = 0; k < 2 + Math.floor(Math.random() * 3); k++) {
      const o = ctx.createOscillator(), g = ctx.createGain(), t = at + k * 0.09;
      o.frequency.setValueAtTime(base, t); o.frequency.exponentialRampToValueAtTime(base * 1.5, t + 0.06);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.012, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      o.connect(g).connect(this.ambBus); o.start(t); o.stop(t + 0.08);
    }
  }
  cricket(at) {
    const ctx = this.ctx;
    for (let k = 0; k < 3; k++) {
      const o = ctx.createOscillator(), g = ctx.createGain(), t = at + k * 0.045;
      o.frequency.value = 4400; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.006, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
      o.connect(g).connect(this.ambBus); o.start(t); o.stop(t + 0.04);
    }
  }

  tone(freq, len, { type = 'sine', vol = 0.15, at = 0, slide = 0 } = {}) {
    const ctx = this.ctx, t = ctx.currentTime + at, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + len);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(this.sfxBus); o.start(t); o.stop(t + len + 0.05);
  }
  burst(len, freq, vol) {
    const ctx = this.ctx, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), t = ctx.currentTime;
    s.buffer = this.noise; f.type = 'lowpass'; f.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    s.connect(f).connect(g).connect(this.sfxBus); s.start(t, Math.random()); s.stop(t + len);
  }

  play(name, amount = 1) {
    if (!this.ctx || this.muted) return;
    switch (name) {
      case 'ui': this.tone(880, 0.08, { type: 'triangle', vol: 0.06 }); break;
      case 'talk': this.tone(660, 0.06, { type: 'square', vol: 0.025 }); break;
      case 'pickup': [0, 4, 7, 12].forEach((n, i) => this.tone(midi(76 + n), 0.25, { type: 'triangle', vol: 0.09, at: i * 0.06 })); break;
      case 'checkpoint': this.tone(midi(84), 0.18, { type: 'square', vol: 0.05 }); this.tone(midi(91), 0.3, { type: 'square', vol: 0.05, at: 0.09 }); break;
      case 'success': [0, 4, 7, 11, 14].forEach((n, i) => this.tone(midi(72 + n), 0.9, { type: 'sawtooth', vol: 0.05, at: i * 0.08 })); break;
      case 'fail': this.tone(220, 0.5, { type: 'sawtooth', vol: 0.07, slide: 0.5 }); break;
      case 'horn': this.tone(392, 0.35, { type: 'square', vol: 0.06 }); this.tone(494, 0.35, { type: 'square', vol: 0.05 }); break;
      case 'door': this.burst(0.18, 400, 0.25); break;
      case 'hit': this.burst(0.25 + amount * 0.2, 900, Math.min(0.15 + amount * 0.3, 0.6)); break;
      case 'step': this.burst(0.05, 1800, 0.05); break;
      case 'glitch': this.tone(120, 0.12, { type: 'square', vol: 0.05, slide: 3 }); break;
      case 'fireworks': this.burst(0.8, 2500, 0.25); break;
      case 'shift': this.burst(0.07, 600, 0.06); break;
      case 'scrape': this.burst(0.4, 3200, 0.12 * amount); break;
      case 'thunder': {
        const ctx = this.ctx, t = ctx.currentTime, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        src.buffer = this.noise; src.loop = true; f.type = 'lowpass'; f.frequency.setValueAtTime(400 * (0.5 + amount), t); f.frequency.exponentialRampToValueAtTime(90, t + 3);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25 + amount * 0.45, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.8);
        src.connect(f).connect(g).connect(this.master); src.start(t, Math.random()); src.stop(t + 4);
        break;
      }
      default: break;
    }
  }
}
