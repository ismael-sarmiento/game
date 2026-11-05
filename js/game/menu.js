// Pause menu (game summary, settings, graphics, accessibility, controls) and modal cards (facts, quizzes, mission results).
import { DEFAULTS } from '../core/save.js';
import { rememberLang } from '../core/i18n.js';

const $ = (id) => document.getElementById(id);
const pct = (v) => `${Math.round(v * 100)} %`;
// «Restablecer valores» in the Settings tab: everything there except the language and the character
const RESETTABLE = ['sens', 'fps', 'master', 'music', 'ambience', 'sfx', 'time', 'weather', 'cycle'];

export class Menu {
  constructor(game, { onQuality, onLang }) {
    this.game = game;
    this.cardOpen = false;
    this.bound = [];          // { el, key, prop, apply } for every settings control
    this.outputs = [];        // value read-outs next to the sliders
    const s = game.save.data.settings;
    const read = (el, prop) => (prop === 'checked' ? el.checked : (el.type === 'range' ? Number(el.value) : el.value));
    const bind = (id, key, apply, { prop = 'value', show } = {}) => {
      const el = $(id);
      el[prop] = s[key];
      if (show) this.outputs.push(show);
      el.addEventListener('change', () => { s[key] = read(el, prop); game.save.write(); apply(s[key]); show?.(); });
      if (el.type === 'range') el.addEventListener('input', () => { s[key] = Number(el.value); apply(s[key]); show?.(); });
      this.bound.push({ el, key, prop, apply });
    };
    bind('set-quality', 'quality', (v) => { game.setAutoQuality(v === 'auto'); if (v !== 'auto') onQuality(v); });
    bind('set-character', 'character', (v) => game.avatar.setVariant(v));
    bind('set-lang', 'lang', (v) => { $('boot-lang').value = v; rememberLang(v); onLang(v); });
    const vol = () => game.audio.setVolumes(s.music, s.sfx, s.master, s.ambience);
    ['master', 'music', 'sfx', 'ambience'].forEach((k) => bind(`set-${k}`, k, vol, { show: () => { $(`${k}-value`).textContent = pct(s[k]); } }));
    // accessibility and camera
    const applyAccess = () => {
      document.documentElement.style.fontSize = `${s.textSize * 100}%`;
      document.body.classList.toggle('high-contrast', s.contrast);
      $('fov-value').textContent = `${s.fov}°`; $('text-value').textContent = pct(s.textSize);
      Object.assign(game.chase.options, { fov: s.fov, invertY: s.invertY, autoCam: s.autoCam, reduceMotion: s.reduceMotion });
      game.input.vibration = s.vibration;
    };
    ['fov', 'textSize'].forEach((k) => bind(`set-${k}`, k, applyAccess));
    ['invertY', 'autoCam', 'reduceMotion', 'vibration', 'contrast'].forEach((k) => bind(`set-${k}`, k, applyAccess, { prop: 'checked' }));
    bind('set-units', 'units', applyAccess);
    applyAccess();
    bind('set-sens', 'sens', (v) => { game.input.sensitivity = v; }, {
      show: () => { $('sens-value').textContent = `${s.sens.toLocaleString(document.documentElement.lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}×`; },
    });
    bind('set-time', 'time', (v) => { game.clock.set(v, s.cycle); $('set-cycle').disabled = v !== 'auto'; });
    bind('set-cycle', 'cycle', (v) => { game.clock.set(s.time, v); }, { show: () => { $('cycle-value').textContent = game.t('settings.minutes', { n: s.cycle }); } });
    bind('set-weather', 'weather', (v) => game.weather.set(v));
    $('set-cycle').disabled = s.time !== 'auto';
    bind('set-fps', 'fps', (v) => { $('fps').hidden = !v; }, { prop: 'checked' });
    $('fps').hidden = !s.fps && !new URLSearchParams(location.search).has('debug');

    // graphics: every change rebuilds the post-processing chain
    const gfx = s.gfx;
    const showScale = () => { $('scale-value').textContent = pct(gfx.scale); };
    ['scale', 'reflections', 'occlusion', 'aa', 'motionBlur', 'grain'].forEach((key) => {
      const el = $(`gfx-${key}`);
      const prop = el.type === 'checkbox' ? 'checked' : 'value';
      el[prop] = gfx[key];
      el.addEventListener('change', () => {
        gfx[key] = read(el, prop);
        game.save.write(); game.applyGraphics(); showScale();
      });
    });
    $('gfx-scale').addEventListener('input', showScale);
    this.outputs.push(showScale);
    $('set-lang').value = document.documentElement.lang;

    // title screen selectors share the same settings
    $('boot-lang').value = document.documentElement.lang;
    $('boot-lang').addEventListener('change', (e) => { s.lang = e.target.value; $('set-lang').value = s.lang; game.save.write(); rememberLang(s.lang); onLang(s.lang); });
    $('boot-character').value = s.character;
    $('boot-character').addEventListener('change', (e) => { s.character = e.target.value; $('set-character').value = s.character; game.save.write(); game.avatar.setVariant(s.character); });
    $('boot-quality').value = s.quality;
    $('boot-quality').addEventListener('change', (e) => { s.quality = e.target.value; $('set-quality').value = s.quality; game.save.write(); game.setAutoQuality(s.quality === 'auto'); if (s.quality !== 'auto') onQuality(s.quality); });

    // «Restablecer valores»: back to the defaults of the Settings tab, applied live
    let doneTimer = 0;
    $('reset-defaults').addEventListener('click', () => {
      const items = this.bound.filter((b) => RESETTABLE.includes(b.key));
      items.forEach((b) => { s[b.key] = DEFAULTS.settings[b.key]; b.el[b.prop] = s[b.key]; });
      game.save.write();
      items.forEach((b) => b.apply(s[b.key]));
      this.syncOutputs();
      $('reset-defaults-done').textContent = game.t('menu.resetDone');
      clearTimeout(doneTimer);
      doneTimer = setTimeout(() => { $('reset-defaults-done').textContent = ''; }, 4000);
    });

    // tabs: WAI-ARIA pattern (roving tabindex, arrows, Home/End, automatic activation)
    this.tabs = [...document.querySelectorAll('#pause [role="tab"]')];
    // on phones the tab strip scrolls sideways: fade the edge that hides more tabs
    const strip = document.querySelector('#pause .menu-tabs');
    this.edgeTabs = () => {
      const max = strip.scrollWidth - strip.clientWidth;
      strip.classList.toggle('more-left', strip.scrollLeft > 2);
      strip.classList.toggle('more-right', strip.scrollLeft < max - 2);
    };
    strip.addEventListener('scroll', this.edgeTabs, { passive: true });
    addEventListener('resize', this.edgeTabs);
    this.tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => this.tab(tab.dataset.tab));
      tab.addEventListener('keydown', (e) => {
        const n = this.tabs.length;
        const next = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
        if (next === undefined) return;
        e.preventDefault(); e.stopPropagation();
        this.tab(this.tabs[next].dataset.tab, true);
      });
    });

    // «Borrar progreso» asks inside the menu (no native confirm())
    $('reset-progress').addEventListener('click', () => {
      $('reset-progress').hidden = true; $('reset-confirm').hidden = false;
      $('reset-cancel').focus({ preventScroll: true });
      $('reset-confirm').scrollIntoView({ block: 'nearest' });
    });
    $('reset-cancel').addEventListener('click', () => this.cancelReset(true));
    $('reset-yes').addEventListener('click', () => { game.save.reset(); location.reload(); });

    $('resume').addEventListener('click', () => this.close());
    $('pause-btn').addEventListener('click', () => this.open());
    // Escape (B on a gamepad) dismisses a card with its last plain button: «Seguir jugando», «Más tarde»…
    // never a link or a retry; a question has none until it is answered
    $('card').addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      [...$('card-actions').querySelectorAll('button.btn')].pop()?.click();
    });
    $('pause').addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (!$('reset-confirm').hidden) this.cancelReset(true); else this.close();
    });
    this.refresh();
  }

  syncOutputs() { this.outputs.forEach((show) => show()); }

  refresh() {
    const t = this.game.t;
    const data = this.game.save.data;
    this.syncOutputs();
    const list = $('controls-list');
    list.replaceChildren();
    for (const [keys, label] of t('controls')) {
      const dt = document.createElement('dt'); dt.textContent = keys;
      const dd = document.createElement('dd'); dd.textContent = label;
      list.append(dt, dd);
    }
    // where the player is now
    $('menu-objective').textContent = this.game.hud?.objective?.text || '—';
    const district = $('district').textContent;
    $('menu-district').textContent = district;
    $('menu-district').hidden = !district;
    // progress
    const prog = $('progress-list');
    prog.replaceChildren();
    const row = (label, value) => { const li = document.createElement('li'); const a = document.createElement('span'); a.textContent = label; const b = document.createElement('b'); b.textContent = value; li.append(a, b); prog.append(li); };
    ['route', 'debug', 'train'].forEach((id) => row(t(`missions.${id}.title`), data.missions[id] === 'done' ? '✓' : '—'));
    row(t('menu.facts'), `${data.facts.length}/40`);
    row(t('menu.graduated'), data.graduated ? '✓' : '—');
    // achievements
    const ach = $('achievements-list');
    ach.replaceChildren();
    const all = window.__ACH || [];
    const got = data.achievements || [];
    $('ach-count').textContent = `${all.filter((id) => got.includes(id)).length}/${all.length}`;
    all.forEach((id) => {
      const done = got.includes(id);
      const li = document.createElement('li'); li.className = done ? 'done' : 'locked';
      const text = document.createElement('span');
      const title = document.createElement('strong'); title.textContent = t(`achievements.list.${id}.title`);
      const desc = document.createElement('small'); desc.textContent = t(`achievements.list.${id}.text`);
      text.append(title, desc);
      const b = document.createElement('b'); b.textContent = done ? '✓' : '—';
      li.append(text, b); ach.append(li);
    });
  }

  tab(name, focus = false) {
    for (const tab of this.tabs) {
      const on = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      if (on) { if (focus) tab.focus(); tab.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    }
    document.querySelectorAll('#pause [role="tabpanel"]').forEach((p) => { p.hidden = p.dataset.panel !== name; });
    $('menu-body').scrollTop = 0;
    this.edgeTabs();
  }

  cancelReset(focus = false) {
    $('reset-confirm').hidden = true; $('reset-progress').hidden = false;
    if (focus) $('reset-progress').focus({ preventScroll: true });
  }

  toggle() { if ($('pause').hidden) this.open(); else this.close(); }
  open() {
    const g = this.game;
    if (!g.started || this.cardOpen || !$('bigmap').hidden) return;   // never on top of the full map (it would resume under it)
    this.refresh();
    this.cancelReset();
    $('pause').hidden = false;
    this.tab('game');
    g.paused = true; g.input.enabled = false;
    g.audio.suspend(true);
    $('resume').focus({ preventScroll: true });
  }
  close() {
    const g = this.game;
    $('pause').hidden = true;
    g.paused = false; g.input.enabled = !g.dialogue.open;
    g.input.flush();
    g.audio.suspend(false);
    g.ctx.renderer.domElement.focus();
  }

  // one action of a card: a button, an answer choice or a link (links open a new tab and say so)
  cardAction(a, feedback) {
    const g = this.game;
    const btn = a.href ? document.createElement('a') : document.createElement('button');
    if (a.href) { btn.href = a.href; btn.target = '_blank'; btn.rel = 'noopener'; } else btn.type = 'button';
    btn.className = a.choice ? 'choice' : `btn ${a.primary ? 'btn-primary' : 'btn-ghost'}`;
    btn.textContent = a.label;
    if (a.href) {
      const arrow = document.createElement('span'); arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '↗';
      const note = document.createElement('span'); note.className = 'sr-only'; note.textContent = g.t('menu.newTab');
      btn.append(arrow, note);
    }
    btn.addEventListener('click', () => {
      g.audio.play('ui');
      const result = a.onPick ? a.onPick({ feedback, button: btn }) : undefined;
      if (!a.keepOpen && result !== false && !a.href) this.closeCard();
    });
    return btn;
  }

  // adds an action to the card already open (a quiz shows «Seguir jugando» once it is solved)
  addCardAction(a) {
    const btn = this.cardAction(a, this.cardFeedback);
    $('card-actions').append(btn);
    btn.focus({ preventScroll: true });
    return btn;
  }

  // { eyebrow, title, paragraphs: [text], code, note, badge, kind, actions: [{ label, primary, choice, href, onPick, keepOpen }], pause }
  card({ eyebrow = '', title = '', paragraphs = [], code = '', note = '', badge = '', kind = '', actions = [], pause = true }) {
    const g = this.game;
    this.cardOpen = true;
    $('card-eyebrow').textContent = eyebrow;
    $('card-title').textContent = title;
    const body = $('card-body'); body.replaceChildren();
    if (badge) { const b = document.createElement('span'); b.className = 'badge'; b.textContent = badge; body.append(b); }
    paragraphs.forEach((text, i) => { const p = document.createElement('p'); p.textContent = text; if (i === 0) p.className = 'strong'; body.append(p); });
    if (code) { const pre = document.createElement('pre'); pre.textContent = code; body.append(pre); }
    if (note) { const p = document.createElement('p'); p.className = 'aside'; p.textContent = note; body.append(p); }
    const feedback = document.createElement('p'); feedback.className = 'feedback'; feedback.setAttribute('aria-live', 'polite');
    if (actions.some((a) => a.choice)) body.append(feedback);   // only questions answer back
    this.cardFeedback = feedback;
    const box = $('card-actions'); box.replaceChildren();
    actions.forEach((a) => box.append(this.cardAction(a, feedback)));
    $('card').querySelector('.card').className = `card glass ${kind}`;
    $('card').hidden = false;
    $('prompt').hidden = true; $('waypoint').hidden = true; g.hud.promptKey = '';
    if (pause) { g.paused = true; g.input.enabled = false; }
    box.firstChild?.focus({ preventScroll: true });
  }
  closeCard() {
    const g = this.game;
    $('card').hidden = true;
    this.cardOpen = false;
    g.paused = false; g.input.enabled = !g.dialogue.open;
    g.input.flush();
    g.ctx.renderer.domElement.focus();
  }
}
