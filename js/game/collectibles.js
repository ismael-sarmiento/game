// Twenty floating data cubes hidden around the city. Each one unlocks a real, verifiable fact about computing and AI.
import * as THREE from 'three/webgpu';
import { CITY, blockAt, isCampus, rng } from '../world/layout.js';
import { neonMaterial } from '../world/materials.js';

const COUNT = 40;

function positions() {
  const r = rng(404), out = [];
  const edge = CITY.BLOCK / 2 - 2.5;
  let guard = 0;
  while (out.length < COUNT && guard++ < 2000) {
    const i = Math.floor(r() * CITY.N), j = Math.floor(r() * CITY.N);
    if (isCampus(i, j) && out.length > 0) continue;
    const side = Math.floor(r() * 4), u = (r() - 0.5) * 2 * (edge - 4);
    const [dx, dz] = [[u, -edge], [edge, u], [u, edge], [-edge, u]][side];
    const x = blockAt(i) + dx, z = blockAt(j) + dz;
    if (out.every((p) => Math.hypot(p.x - x, p.z - z) > 60) && Math.hypot(x - 24, z - 26) > 20) out.push({ x, z });
  }
  return out;
}

export class Collectibles {
  constructor(game) {
    this.game = game;
    const { scene } = game.ctx;
    this.items = positions().map((p, id) => ({ id, ...p, taken: game.save.data.facts.includes(id) }));
    const cyan = new THREE.Color('#3fe0ff'), gold = new THREE.Color('#e2b25c');
    this.core = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), neonMaterial(gold, 3.2), COUNT);
    this.shell = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), new THREE.MeshPhysicalNodeMaterial({ color: '#0a1a2a', metalness: 0.2, roughness: 0.05, transmission: 0, transparent: true, opacity: 0.35, emissive: cyan, emissiveIntensity: 0.6 }), COUNT);
    this.ring = new THREE.InstancedMesh(new THREE.TorusGeometry(0.95, 0.03, 6, 32), neonMaterial(cyan, 3), COUNT);
    this.beam = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.18, 40, 8, 1, true).translate(0, 20, 0),
      new THREE.MeshBasicNodeMaterial({ color: cyan.clone().multiplyScalar(0.8), transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), COUNT);
    [this.core, this.shell, this.ring, this.beam].forEach((m) => { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); });
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.v = new THREE.Vector3(); this.s = new THREE.Vector3();
    this.burst = null;
  }

  update(dt) {
    const g = this.game, p = g.player, t = g.time;
    const { m, q, e, v, s } = this;
    this.items.forEach((it, k) => {
      const y = CITY.CURB + 1.4 + Math.sin(t * 1.8 + k) * 0.18;
      s.setScalar(it.taken ? 0 : 1);
      q.setFromEuler(e.set(t * 0.7 + k, t * 0.9, 0));
      m.compose(v.set(it.x, y, it.z), q, s); this.core.setMatrixAt(k, m);
      q.setFromEuler(e.set(-t * 0.4, -t * 0.6 + k, 0.3));
      m.compose(v, q, s); this.shell.setMatrixAt(k, m);
      q.setFromEuler(e.set(Math.PI / 2, 0, t * 1.5)); m.compose(v.set(it.x, y - 0.9 + Math.sin(t * 2 + k) * 0.3, it.z), q, s); this.ring.setMatrixAt(k, m);
      q.identity(); m.compose(v.set(it.x, CITY.CURB, it.z), q, s); this.beam.setMatrixAt(k, m);
      if (!it.taken && Math.hypot(p.x - it.x, p.z - it.z) < (g.mode === 'car' ? 3.4 : 2.0) && Math.abs(p.y - y) < 3.5) this.collect(it);
    });
    [this.core, this.shell, this.ring, this.beam].forEach((x) => { x.instanceMatrix.needsUpdate = true; });
  }

  collect(it) {
    const g = this.game;
    it.taken = true;
    if (!g.save.data.facts.includes(it.id)) g.save.data.facts.push(it.id);
    g.save.write();
    g.audio.play('pickup');
    g.hud.refreshTexts();
    const fact = g.t('facts')[it.id];
    const n = g.save.data.facts.length;
    g.menu.card({
      eyebrow: g.t('hud.factEyebrow'), kind: 'fact',
      title: fact.title,
      paragraphs: [fact.text],
      badge: g.t('hud.factFound', { n, total: COUNT }),
      actions: [{ label: g.t('dialog.continue'), primary: true }],
    });
    if (n === COUNT) setTimeout(() => g.hud.toast(g.t('hud.allFacts'), 'good'), 600);
  }

  nearestOpen(p) {
    let best = null, bd = Infinity;
    for (const it of this.items) if (!it.taken) { const d = Math.hypot(it.x - p.x, it.z - p.z); if (d < bd) { bd = d; best = it; } }
    return best;
  }

  debugCollectAll() { this.items.forEach((it) => { if (!it.taken) { it.taken = true; this.game.save.data.facts.push(it.id); } }); this.game.save.write(); this.game.hud.refreshTexts(); }
}
