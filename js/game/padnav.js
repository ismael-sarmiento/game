// Layer navigation: Tab stays in modal layers; gamepad navigation also works in the title screen, mentor dialogue and photo bar. The d-pad or left stick moves the
// focus, A presses, B goes back (same as Escape) and LB/RB switch the pause-menu tabs. Buttons follow the standard
// mapping: 0 A, 1 B, 4 LB, 5 RB, 12-15 up/down/left/right.
const LAYERS = ['boot', 'pause', 'card', 'bigmap', 'dialog', 'photo'];
const FOCUSABLE = 'button, a[href], select, input, summary, [tabindex="0"]';

const openLayer = () => LAYERS.map((id) => document.getElementById(id)).find((el) => el && !el.hidden) || null;
const focusables = (root) => [...root.querySelectorAll(FOCUSABLE)]
  .filter((el) => !el.disabled && el.tabIndex >= 0 && !el.closest('[inert]') && el.getClientRects().length > 0);
const key = (el, name) => el.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));

// the ring follows a class, not :focus, so it also shows when the page itself is not the focused window
function mark(el) {
  document.querySelectorAll('.pad-focus').forEach((x) => { if (x !== el) x.classList.remove('pad-focus'); });
  el?.classList.add('pad-focus');
  document.body.classList.add('pad-nav');
}

function focus(el) {
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function move(root, step) {
  const list = focusables(root);
  if (!list.length) return;
  const i = list.indexOf(document.activeElement);
  focus(i < 0 ? list[0] : list[(i + step + list.length) % list.length]);
}

// left/right change the value of sliders and drop-downs, switch tabs, and move the focus anywhere else
function adjust(root, el, dir) {
  if (el instanceof HTMLInputElement && el.type === 'range') {
    if (dir > 0) el.stepUp(); else el.stepDown();
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (el instanceof HTMLSelectElement) {
    const next = Math.min(Math.max(el.selectedIndex + dir, 0), el.options.length - 1);
    if (next !== el.selectedIndex) { el.selectedIndex = next; el.dispatchEvent(new Event('change', { bubbles: true })); }
  } else if (el.getAttribute('role') === 'tab') {
    key(el, dir > 0 ? 'ArrowRight' : 'ArrowLeft');
  } else {
    move(root, dir);
  }
}

export function padNav(edges) {
  const root = openLayer();
  if (!root) return;
  for (const b of edges) {
    const active = root.contains(document.activeElement) ? document.activeElement : null;
    if (b === 12 || b === 13) move(root, b === 12 ? -1 : 1);
    else if (b === 14 || b === 15) { if (active) adjust(root, active, b === 15 ? 1 : -1); else move(root, 1); }
    else if (b === 0) {
      if (!active) { move(root, 1); continue; }
      if (active instanceof HTMLSelectElement) adjust(root, active, active.selectedIndex === active.options.length - 1 ? -active.selectedIndex : 1);
      else active.click();
    } else if (b === 1) key(active || root, 'Escape');
    else if (b === 4 || b === 5) {
      const tab = root.querySelector('[role="tab"][aria-selected="true"]');
      if (tab) key(tab, b === 5 ? 'ArrowRight' : 'ArrowLeft');
    }
  }
  const now = openLayer();
  if (now && now.contains(document.activeElement)) mark(document.activeElement);
}

// the ring only shows while the gamepad drives the focus
const off = (e) => {
  if (!e.isTrusted) return;
  document.body.classList.remove('pad-nav');
  document.querySelectorAll('.pad-focus').forEach((x) => x.classList.remove('pad-focus'));
};
addEventListener('pointerdown', off, true);
addEventListener('keydown', off, true);

// A modal must not let Tab fall through to the canvas/HUD: Escape would then miss its own handler.
// Boot, photo and the non-modal mentor panel retain their ordinary page navigation.
addEventListener('keydown', (event) => {
  if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
  const root = openLayer();
  if (!root?.matches('[aria-modal="true"]') || root.closest('[inert]')) return;
  const list = focusables(root);
  if (!list.length) return;
  const index = list.indexOf(document.activeElement);
  if (index < 0 || (event.shiftKey ? index === 0 : index === list.length - 1)) {
    event.preventDefault();
    focus(event.shiftKey ? list.at(-1) : list[0]);
  }
}, true);
