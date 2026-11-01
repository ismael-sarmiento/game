// Heads-up display: objective and timer, rotating minimap, speedometer, waypoint arrow, prompts and toasts.
import * as THREE from 'three/webgpu';
import { CITY, roadAt, blockAt, isCampus, districtAt } from '../world/layout.js';
import { MENTORS } from '../world/npcs.js';

const $ = (id) => document.getElementById(id);
const MAP_RANGE = 190;                 // metres from the centre to the edge of the minimap
const MAP_PX = 1024;
const toPx = (v) => ((v + CITY.HALF + 40) / (CITY.SIZE + 80)) * MAP_PX;

function drawCityMap() {
  const c = document.createElement('canvas'); c.width = c.height = MAP_PX;
  const g = c.getContext('2d');
  g.fillStyle = '#070b1d'; g.fillRect(0, 0, MAP_PX, MAP_PX);
  const k = MAP_PX / (CITY.SIZE + 80);
  for (let i = 0; i < CITY.N; i++) for (let j = 0; j < CITY.N; j++) {
    const x = blockAt(i), z = blockAt(j);
    const d = districtAt(x, z);
    g.fillStyle = isCampus(i, j) ? 'rgba(242,209,139,0.28)' : '#141a36';
    g.fillRect(toPx(x - CITY.BLOCK / 2), toPx(z - CITY.BLOCK / 2), CITY.BLOCK * k, CITY.BLOCK * k);
    g.strokeStyle = d.color + '55'; g.lineWidth = 2;
    g.strokeRect(toPx(x - CITY.BLOCK / 2) + 3, toPx(z - CITY.BLOCK / 2) + 3, CITY.BLOCK * k - 6, CITY.BLOCK * k - 6);
  }
  g.fillStyle = '#39406a';
  for (let i = 0; i <= CITY.N; i++) {
    const r = roadAt(i);
    g.fillRect(toPx(r - CITY.ROAD / 2), toPx(-CITY.HALF), CITY.ROAD * k, CITY.SIZE * k);
    g.fillRect(toPx(-CITY.HALF), toPx(r - CITY.ROAD / 2), CITY.SIZE * k, CITY.ROAD * k);
  }
  return c;
}

export class Hud {
  constructor(game) {
    this.game = game;
    this.map = drawCityMap();
    this.mini = $('minimap').getContext('2d');
    this.speedCtx = $('speed-canvas').getContext('2d');
    this.objective = { text: '', target: null, color: '#e2b25c' };
    this.timer = null;
    this.markers = [];             // extra minimap dots: { x, z, color, r }
    this.promptKey = '';
    this.lastDistrict = '';
    this.v = new THREE.Vector3();
    this.refreshTexts();
  }

  refreshTexts() {
    const { save, t } = this.game;
    $('facts-counter').textContent = `◆ ${save.data.facts.length}/40 ${t('hud.facts')}`;
    const done = Object.values(save.data.missions).filter((v) => v === 'done').length;
    $('missions-counter').textContent = `★ ${done}/3 ${t('hud.missions')}`;
    $('objective-text').textContent = this.objective.text;
    this.lastDistrict = '';
  }

  setObjective(text, target = null, color = '#e2b25c') {
    this.objective = { text, target, color };
    $('objective-text').textContent = text;
  }
  setTimer(seconds) {
    this.timer = seconds;
    const el = $('objective-timer');
    if (seconds == null) { el.hidden = true; return; }
    el.hidden = false;
    const s = Math.max(0, Math.ceil(seconds));
    el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    el.classList.toggle('urgent', s <= 15);
  }

