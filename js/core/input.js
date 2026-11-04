// One input state for keyboard + mouse, gamepad and touch. Systems read axes every frame and
// consume one-shot actions with input.take('use').
const KEYMAP = {
  KeyE: 'use', Enter: 'use', KeyH: 'horn', KeyR: 'reset', KeyC: 'camera',
  Escape: 'pause', KeyP: 'pause', KeyM: 'map', KeyN: 'mute', KeyQ: 'radio', KeyO: 'photo',
};
const GAMEPAD_BUTTONS = { 3: 'use', 1: 'horn', 8: 'reset', 9: 'pause', 5: 'camera' };

export class Input {
  constructor(canvas, joyEl, touchButtons) {
    this.keys = new Set();
    this.queue = new Set();
    this.axis = { x: 0, y: 0 };          // x: right, y: forward
    this.throttle = 0; this.brake = 0;   // 0..1 (analog on gamepads)
    this.look = { x: 0, y: 0 };          // accumulated camera delta, consumed each frame
    this.zoom = 0;
    this.jump = false; this.sprint = false;
    this.enabled = true;
    this.lastDevice = 'keyboard';
    this.sensitivity = 1;
    this.joy = { id: null, x: 0, y: 0 };
    this.touchHeld = new Set();
    this.dragId = null; this.dragLast = null;
    this.prevPad = [];
    this.padEdges = [];     // gamepad buttons pressed this frame (12-15 = d-pad, the left stick counts too, with repeat)
    this.navDir = -1; this.navTimer = 0;
    this.blockA = false;    // after a menu closes, A must be released before it jumps again

    addEventListener('keydown', (e) => this.onKey(e, true));
    addEventListener('keyup', (e) => this.onKey(e, false));
    addEventListener('blur', () => { this.keys.clear(); this.touchHeld.clear(); });

    canvas.addEventListener('pointerdown', (e) => this.onDragStart(e));
    addEventListener('pointermove', (e) => this.onDragMove(e));
    addEventListener('pointerup', (e) => this.onDragEnd(e));
    addEventListener('pointercancel', (e) => this.onDragEnd(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom += Math.sign(e.deltaY); }, { passive: false });

    if (joyEl) this.bindJoystick(joyEl);
    touchButtons.forEach((btn) => this.bindTouchButton(btn));
  }

  onKey(e, down) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    this.lastDevice = 'keyboard';
    if (down) {
      if (!e.repeat && KEYMAP[e.code]) this.queue.add(KEYMAP[e.code]);
      this.keys.add(e.code);
    } else {
      this.keys.delete(e.code);
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  }

  onDragStart(e) {
    if (this.dragId !== null) return;
    if (e.pointerType === 'touch' && e.clientX < innerWidth * 0.4 && !document.body.classList.contains('photo-mode')) return;   // left side belongs to the joystick (hidden in photo mode)
    this.dragId = e.pointerId; this.dragLast = { x: e.clientX, y: e.clientY };
    if (e.pointerType !== 'touch') this.lastDevice = 'keyboard';
  }
  onDragMove(e) {
    if (e.pointerId !== this.dragId) return;
    const scale = (e.pointerType === 'touch' ? 0.006 : 0.004) * this.sensitivity;
    this.look.x += (e.clientX - this.dragLast.x) * scale;
    this.look.y += (e.clientY - this.dragLast.y) * scale;
    this.dragLast = { x: e.clientX, y: e.clientY };
  }
  onDragEnd(e) { if (e.pointerId === this.dragId) this.dragId = null; }

