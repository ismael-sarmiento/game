// Story and missions. Iris (campus) introduces the city; Byte, Kernel and Nova each teach one idea through play:
// how data travels (route), how to debug (debug) and why data quality matters (train). After all three, Iris
// hands out the Neo Academia graduation. Progress lives in save.data.
import * as THREE from 'three/webgpu';
import { CONFIG } from '../config.js';
import { CITY, roadAt, blockAt, rng } from '../world/layout.js';
import { neonMaterial } from '../world/materials.js';

const EDGE = CITY.BLOCK / 2 - 2.5;
const ROUTE = [[8, 2], [10, 2], [10, 5], [7, 5], [7, 1]].map(([i, j]) => ({ x: roadAt(i), z: roadAt(j) }));
const BUGS = [
  { x: blockAt(7) - EDGE, z: blockAt(7) }, { x: blockAt(10) - EDGE, z: blockAt(9) }, { x: blockAt(8), z: blockAt(11) - EDGE },
];
const ROUTE_TIME = 150, TRAIN_TIME = 120, TRAIN_GOAL = 8;


// A pulsing gate: ring on the ground and a translucent wall.
function gate(scene, color, radius = 7) {
  const c = new THREE.Color(color);
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.12, 8, 64).rotateX(Math.PI / 2), neonMaterial(c, 3));
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 5, 48, 1, true).translate(0, 2.5, 0),
    new THREE.MeshBasicNodeMaterial({ color: c.clone().multiplyScalar(0.7), transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  ring.position.y = 0.15;
  g.add(ring, wall);
  scene.add(g);
  return { group: g, wall, dispose() { scene.remove(g); } };
}

// Fireworks for the graduation: short-lived glowing particles.
class Fireworks {
  constructor(scene) {
    this.n = 600;
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 6, 4), new THREE.MeshBasicNodeMaterial(), this.n);
    this.mesh.frustumCulled = false; this.mesh.visible = false;
    this.p = Array.from({ length: this.n }, () => ({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0 }));
    for (let i = 0; i < this.n; i++) this.mesh.setColorAt(i, new THREE.Color(['#e2b25c', '#3fe0ff', '#a98bff', '#5dffa8', '#ff5c7a'][i % 5]).multiplyScalar(4));
    scene.add(this.mesh);
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3(); this.cursor = 0;
  }
  burst(at) {
    this.mesh.visible = true;
    for (let k = 0; k < 120; k++) {
      const p = this.p[this.cursor++ % this.n];
      p.pos.copy(at); p.vel.randomDirection().multiplyScalar(18 + Math.random() * 10); p.life = 1.6 + Math.random() * 0.8;
    }
  }
  update(dt) {
    if (!this.mesh.visible) return;
    let alive = 0;
    this.p.forEach((p, i) => {
      if (p.life > 0) { p.life -= dt; p.vel.y -= 9 * dt; p.vel.multiplyScalar(1 - dt * 0.8); p.pos.addScaledVector(p.vel, dt); alive++; }
      this.s.setScalar(p.life > 0 ? Math.min(p.life, 1) * 1.2 : 0);
      this.m.compose(p.pos, this.q, this.s); this.mesh.setMatrixAt(i, this.m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    if (!alive) this.mesh.visible = false;
  }
}

export class Missions {
  constructor(game) {
    this.game = game;
    this.active = null;            // { id, ...state }
    this.gates = [];
    this.fireworks = new Fireworks(game.ctx.scene);
    this.showTimer = 0;
  }

  get data() { return this.game.save.data; }
  done(id) { return this.data.missions[id] === 'done'; }
  get allDone() { return ['route', 'debug', 'train'].every((id) => this.done(id)); }

  start() {
    const g = this.game;
    g.hud.toast(g.t(this.data.intro ? 'story.welcomeBack' : 'story.welcome'));
    this.refreshObjective();
  }

  // mentor markers + objective text for the current state of the story
  refreshObjective() {
    const g = this.game, t = g.t, M = g.mentors;
    M.list.forEach((m) => M.setState(m.id, 'idle'));
    if (this.active) { M.setState(this.mentorOf(this.active.id), 'active'); this.updateActiveObjective(); return; }
    g.hud.setTimer(null);
    g.hud.markers = [];
    if (!this.data.intro) {
      M.setState('iris', 'offer');
      g.hud.setObjective(t('story.talkIris'), M.byId('iris'), '#f2d18b');
      return;
    }
    for (const [mid, id] of [['byte', 'route'], ['kernel', 'debug'], ['nova', 'train']]) M.setState(mid, this.done(id) ? 'done' : 'offer');
    M.setState('echo', 'idle');
    if (this.allDone && !this.data.graduated) {
      M.setState('iris', 'offer');
      g.hud.setObjective(t('story.graduate'), M.byId('iris'), '#f2d18b');
    } else if (!this.allDone) {
      const open = M.list.filter((m) => m.state === 'offer');
      const p = g.player;
      const next = open.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
      g.hud.setObjective(t('story.visit', { name: t(`mentors.${next.id}.name`), district: t(`districts.${next.district}`) }), next, next.color);
    } else {
      const c = g.collectibles.nearestOpen(g.player);
      if (c) g.hud.setObjective(t('story.explore', { n: this.data.facts.length }), { x: c.x, z: c.z, y: 1 }, '#3fe0ff');
      else g.hud.setObjective(t('story.free'), null);
    }
  }

  mentorOf(id) { return { route: 'byte', debug: 'kernel', train: 'nova' }[id]; }

  // E pressed: talk to the closest mentor (on foot)
  interact() {
    const g = this.game;
    if (g.mode !== 'foot') return false;
    const m = g.mentors.nearest(g.player);
    if (!m) return false;
    this.talk(m);
    return true;
  }

  topicsFor(m) {
    const g = this.game;
    const list = g.t(`mentors.${m.id}.topics`);
    const choices = (Array.isArray(list) ? list : []).map((topic) => ({
      label: topic.q, onPick: () => g.dialogue.show(m, [topic.a], [{ label: g.t('dialog.back'), onPick: () => this.talk(m) }]),
    }));
    if (g.dialogue.aiAvailable) choices.push({ label: g.t('dialog.ask'), onPick: () => g.dialogue.openQuestion() });
    choices.push({ label: g.t('dialog.bye'), onPick: () => g.dialogue.close() });
    return choices;
  }

  talk(m) {
    const g = this.game, t = g.t, D = g.dialogue;
    const L = (key, vars) => t(`mentors.${m.id}.${key}`, vars);
    g.achievements?.note('talk', m.id);
    if (m.id === 'iris') {
      if (!this.data.intro) {
        return D.show(m, t('mentors.iris.intro'), [{ label: L('introAccept'), primary: true, onPick: () => {
          this.data.intro = true; g.save.write(); D.close(); g.audio.play('success');
          g.hud.toast(t('story.introDone'), 'good'); this.refreshObjective();
        } }]);
      }
      if (this.allDone && !this.data.graduated) {
        return D.show(m, t('mentors.iris.graduation'), [{ label: L('graduateAccept'), primary: true, onPick: () => { D.close(); this.graduate(); } }]);
      }
      const progress = ['route', 'debug', 'train'].filter((id) => this.done(id)).length;
      return D.show(m, [L('greet', { n: progress })], this.topicsFor(m));
    }
    if (m.id === 'lia') {
      const web = { label: L('web'), primary: true, onPick: () => { window.open(CONFIG.ACADEMY_URL, '_blank', 'noopener'); D.close(); } };
      return D.show(m, [L('greet')], [web, ...this.topicsFor(m)]);
    }
    if (m.id === 'echo') {
      const c = g.collectibles.nearestOpen(g.player);
      const hint = c ? L('hint', { d: Math.round(Math.hypot(c.x - g.player.x, c.z - g.player.z)), dir: this.direction(c) }) : L('allFound');
      return D.show(m, [L('greet'), hint], this.topicsFor(m));
    }
    const id = m.mission;
    if (!this.data.intro) return D.show(m, [t('story.seeIrisFirst')]);
    if (this.active && this.active.id === id) {
      return D.show(m, [L('activeReminder')], [
        { label: t('dialog.continueMission'), primary: true, onPick: () => D.close() },
        { label: t('dialog.abandon'), onPick: () => { D.close(); this.stop(); this.refreshObjective(); } },
      ]);
    }
    if (this.active) return D.show(m, [t('story.busy', { name: t(`mentors.${this.mentorOf(this.active.id)}.name`) })]);
    if (this.done(id)) return D.show(m, [L('after')], this.topicsFor(m));
    D.show(m, t(`missions.${id}.offer`), [
      { label: t('dialog.accept'), primary: true, onPick: () => { D.close(); this.begin(id); } },
      { label: t('dialog.later'), onPick: () => D.close() },
      ...this.topicsFor(m).slice(0, -1),
    ]);
  }

  direction(p) {
    const g = this.game;
    const a = Math.atan2(p.x - g.player.x, p.z - g.player.z);   // 0 = +z
    const dirs = this.game.t('compass');
    // +z is south on the minimap, so map angles to compass points
    const idx = Math.round(((Math.PI - a) / (Math.PI * 2)) * 8 + 8) % 8;
    return dirs[idx];
  }

  begin(id) {
    const g = this.game, t = g.t;
    this.stop();
    g.audio.play('checkpoint');
    if (id === 'route') {
      const byte = g.mentors.byId('byte');
      if (g.mode === 'foot' && g.car.position.distanceTo(new THREE.Vector3(byte.x, 0, byte.z)) > 40) {
        g.car.teleport(roadAt(8) + 5.55, byte.z - 6, Math.PI);
        g.hud.toast(t('missions.route.carHere'));
      }
      this.active = { id, index: 0, time: ROUTE_TIME, started: g.time };
      this.showGate(ROUTE[0], '#e2b25c', ROUTE[1]);
    } else if (id === 'debug') {
      this.active = { id, fixed: [false, false, false], quizzes: 0 };
      this.gates = BUGS.map((b) => ({ ...this.bugMesh(b), at: b }));
    } else if (id === 'train') {
      this.active = { id, clean: 0, noisy: 0, time: TRAIN_TIME };
      this.spawnOrbs();
    }
    g.hud.toast(t(`missions.${id}.started`), 'good');
    this.refreshObjective();
  }

  stop() {
    this.gates.forEach((x) => x.dispose());
    this.gates = [];
    if (this.orbs) { this.game.ctx.scene.remove(this.orbs.group); this.orbs = null; }
    this.active = null;
    this.game.hud.setTimer(null);
    this.game.hud.markers = [];
  }

  showGate(at, color, next) {
    this.gates.forEach((x) => x.dispose());
    const g = gate(this.game.ctx.scene, color);
    g.group.position.set(at.x, 0, at.z);
    this.gates = [g];
    if (next) {
      const n = gate(this.game.ctx.scene, '#6d7499', 5);
      n.group.position.set(next.x, 0, next.z); n.group.scale.setScalar(0.7);
      this.gates.push(n);
    }
  }

  bugMesh(at) {
    const scene = this.game.ctx.scene;
    const group = new THREE.Group();
    const red = new THREE.Color('#ff3355');
    for (let k = 0; k < 7; k++) {
      const cube = new THREE.Mesh(new THREE.BoxGeometry(0.4 + Math.random() * 0.5, 0.4 + Math.random() * 0.5, 0.4 + Math.random() * 0.5), neonMaterial(red, 2.6 + Math.random() * 2));
      cube.position.set((Math.random() - 0.5) * 1.6, 1 + Math.random() * 1.8, (Math.random() - 0.5) * 1.6);
      group.add(cube);
    }
    group.position.set(at.x, CITY.CURB, at.z);
    scene.add(group);
    return { group, dispose() { scene.remove(group); } };
  }

  spawnOrbs() {
    const r = rng(Math.floor(Math.random() * 1e9));
    const group = new THREE.Group();
    const items = [];
    const roadsX = [2, 3, 4].map(roadAt), roadsZ = [1, 2, 3, 4].map(roadAt);
    const add = (noisy) => {
      for (let tries = 0; tries < 50; tries++) {
        const alongX = r() < 0.5;
        const x = alongX ? roadsX[Math.floor(r() * 3)] + (r() < 0.5 ? -1 : 1) * (r() < 0.5 ? 1.9 : 5.55) : -320 + r() * 160;
        const z = alongX ? -400 + r() * 240 : roadsZ[Math.floor(r() * 4)] + (r() < 0.5 ? -1 : 1) * (r() < 0.5 ? 1.9 : 5.55);
        if (items.every((o) => Math.hypot(o.x - x, o.z - z) > 18)) {
          const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(noisy ? 0.75 : 0.65, noisy ? 0 : 1), neonMaterial(new THREE.Color(noisy ? '#ff3355' : '#3fe0ff'), noisy ? 3.2 : 3));
          mesh.position.set(x, 1.4, z); group.add(mesh);
          items.push({ x, z, noisy, mesh, taken: false });
          return;
        }
      }
    };
    for (let k = 0; k < 12; k++) add(false);
    for (let k = 0; k < 7; k++) add(true);
    this.game.ctx.scene.add(group);
    this.orbs = { group, items };
  }

  updateActiveObjective() {
    const g = this.game, t = g.t, a = this.active;
    if (!a) return;
    if (a.id === 'route') {
      g.hud.setObjective(t('missions.route.objective', { n: a.index + 1, total: ROUTE.length }), { ...ROUTE[a.index], y: 2 }, '#e2b25c');
    } else if (a.id === 'debug') {
      const left = a.fixed.map((f, i) => (f ? null : BUGS[i])).filter(Boolean);
      const p = g.player;
      const next = left.sort((x, y) => Math.hypot(x.x - p.x, x.z - p.z) - Math.hypot(y.x - p.x, y.z - p.z))[0];
      g.hud.setObjective(t('missions.debug.objective', { n: a.fixed.filter(Boolean).length, total: 3 }), next ? { ...next, y: 2 } : null, '#ff5c7a');
      g.hud.markers = left.map((b) => ({ x: b.x, z: b.z, color: '#ff3355', r: 4 }));
    } else if (a.id === 'train') {
      g.hud.setObjective(t('missions.train.objective', { n: a.clean, goal: TRAIN_GOAL, noisy: a.noisy }), { x: -240, z: -280, y: 2 }, '#3fe0ff');
      g.hud.markers = (this.orbs?.items || []).filter((o) => !o.taken).map((o) => ({ x: o.x, z: o.z, color: o.noisy ? '#ff3355' : '#3fe0ff', r: 2.5 }));
    }
  }

  update(dt) {
    const g = this.game, p = g.player, a = this.active, t = g.t;
    this.fireworks.update(dt);
    this.gates.forEach((x) => { if (x.wall) x.wall.material.opacity = 0.1 + Math.sin(g.time * 4) * 0.05; });
    this.showTimer -= dt;
    if (!a) {
      if (this.showTimer <= 0) { this.showTimer = 2; if (this.data.intro && this.allDone) this.refreshObjective(); }
      return;
    }
    if (a.id === 'route') {
      a.time -= dt;
      g.hud.setTimer(a.time);
      const cp = ROUTE[a.index];
      if (Math.hypot(p.x - cp.x, p.z - cp.z) < 9) {
        g.audio.play('checkpoint');
        g.hud.toast(t('missions.route.steps')[a.index], 'good');
        a.index++;
        if (a.index >= ROUTE.length) return this.complete('route', { time: Math.round(ROUTE_TIME - a.time) });
        this.showGate(ROUTE[a.index], '#e2b25c', ROUTE[a.index + 1]);
        this.updateActiveObjective();
      }
      if (a.time <= 0) this.fail('route');
    } else if (a.id === 'debug') {
      this.gates.forEach((b, i) => {
        if (a.fixed[i]) return;
        b.group.children.forEach((c, k) => { if (c.geometry.type === 'BoxGeometry') { c.position.y = 1 + ((g.time * 0.6 + k * 0.37) % 1) * 1.8; c.rotation.set(g.time * (k + 1), g.time, 0); c.visible = Math.random() > 0.04; } });
        if (!g.menu.cardOpen && Math.hypot(p.x - b.at.x, p.z - b.at.z) < (g.mode === 'car' ? 6 : 3.2)) this.quiz(i);
      });
      if (this.showTimer <= 0) { this.showTimer = 1; this.updateActiveObjective(); }
    } else if (a.id === 'train') {
      a.time -= dt;
      g.hud.setTimer(a.time);
      const radius = g.mode === 'car' ? 3.6 : 2.2;
      this.orbs.items.forEach((o, k) => {
        if (o.taken) return;
        o.mesh.position.y = 1.4 + Math.sin(g.time * 2 + k) * 0.25;
        o.mesh.rotation.y += dt * (o.noisy ? 4 : 1.2);
        if (o.noisy) o.mesh.visible = Math.random() > 0.08;
        if (Math.hypot(p.x - o.x, p.z - o.z) < radius) {
          o.taken = true; o.mesh.visible = false;
          if (o.noisy) { a.noisy++; g.audio.play('glitch'); g.hud.toast(t('missions.train.noisy'), 'bad'); g.chase.bump(0.3); }
          else { a.clean++; g.audio.play('pickup'); }
          this.updateActiveObjective();
          if (a.clean >= TRAIN_GOAL) this.complete('train', { accuracy: Math.round((a.clean / (a.clean + a.noisy)) * 100), noisy: a.noisy });
        }
      });
      if (this.active && a.time <= 0) this.fail('train');
    }
  }

  quiz(i) {
    const g = this.game, t = g.t, a = this.active;
    const q = t('missions.debug.quiz')[i];
    g.audio.play('glitch');
    g.menu.card({
      eyebrow: t('missions.debug.quizEyebrow', { n: i + 1 }), title: q.question, code: q.code,
      actions: q.options.map((opt, k) => ({
        label: opt, choice: true, keepOpen: true,
        onPick: ({ feedback }) => {
          if (a.fixed[i]) return false;   // already solved: ignore extra clicks while the card closes
          if (k === q.answer) {
            feedback.className = 'feedback good'; feedback.textContent = q.explain;
            g.audio.play('success');
            a.fixed[i] = true;
            this.gates[i].group.visible = false;
            setTimeout(() => {
              g.menu.closeCard();
              if (a.fixed.every(Boolean)) this.complete('debug', {});
              else { g.hud.toast(t('missions.debug.fixed', { n: a.fixed.filter(Boolean).length }), 'good'); this.updateActiveObjective(); }
            }, 2200);
          } else {
            feedback.className = 'feedback bad'; feedback.textContent = q.hint;
            g.audio.play('fail');
          }
          return false;
        },
      })),
    });
  }

  complete(id, stats) {
    const g = this.game, t = g.t;
    this.stop();
    this.data.missions[id] = 'done';
    g.save.write();
    g.audio.play('success');
    g.hud.refreshTexts();
    const result = id === 'route' ? t('missions.route.result', stats) : id === 'train' ? t(stats.noisy ? (stats.noisy === 1 ? 'missions.train.resultNoisyOne' : 'missions.train.resultNoisy') : 'missions.train.resultClean', stats) : t('missions.debug.result');
    g.menu.card({
      eyebrow: t('missions.completed'), title: t(`missions.${id}.title`), badge: t('missions.badge', { n: Object.keys(this.data.missions).length }),
      paragraphs: [result, t(`missions.${id}.lesson`), t('missions.academyLine')],
      actions: [
        { label: t('dialog.continue'), primary: true, onPick: () => this.refreshObjective() },
        { label: t('missions.learnMore'), href: CONFIG.ACADEMY_URL },
      ],
    });
    this.refreshObjective();
  }

  fail(id) {
    const g = this.game, t = g.t;
    this.stop();
    g.audio.play('fail');
    g.menu.card({
      eyebrow: t('missions.failedEyebrow'), title: t(`missions.${id}.title`), paragraphs: [t(`missions.${id}.failed`)],
      actions: [
        { label: t('missions.retry'), primary: true, onPick: () => this.begin(id) },
        { label: t('missions.later'), onPick: () => this.refreshObjective() },
      ],
    });
    this.refreshObjective();
  }

  graduate() {
    const g = this.game, t = g.t, tower = g.city.tower;
    this.data.graduated = true; g.save.write();
    g.audio.play('success');
    for (let k = 0; k < 7; k++) {
      setTimeout(() => {
        this.fireworks.burst(new THREE.Vector3(tower.x + (Math.random() - 0.5) * 60, 120 + Math.random() * 60, tower.z + (Math.random() - 0.5) * 60));
        g.audio.play('fireworks');
      }, 400 + k * 700);
    }
    setTimeout(() => g.menu.card({
      eyebrow: t('graduation.eyebrow'), title: t('graduation.title'), badge: t('graduation.badge'),
      paragraphs: [t('graduation.text'), t('graduation.next')],
      actions: [
        { label: t('graduation.cta'), primary: true, href: CONFIG.ACADEMY_URL },
        { label: t('graduation.keep'), onPick: () => this.refreshObjective() },
      ],
      pause: false,
    }), 2600);
    this.refreshObjective();
  }

  debugComplete(id) {
    this.data.intro = true;
    if (id === 'all') ['route', 'debug', 'train'].forEach((m) => { this.data.missions[m] = 'done'; });
    else this.data.missions[id] = 'done';
    this.game.save.write(); this.stop(); this.refreshObjective(); this.game.hud.refreshTexts();
  }
}
