// Pause menu (settings, controls, progress) and modal cards (facts, quizzes, mission results).
const $ = (id) => document.getElementById(id);

export class Menu {
  constructor(game, { onQuality, onLang }) {
    this.game = game;
    this.cardOpen = false;
    const s = game.save.data.settings;
    const bind = (id, key, apply, prop = 'value') => {
      const el = $(id);
      el[prop] = s[key];
      el.addEventListener('change', () => { s[key] = prop === 'checked' ? el.checked : (el.type === 'range' ? Number(el.value) : el.value); game.save.write(); apply(s[key]); });
      if (el.type === 'range') el.addEventListener('input', () => { s[key] = Number(el.value); apply(s[key]); });
    };
    bind('set-quality', 'quality', (v) => { game.setAutoQuality(v === 'auto'); if (v !== 'auto') onQuality(v); });
    bind('set-character', 'character', (v) => game.avatar.setVariant(v));
    bind('set-lang', 'lang', (v) => { $('boot-lang').value = v; onLang(v); });
    bind('set-music', 'music', () => game.audio.setVolumes(s.music, s.sfx));
    bind('set-sfx', 'sfx', () => game.audio.setVolumes(s.music, s.sfx));
    bind('set-sens', 'sens', (v) => { game.input.sensitivity = v; });
    bind('set-time', 'time', (v) => { game.clock.set(v, s.cycle); $('set-cycle').disabled = v !== 'auto'; });
    bind('set-cycle', 'cycle', (v) => { game.clock.set(s.time, v); $('cycle-value').textContent = game.t('settings.minutes', { n: v }); });
    bind('set-weather', 'weather', (v) => game.weather.set(v));
    $('set-cycle').disabled = s.time !== 'auto';
    $('cycle-value').textContent = game.t('settings.minutes', { n: s.cycle });
    bind('set-fps', 'fps', (v) => { $('fps').hidden = !v; }, 'checked');
    $('fps').hidden = !s.fps && !new URLSearchParams(location.search).has('debug');

    // graphics: every change rebuilds the post-processing chain
    const gfx = s.gfx;
    const showScale = () => { $('scale-value').textContent = `${Math.round(gfx.scale * 100)} %`; };
    ['scale', 'reflections', 'occlusion', 'aa', 'motionBlur', 'grain'].forEach((key) => {
      const el = $(`gfx-${key}`);
      const prop = el.type === 'checkbox' ? 'checked' : 'value';
      el[prop] = gfx[key];
      el.addEventListener('change', () => {
        gfx[key] = prop === 'checked' ? el.checked : (el.type === 'range' ? Number(el.value) : el.value);
        game.save.write(); game.applyGraphics(); showScale();
      });
    });
    $('gfx-scale').addEventListener('input', showScale);
    showScale();
    $('set-lang').value = document.documentElement.lang;

    // title screen selectors share the same settings
    $('boot-lang').value = document.documentElement.lang;
    $('boot-lang').addEventListener('change', (e) => { s.lang = e.target.value; $('set-lang').value = s.lang; game.save.write(); onLang(s.lang); });
    $('boot-quality').value = s.quality;
    $('boot-quality').addEventListener('change', (e) => { s.quality = e.target.value; $('set-quality').value = s.quality; game.save.write(); game.setAutoQuality(s.quality === 'auto'); if (s.quality !== 'auto') onQuality(s.quality); });

    document.querySelectorAll('#pause .tab').forEach((tab) => tab.addEventListener('click', () => this.tab(tab.dataset.tab)));
    $('resume').addEventListener('click', () => this.close());
    $('pause-btn').addEventListener('click', () => this.open());
    $('reset-progress').addEventListener('click', () => {
      if (!confirm(game.t('menu.resetConfirm'))) return;
      game.save.reset(); location.reload();
    });
    $('pause').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); } });
    this.refresh();
  }

  refresh() {
    const t = this.game.t;
    const list = $('controls-list');
    list.replaceChildren();
    for (const [keys, label] of t('controls')) {
      const dt = document.createElement('dt'); dt.textContent = keys;
      const dd = document.createElement('dd'); dd.textContent = label;
      list.append(dt, dd);
    }
    const prog = $('progress-list');
    prog.replaceChildren();
    const data = this.game.save.data;
    const row = (label, value) => { const li = document.createElement('li'); const a = document.createElement('span'); a.textContent = label; const b = document.createElement('b'); b.textContent = value; li.append(a, b); prog.append(li); };
    ['route', 'debug', 'train'].forEach((id) => row(t(`missions.${id}.title`), data.missions[id] === 'done' ? '✓' : '—'));
    row(t('menu.facts'), `${data.facts.length}/20`);
    row(t('menu.graduated'), data.graduated ? '✓' : '—');
  }

  tab(name) {
    document.querySelectorAll('#pause .tab').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.tab === name)));
    document.querySelectorAll('#pause .tab-panel').forEach((p) => { p.hidden = p.dataset.panel !== name; });
  }

  toggle() { if ($('pause').hidden) this.open(); else this.close(); }
  open() {
    const g = this.game;
    if (!g.started || this.cardOpen) return;
    this.refresh();
    $('pause').hidden = false;
    g.paused = true; g.input.enabled = false;
    g.audio.suspend(true);
    $('resume').focus();
  }
  close() {
    const g = this.game;
    $('pause').hidden = true;
    g.paused = false; g.input.enabled = !g.dialogue.open;
    g.audio.suspend(false);
    g.ctx.renderer.domElement.focus();
  }

  // { eyebrow, title, paragraphs: [text], code, badge, kind, actions: [{ label, primary, onPick, keepOpen }], pause }
  card({ eyebrow = '', title = '', paragraphs = [], code = '', badge = '', kind = '', actions = [], pause = true }) {
    const g = this.game;
    this.cardOpen = true;
    $('card-eyebrow').textContent = eyebrow;
    $('card-title').textContent = title;
    const body = $('card-body'); body.replaceChildren();
    if (badge) { const b = document.createElement('span'); b.className = 'badge'; b.textContent = badge; body.append(b); }
    paragraphs.forEach((text, i) => { const p = document.createElement('p'); p.textContent = text; if (i === 0) p.className = 'strong'; body.append(p); });
    if (code) { const pre = document.createElement('pre'); pre.textContent = code; body.append(pre); }
    const feedback = document.createElement('p'); feedback.className = 'feedback'; feedback.setAttribute('aria-live', 'polite'); body.append(feedback);
    const box = $('card-actions'); box.replaceChildren();
    actions.forEach((a) => {
      const btn = a.href ? document.createElement('a') : document.createElement('button');
      if (a.href) { btn.href = a.href; btn.target = '_blank'; btn.rel = 'noopener'; } else btn.type = 'button';
      btn.className = a.choice ? 'choice' : `btn ${a.primary ? 'btn-primary' : 'btn-ghost'}`;
      btn.textContent = a.label;
      btn.addEventListener('click', () => {
        g.audio.play('ui');
        const result = a.onPick ? a.onPick({ feedback, button: btn }) : undefined;
        if (!a.keepOpen && result !== false && !a.href) this.closeCard();
      });
      box.append(btn);
    });
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
    g.ctx.renderer.domElement.focus();
  }
}