  bindJoystick(el) {
    const knob = el.querySelector('.joy-knob');
    const move = (e) => {
      const r = el.getBoundingClientRect();
      const radius = r.width / 2;
      let dx = (e.clientX - (r.left + radius)) / radius, dy = (e.clientY - (r.top + radius)) / radius;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      this.joy.x = dx; this.joy.y = -dy;
      knob.style.transform = `translate(${dx * radius * 0.6}px, ${dy * radius * 0.6}px)`;
    };
    el.addEventListener('pointerdown', (e) => {
      this.joy.id = e.pointerId; this.lastDevice = 'touch';
      try { el.setPointerCapture(e.pointerId); } catch { /* the finger keeps working without capture */ }
      move(e);
    });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === this.joy.id) move(e); });
    const end = (e) => { if (e.pointerId !== this.joy.id) return; this.joy = { id: null, x: 0, y: 0 }; knob.style.transform = ''; };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }

  bindTouchButton(btn) {
    const act = btn.dataset.act;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault(); this.lastDevice = 'touch'; btn.classList.add('active');
      if (act === 'jump') this.touchHeld.add('jump'); else this.queue.add(act);
    });
    const end = () => { btn.classList.remove('active'); this.touchHeld.delete(act); };
    btn.addEventListener('pointerup', end); btn.addEventListener('pointercancel', end); btn.addEventListener('pointerleave', end);
  }

  // A menu or card just closed: forget actions queued while it was open (Enter on «Continuar» used to get you in the car).
  flush() { this.queue.clear(); this.blockA = true; }

  take(action) {
    const had = this.queue.has(action);
    this.queue.delete(action);
    return had && this.enabled || (had && action === 'pause');
  }

  // Called once per frame before the systems read the state.
  update(dt) {
    const k = this.keys;
    let x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let throttle = Math.max(y, 0), brake = Math.max(-y, 0);
    let jump = k.has('Space') || this.touchHeld.has('jump');
    let sprint = k.has('ShiftLeft') || k.has('ShiftRight');

    if (this.joy.id !== null) {
      x = this.joy.x; y = this.joy.y;
      throttle = Math.max(y, 0); brake = Math.max(-y, 0);
      sprint = Math.hypot(x, y) > 0.92;
    }

    this.padEdges = [];
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad || pad.mapping !== 'standard') continue;
      const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
      const lx = dz(pad.axes[0]), ly = dz(pad.axes[1]), rx = dz(pad.axes[2]), ry = dz(pad.axes[3]);
      const rt = pad.buttons[7]?.value || 0, lt = pad.buttons[6]?.value || 0;
      if (lx || ly || rt || lt || rx || ry) this.lastDevice = 'gamepad';
      if (lx || ly) { x = lx; y = -ly; throttle = Math.max(y, 0); brake = Math.max(-y, 0); }
      if (rt > 0.05) throttle = Math.max(throttle, rt);
      if (lt > 0.05) brake = Math.max(brake, lt);
      this.look.x += rx * dt * 2.6 * this.sensitivity;
      this.look.y += ry * dt * 1.8 * this.sensitivity;
      if (!pad.buttons[0]?.pressed) this.blockA = false;
      jump = jump || (pad.buttons[0]?.pressed && !this.blockA);
      sprint = sprint || pad.buttons[10]?.pressed;
      pad.buttons.forEach((b, i) => {
        const was = this.prevPad[i];
        if (b.pressed && !was && GAMEPAD_BUTTONS[i]) { this.queue.add(GAMEPAD_BUTTONS[i]); this.lastDevice = 'gamepad'; }
        if (b.pressed && !was && (i < 12 || i > 15)) this.padEdges.push(i);
        this.prevPad[i] = b.pressed;
      });
      // menu navigation: d-pad or left stick as directions, repeating while held
      const sx = pad.axes[0] || 0, sy = pad.axes[1] || 0;
      let dir = [12, 13, 14, 15].find((i) => pad.buttons[i]?.pressed) ?? -1;
      if (dir < 0 && Math.max(Math.abs(sx), Math.abs(sy)) > 0.5) dir = Math.abs(sy) >= Math.abs(sx) ? (sy < 0 ? 12 : 13) : (sx < 0 ? 14 : 15);
      if (dir !== this.navDir) { this.navDir = dir; this.navTimer = 0.35; if (dir >= 0) this.padEdges.push(dir); }
      else if (dir >= 0 && (this.navTimer -= dt) <= 0) { this.navTimer = 0.12; this.padEdges.push(dir); }
      break;
    }

    const on = this.enabled;
    this.axis.x = on ? x : 0; this.axis.y = on ? y : 0;
    this.throttle = on ? throttle : 0; this.brake = on ? brake : 0;
    this.jump = on && jump; this.sprint = on && sprint;
  }

  consumeLook() {
    const l = { x: this.look.x, y: this.look.y, zoom: this.zoom };
    this.look.x = 0; this.look.y = 0; this.zoom = 0;
    return this.enabled ? l : { x: 0, y: 0, zoom: 0 };
  }
}