  toast(text, kind = '') {
    const box = $('toasts');
    const el = document.createElement('p');
    el.className = `toast ${kind}`;
    el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => el.remove(), 4300);
  }

  prompt(key, label) {
    const el = $('prompt');
    const id = key ? `${key}|${label}` : '';
    if (id === this.promptKey) return;
    this.promptKey = id;
    if (!key) { el.hidden = true; return; }
    el.replaceChildren();
    const kbd = document.createElement('kbd');
    kbd.textContent = this.game.input.lastDevice === 'gamepad' ? 'Y' : 'E';
    el.append(kbd, document.createTextNode(label));
    el.hidden = false;
  }

  setFps(fps, info) {
    const el = $('fps');
    if (el.hidden) return;
    el.textContent = `${Math.round(fps)} fps · ${this.game.backend} · ${this.game.level}\n${info.render.drawCalls} draws · ${(info.render.triangles / 1000).toFixed(0)}k tris`;
  }

  update(dt) {
    const g = this.game, p = g.player;
    // district name under the minimap
    const d = districtAt(p.x, p.z).key;
    if (d !== this.lastDistrict) { this.lastDistrict = d; $('district').textContent = g.t(`districts.${d}`); g.achievements?.note('district', d); }

    // clock and weather
    const w = g.weather, icon = w.state === 'clear' && g.clock.night > 0.5 ? '☾' : w.icon;
    const clockText = `${icon} ${g.clock.label}`;
    if (clockText !== this.clockText) { this.clockText = clockText; $('clock').textContent = clockText; $('clock').title = g.t(`settings.${w.state === 'rain' ? 'rainy' : w.state}`); }

    // speedometer
    const speedo = $('speedo');
    speedo.hidden = g.mode !== 'car';
    if (g.mode === 'car') {
      const kmh = Math.round(Math.abs(g.car.speed) * 3.6);
      const mph = g.save.data.settings.units === 'mph';
      $('speed-value').textContent = mph ? Math.round(kmh * 0.621) : kmh;
      $('speed-value').nextElementSibling.textContent = mph ? 'mph' : 'km/h';
      const c = this.speedCtx, w = 180;
      c.clearRect(0, 0, w, w);
      c.lineWidth = 9; c.lineCap = 'round';
      c.strokeStyle = 'rgba(255,255,255,0.1)';
      c.beginPath(); c.arc(90, 90, 74, Math.PI * 0.75, Math.PI * 2.25); c.stroke();
      const f = Math.min(kmh / 200, 1);
      const grd = c.createLinearGradient(0, 180, 180, 0); grd.addColorStop(0, '#3fe0ff'); grd.addColorStop(1, '#e2b25c');
      c.strokeStyle = grd; c.shadowColor = '#3fe0ff'; c.shadowBlur = 14;
      c.beginPath(); c.arc(90, 90, 74, Math.PI * 0.75, Math.PI * (0.75 + 1.5 * f)); c.stroke();
      c.shadowBlur = 0;
      // inner arc: engine rpm (red near the redline) and the gear
      const n = Math.min(1, g.car.rpm / 6800);
      c.lineWidth = 4; c.strokeStyle = n > 0.88 ? '#ff5c7a' : 'rgba(255,255,255,0.55)';
      c.beginPath(); c.arc(90, 90, 62, Math.PI * 0.75, Math.PI * (0.75 + 1.5 * n)); c.stroke();
      c.fillStyle = '#e2b25c'; c.font = '700 18px "Space Grotesk", sans-serif'; c.textAlign = 'center';
      c.fillText(g.car.speed < -0.5 ? 'R' : String(g.car.gear), 90, 150);
    }

    this.drawMinimap();
    this.drawWaypoint();

    // context prompt
    this.parked = g.mode === 'car' && Math.abs(g.car.speed) < 2 ? (this.parked || 0) + dt : 0;
    $('prompt').classList.toggle('in-car', g.mode === 'car');
    if (g.dialogue.open || g.menu.cardOpen) this.prompt('');
    else {
      const m = g.mentors.nearest(p);
      if (m && g.mode === 'foot') this.prompt('talk', g.t('hud.talk', { name: g.t(`mentors.${m.id}.name`) }));
      else if (g.mode === 'foot' && p.distanceTo(g.car.position) < 4.2) this.prompt('car', g.t('hud.enter'));
      else if (g.mode === 'car' && this.parked > 1) this.prompt('exit', g.t('hud.exit'));   // after a second at rest
      else this.prompt('');
    }
  }

  drawMinimap() {
    const g = this.game, c = this.mini, W = 220, R = W / 2, p = g.player;
    const k = MAP_PX / (CITY.SIZE + 80), scale = R / (MAP_RANGE * k);
    const yaw = g.chase.yaw;
    c.save();
    c.clearRect(0, 0, W, W);
    c.beginPath(); c.arc(R, R, R, 0, Math.PI * 2); c.clip();
    c.translate(R, R); c.rotate(yaw + Math.PI); c.scale(scale, scale);
    c.drawImage(this.map, -toPx(p.x), -toPx(p.z));
    const dot = (x, z, color, r, ring) => {
      c.fillStyle = color; c.beginPath(); c.arc(toPx(x) - toPx(p.x), toPx(z) - toPx(p.z), r / scale, 0, Math.PI * 2); c.fill();
      if (ring) { c.strokeStyle = color; c.lineWidth = 2 / scale; c.beginPath(); c.arc(toPx(x) - toPx(p.x), toPx(z) - toPx(p.z), (r + 4 + Math.sin(g.time * 5) * 2) / scale, 0, Math.PI * 2); c.stroke(); }
    };
    this.markers.forEach((m) => dot(m.x, m.z, m.color, m.r || 3));
    g.mentors.list.forEach((m) => { if (m.state !== 'done' || m.id === 'iris') dot(m.x, m.z, m.color, 5, m.state === 'offer'); });
    if (g.mode === 'foot') dot(g.car.position.x, g.car.position.z, '#ffffff', 3.5);
    const o = this.objective.target;
    if (o) dot(o.x, o.z, this.objective.color, 6, true);
    c.restore();
    // edge pin for an objective outside the map
    if (o) {
      const dx = o.x - p.x, dz = o.z - p.z, dist = Math.hypot(dx, dz);
      if (dist > MAP_RANGE * 0.92) {
        const a = Math.atan2(dz, dx) + yaw + Math.PI;
        c.fillStyle = this.objective.color;
        c.beginPath(); c.arc(R + Math.cos(a) * (R - 9), R + Math.sin(a) * (R - 9), 6, 0, Math.PI * 2); c.fill();
      }
    }
    // the player arrow, always pointing up (the map turns with the camera)
    const heading = g.mode === 'car' ? g.car.heading : g.avatar.facing;
    c.save(); c.translate(R, R); c.rotate(-(heading - yaw));
    c.fillStyle = '#ffffff'; c.shadowColor = '#3fe0ff'; c.shadowBlur = 8;
    c.beginPath(); c.moveTo(0, -9); c.lineTo(6.5, 7); c.lineTo(0, 3.5); c.lineTo(-6.5, 7); c.closePath(); c.fill();
    c.restore();
  }

  // full map (M): the whole city with the player, the car, mentors, facts still to find and the objective
  drawBigMap() {
    const g = this.game, c = $('bigmap-canvas').getContext('2d'), W = 900, k = W / MAP_PX;
    const at = (x, z) => [toPx(x) * k, toPx(z) * k];
    c.clearRect(0, 0, W, W);
    c.drawImage(this.map, 0, 0, W, W);
    const dot = (x, z, color, r, label) => {
      const [px, py] = at(x, z);
      c.fillStyle = color; c.beginPath(); c.arc(px, py, r, 0, Math.PI * 2); c.fill();
      if (label) { c.font = '600 15px "Space Grotesk", sans-serif'; c.fillStyle = '#fff'; c.shadowColor = '#000'; c.shadowBlur = 4; c.fillText(label, px + r + 4, py + 5); c.shadowBlur = 0; }
    };
    g.collectibles.items.forEach((it) => { if (!it.taken) dot(it.x, it.z, 'rgba(63,224,255,0.55)', 3.5); });
    g.mentors.list.forEach((m) => dot(m.x, m.z, m.color, 7, g.t(`mentors.${m.id}.name`)));
    dot(g.car.position.x, g.car.position.z, '#ffffff', 5, g.t('map.car'));
    const o = this.objective.target;
    if (o) { const [px, py] = at(o.x, o.z); c.strokeStyle = this.objective.color; c.lineWidth = 3; c.beginPath(); c.arc(px, py, 13 + Math.sin(g.time * 4) * 3, 0, Math.PI * 2); c.stroke(); }
    const p = g.player, [px, py] = at(p.x, p.z), h = g.mode === 'car' ? g.car.heading : g.avatar.facing;
    c.save(); c.translate(px, py); c.rotate(-h + Math.PI);
    c.fillStyle = '#e2b25c'; c.shadowColor = '#e2b25c'; c.shadowBlur = 10;
    c.beginPath(); c.moveTo(0, -12); c.lineTo(8, 9); c.lineTo(0, 4); c.lineTo(-8, 9); c.closePath(); c.fill();
    c.restore();
    const legend = $('bigmap-legend');
    if (!legend.childElementCount) {
      [['#e2b25c', 'map.you'], ['#ffffff', 'map.car'], ['#f2d18b', 'map.mentor'], ['#3fe0ff', 'map.fact'], [this.objective.color, 'map.objective']].forEach(([col, key]) => {
        const li = document.createElement('li'); const i = document.createElement('i'); i.style.background = col; li.append(i, document.createTextNode(g.t(key))); legend.append(li);
      });
    }
  }

  // screen boxes of the HUD panels (plus the marker's half size), measured at most once a second
  hudRects() {
    const now = performance.now();
    if (this.rects && now - this.rectsAt < 1000) return this.rects;
    this.rectsAt = now;
    this.rects = ['.hud-objective', '.hud-map', '.hud-counters', '#speedo', '#pause-btn'].map((s) => document.querySelector(s))
      .filter((el) => el && !el.hidden && el.offsetParent !== null)
      .map((el) => { const b = el.getBoundingClientRect(); return { left: b.left - 30, right: b.right + 30, top: b.top - 30, bottom: b.bottom + 30 }; });
    // panels that touch (the minimap and the counters below it) become one box, so the marker is not pushed from one into the other
    for (let i = 0; i < this.rects.length; i++) for (let j = this.rects.length - 1; j > i; j--) {
      const a = this.rects[i], b = this.rects[j];
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
        Object.assign(a, { left: Math.min(a.left, b.left), right: Math.max(a.right, b.right), top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) });
        this.rects.splice(j, 1); j = this.rects.length;
      }
    }
    return this.rects;
  }

  drawWaypoint() {
    const g = this.game, el = $('waypoint'), o = this.objective.target;
    if (!o || g.dialogue.open) { el.hidden = true; return; }
    const cam = g.ctx.camera;
    const v = this.v.set(o.x, (o.y ?? 2) + 2.5, o.z).project(cam);
    const behind = v.z > 1;
    let x = (v.x * 0.5 + 0.5) * innerWidth, y = (-v.y * 0.5 + 0.5) * innerHeight;
    if (behind) { x = innerWidth - x; y = innerHeight - 40; }
    const m = 48, inside = !behind && x > m && x < innerWidth - m && y > m && y < innerHeight - m;
    let cx = THREE.MathUtils.clamp(x, m, innerWidth - m), cy = THREE.MathUtils.clamp(y, m + 60, innerHeight - m);
    // never on top of the objective, the minimap, the counters, the speedometer or the pause button: slide out by the shortest way
    for (const r of this.hudRects()) {
      if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) continue;
      const out = [[r.left - cx, 0], [r.right - cx, 0], [0, r.top - cy], [0, r.bottom - cy]]
        .filter(([dx, dy]) => cx + dx >= m && cx + dx <= innerWidth - m && cy + dy >= m && cy + dy <= innerHeight - m)   // the marker may already sit on the clamp line
        .sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]))[0];
      if (out) { cx += out[0]; cy += out[1]; }
    }
    let angle = 180;
    if (!inside) angle = Math.atan2(cy - innerHeight / 2, cx - innerWidth / 2) * 180 / Math.PI + 90;
    el.hidden = false;
    el.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -50%)`;
    el.querySelector('.wp-arrow').style.transform = `rotate(${angle}deg)`;
    const dist = Math.hypot(o.x - g.player.x, o.z - g.player.z);
    $('wp-dist').textContent = dist > 999 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`;
  }
}

export { MENTORS };
