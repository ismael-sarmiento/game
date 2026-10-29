// Conversations with mentors: typed-out lines, choice buttons and, when the isa-game Worker is configured, free
// questions answered by AI. Network text is only ever written with textContent.
import { CONFIG } from '../config.js';
import { getLang } from '../core/i18n.js';

const $ = (id) => document.getElementById(id);
const MAX_HISTORY = 6;

export class Dialogue {
  constructor(game) {
    this.game = game;
    this.open = false;
    this.mentor = null;
    this.history = [];
    this.typing = null;
    $('dialog-form').addEventListener('submit', (e) => { e.preventDefault(); this.ask(); });
    $('dialog').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); } });
  }

  // lines: array of strings shown in sequence; choices: [{ label, primary, onPick }]
  show(mentor, lines, choices = []) {
    const g = this.game;
    this.mentor = mentor; this.open = true;
    g.input.enabled = false;
    const name = mentor.id[0].toUpperCase() + mentor.id.slice(1);
    $('dialog-name').textContent = name;
    $('dialog-role').textContent = g.t(`mentors.${mentor.id}.role`);
    $('dialog-avatar').style.color = mentor.color;
    $('dialog').hidden = false;
    $('dialog-form').hidden = true;
    const queue = Array.isArray(lines) ? [...lines] : [lines];
    const next = () => {
      const line = queue.shift();
      this.type(line, () => {
        if (queue.length) this.renderChoices([{ label: g.t('dialog.next'), primary: true, onPick: next }]);
        else this.renderChoices(choices.length ? choices : [{ label: g.t('dialog.bye'), onPick: () => this.close() }]);
      });
    };
    next();
  }

  type(text, done) {
    const el = $('dialog-text');
    clearInterval(this.typing);
    el.textContent = '';
    $('dialog-choices').replaceChildren();
    let i = 0;
    const chars = [...text];
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { el.textContent = text; done(); return; }
    this.skip = () => { clearInterval(this.typing); el.textContent = text; this.skip = null; done(); };
    this.typing = setInterval(() => {
      el.textContent += chars.slice(i, i + 2).join('');
      i += 2;
      if (i % 6 === 0) this.game.audio.play('talk');
      if (i >= chars.length) { clearInterval(this.typing); this.skip = null; done(); }
    }, 22);
    el.onclick = () => this.skip && this.skip();
  }

  renderChoices(choices) {
    const box = $('dialog-choices');
    box.replaceChildren(...choices.map((c) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = `choice${c.primary ? ' primary' : ''}`;
      b.textContent = c.label;
      b.addEventListener('click', () => { this.game.audio.play('ui'); c.onPick(); });
      return b;
    }));
    box.firstChild?.focus({ preventScroll: true });
  }

  // free questions: only offered when the AI Worker is configured
  get aiAvailable() { return Boolean(CONFIG.AI_ENDPOINT); }

  openQuestion() {
    const form = $('dialog-form');
    form.hidden = false;
    $('dialog-choices').replaceChildren();
    const input = $('dialog-input');
    input.value = '';
    input.focus();
    const back = document.createElement('button');
    back.type = 'button'; back.className = 'choice'; back.textContent = this.game.t('dialog.back');
    back.addEventListener('click', () => this.game.missions.talk(this.mentor));
    $('dialog-choices').append(back);
  }

  async ask() {
    const input = $('dialog-input');
    const message = input.value.trim().slice(0, 200);
    if (!message || !this.mentor) return;
    input.value = '';
    const g = this.game, el = $('dialog-text');
    el.textContent = g.t('dialog.thinking');
    $('dialog-form').hidden = true;
    let reply;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(CONFIG.AI_ENDPOINT, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ npc: this.mentor.id, lang: getLang(), message, history: this.history.slice(-MAX_HISTORY) }),
      });
      clearTimeout(timer);
      const data = res.ok ? await res.json() : null;
      reply = data && typeof data.reply === 'string' ? data.reply.slice(0, 700) : null;
      if (res.status === 429) reply = g.t('dialog.busy');
    } catch { reply = null; }
    if (!reply) reply = g.t('dialog.offline');
    else this.history.push({ role: 'user', content: message }, { role: 'assistant', content: reply });
    this.type(reply, () => this.openQuestion());
  }

  close() {
    clearInterval(this.typing);
    this.open = false;
    this.mentor = null;
    $('dialog').hidden = true;
    $('dialog-form').hidden = true;
    this.game.input.enabled = true;
    this.game.ctx.renderer.domElement.focus();
  }
}
