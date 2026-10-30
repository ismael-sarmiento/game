// People: seven clothed CC0 characters (Quaternius, see CREDITS.md) with skeletal animation. Each model is merged into
// a single vertex-coloured skinned mesh (one draw call). PersonRig drives the animations from the speed; Crowd keeps
// a few dozen people around the player: they stroll the sidewalks, chat in pairs, wave and run from fast cars.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CITY, blockAt, isCampus, rng } from './layout.js';

export const VARIANTS = ['man_beach', 'man_suit', 'man_worker', 'woman_casual', 'woman_formal', 'woman_suit', 'woman_worker'];
const HEIGHT = { man: 1.78, woman: 1.67 };

export async function loadPeople(onProgress) {
  const loader = new GLTFLoader();
  const out = {};
  let done = 0;
  await Promise.all(VARIANTS.map(async (name) => {
    const gltf = await loader.loadAsync(`assets/people/${name}.glb`);
    out[name] = prepare(gltf, HEIGHT[name.split('_')[0]]);
    onProgress?.(++done / VARIANTS.length);
  }));
  return out;
}

// one skinned mesh per character: the colour of each part moves into a vertex attribute
function prepare(gltf, height) {
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const parts = [];
  scene.traverse((o) => { if (o.isSkinnedMesh) parts.push(o); });
  const geos = parts.map((mesh) => {
    const g = mesh.geometry.clone();
    for (const key of Object.keys(g.attributes)) if (!['position', 'normal', 'skinIndex', 'skinWeight'].includes(key)) g.deleteAttribute(key);
    g.morphAttributes = {};
    const c = (mesh.material.color || new THREE.Color(1, 1, 1)).clone();
    const colors = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  });
  const merged = mergeGeometries(geos, false);
  const keep = parts[0];
  keep.geometry = merged;
  keep.material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.02 });
  parts.slice(1).forEach((p) => p.parent.remove(p));
  const box = new THREE.Box3().setFromObject(scene);
  return { scene, animations: gltf.animations, scale: height / Math.max(0.1, box.max.y - box.min.y) };
}

export class PersonRig {
  constructor(template) {
    this.root = new THREE.Group();
    const body = cloneSkinned(template.scene);
    body.scale.setScalar(template.scale);
    body.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    this.root.add(body);
    this.mixer = new THREE.AnimationMixer(body);
    this.actions = {};
    template.animations.forEach((clip) => { this.actions[clip.name] = this.mixer.clipAction(clip); });
    this.current = null;
    this.play('Idle', 0);
  }

  play(name, fade = 0.25, { once = false, speed = 1 } = {}) {
    const a = this.actions[name] || this.actions.Idle;
    if (this.current === a) { a.timeScale = speed; return; }
    a.reset();
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat);
    a.clampWhenFinished = once;
    a.timeScale = speed;
    a.fadeIn(fade).play();
    if (this.current) this.current.fadeOut(fade);
    this.current = a; this.name = name;
  }

  // picks the animation from the ground speed (m/s); talking and waving only when standing
  animate(dt, speed, { talking = 0, waving = false, idle = 'Idle' } = {}) {
    let name = idle, rate = 1;
    if (speed > 3.4) { name = 'Run'; rate = speed / 5.4; }
    else if (speed > 0.25) { name = 'Walk'; rate = speed / 1.45; }
    else if (waving) name = 'Wave';
    else if (talking > 0.5) name = 'Interact';
    this.play(name, 0.25, { speed: THREE.MathUtils.clamp(rate, 0.6, 1.7) });
    this.mixer.update(dt);
  }
}

const EDGE = CITY.BLOCK / 2 - 2.6;     // people walk 2.6 m inside the block edge (trees sit at 1.7 m)
const PERIM = EDGE * 8;

export class Crowd {
  constructor({ scene }, people, count) {
    this.scene = scene; this.people = people; this.rand = rng(57);
    this.list = [];
    this.bubbles = new Bubbles(scene);
    this.setCount(count);
  }

  setCount(n) {
    while (this.list.length < n) {
      const variant = VARIANTS[this.list.length % VARIANTS.length];
      const rig = new PersonRig(this.people[variant]);
      this.scene.add(rig.root);
      this.list.push({ rig, pos: new THREE.Vector3(), yaw: 0, s: 0, dir: 1, speed: 1.3, mode: 'walk', timer: 0, flee: 0, waved: false, placed: false });
    }
    this.list.forEach((p, k) => { p.rig.root.visible = k < n; });
    this.count = n;
  }

  // a person somewhere on the sidewalks of the blocks around the player
  respawn(p, centre) {
    const r = this.rand;
    let i, j;
    for (let tries = 0; tries < 12; tries++) {
      const ci = Math.round((centre.x + CITY.HALF - CITY.ROAD - CITY.BLOCK / 2) / CITY.PITCH);
      const cj = Math.round((centre.z + CITY.HALF - CITY.ROAD - CITY.BLOCK / 2) / CITY.PITCH);
      i = THREE.MathUtils.clamp(ci + Math.floor(r() * 3) - 1, 0, CITY.N - 1);
      j = THREE.MathUtils.clamp(cj + Math.floor(r() * 3) - 1, 0, CITY.N - 1);
      if (!isCampus(i, j) || r() < 0.4) break;
    }
    p.mode = 'walk'; p.partner = null; p.cross = null;
    p.bx = blockAt(i); p.bz = blockAt(j); p.s = r() * PERIM; p.dir = r() < 0.5 ? 1 : -1;
    p.speed = 1.15 + r() * 0.5; p.flee = 0; p.waved = false;
    p.mode = r() < 0.72 ? 'walk' : 'idle';
    p.timer = 6 + r() * 20;
    p.placed = true;
    const L = this.loop(p); p.pos.set(L.x, CITY.CURB, L.z); p.yaw = Math.atan2(L.fx, L.fz);
    // some people wait at a nearby bus stop, facing the road
    const stop = (this.stops || []).find((st) => Math.hypot(st.x - centre.x, st.z - centre.z) < 110 && r() < 0.3);
    if (stop) {
      const side = new THREE.Vector3((r() - 0.5) * 3, 0, -0.2).applyAxisAngle(new THREE.Vector3(0, 1, 0), stop.face);
      p.pos.set(stop.x + side.x, CITY.CURB, stop.z + side.z); p.yaw = stop.face; p.mode = 'idle'; p.timer = 25 + r() * 40; p.atStop = true;
      const near = (v) => blockAt(THREE.MathUtils.clamp(Math.round((v - blockAt(0)) / CITY.PITCH), 0, CITY.N - 1));
      p.bx = near(stop.x); p.bz = near(stop.z);   // the block whose sidewalk the stop stands on
    } else p.atStop = false;
  }

  loop(p) {
    const s = ((p.s % PERIM) + PERIM) % PERIM, side = Math.floor(s / (EDGE * 2)), u = s % (EDGE * 2) - EDGE;
    const c = [[u, -EDGE, 1, 0], [EDGE, u, 0, 1], [-u, EDGE, -1, 0], [-EDGE, -u, 0, -1]][side];
    return { x: p.bx + c[0], z: p.bz + c[1], fx: c[2] * p.dir, fz: c[3] * p.dir };
  }

  scare(at, radius) {
    let spoke = 0;
    for (let k = 0; k < this.count; k++) {
      const p = this.list[k];
      if (p.pos.distanceTo(at) < radius && p.flee <= 0) {
        this.startFlee(p, at);
        if (spoke++ < 2 && this.game) this.bubbles.say(p, pick(this.game.t('people.horn')));
      }
    }
  }
  startFlee(p, from) { this.unpair(p); p.flee = 2.2; p.fleeYaw = Math.atan2(p.pos.x - from.x, p.pos.z - from.z); p.mode = 'walk'; }

  unpair(p) {
    if (p.partner) { const q = p.partner; q.partner = null; q.mode = 'walk'; q.timer = 8 + this.rand() * 20; p.partner = null; }
  }

  // two people stop and talk facing each other; the second one walks up to the first
  tryPair(p) {
    for (let k = 0; k < this.count; k++) {
      const q = this.list[k];
      if (q === p || q.mode !== 'walk' || q.partner || q.flee > 0 || q.bx !== p.bx || q.bz !== p.bz) continue;
      if (q.pos.distanceTo(p.pos) > 14) continue;
      const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
      p.mode = 'chat'; q.mode = 'chat'; p.partner = q; q.partner = p;
      p.spot = p.pos.clone(); q.spot = new THREE.Vector3(p.pos.x + fx * 1.15, CITY.CURB, p.pos.z + fz * 1.15);
      p.timer = q.timer = 8 + this.rand() * 10;
      p.leader = true; q.leader = false;
      return true;
    }
    return false;
  }

  // at a corner: maybe cross the road on the zebra to the next block, when the cars there have red
  tryCross(p, game) {
    const sx = Math.sign(p.pos.x - p.bx) || 1, sz = Math.sign(p.pos.z - p.bz) || 1;
    const alongX = this.rand() < 0.5;
    const bi = Math.round((p.bx - blockAt(0)) / CITY.PITCH), bj = Math.round((p.bz - blockAt(0)) / CITY.PITCH);
    const ni = bi + (alongX ? sx : 0), nj = bj + (alongX ? 0 : sz);
    if (ni < 0 || nj < 0 || ni >= CITY.N || nj >= CITY.N) return false;
    const span = CITY.PITCH - EDGE * 2;
    p.mode = 'wait';
    p.cross = {
      node: [bi + (sx > 0 ? 1 : 0), bj + (sz > 0 ? 1 : 0)], axis: alongX ? 'z' : 'x',   // cars on the crossed road move along this axis
      from: p.pos.clone(), to: new THREE.Vector3(p.pos.x + (alongX ? sx * span : 0), CITY.CURB, p.pos.z + (alongX ? 0 : sz * span)),
      nbx: blockAt(ni), nbz: blockAt(nj), t: 0,
    };
    p.timer = 25;
    return true;
  }

  update(dt, game) {
    this.game = game;
    const player = game.player, onFoot = game.mode === 'foot';
    const car = game.car, carFast = game.mode === 'car' && Math.abs(car.speed) > 5;
    for (let k = 0; k < this.count; k++) {
      const p = this.list[k];
      if (!p.placed || p.pos.distanceToSquared(player) > 125 * 125) { this.unpair(p); this.respawn(p, player); }
      const d = Math.hypot(player.x - p.pos.x, player.z - p.pos.z);
      if (carFast && d < 9 && p.flee <= 0) this.startFlee(p, player);

      let speed = 0, waving = false, talking = 0;
      if (p.flee > 0) {
        // run away from the car, then carry on walking from wherever they ended up
        p.flee -= dt; speed = 4.6;
        p.pos.x += Math.sin(p.fleeYaw) * speed * dt; p.pos.z += Math.cos(p.fleeYaw) * speed * dt;
        p.yaw = turn(p.yaw, p.fleeYaw, dt * 10);
        if (p.flee <= 0) p.placed = d < 60 ? this.resync(p) : false;
      } else if (onFoot && d < 5.5 && !p.waved && p.mode !== 'cross') {
        // greet the player once when they come close
        p.yaw = turn(p.yaw, Math.atan2(player.x - p.pos.x, player.z - p.pos.z), dt * 6);
        waving = true;
        if (!p.greeted) { p.greeted = true; this.bubbles.say(p, pick(game.t('people.greet'))); p.waveTime = 0; game.achievements?.note('greet'); }
        p.waveTime = (p.waveTime || 0) + dt;
        if (p.waveTime > 2.4 || d < 1.6) p.waved = true;
      } else if (p.mode === 'chat') {
        // walk up to the meeting spot, face the other person and take turns talking
        const to = p.spot, dd = Math.hypot(to.x - p.pos.x, to.z - p.pos.z);
        if (dd > 0.15) {
          speed = Math.min(1.4, dd * 2);
          const a = Math.atan2(to.x - p.pos.x, to.z - p.pos.z);
          p.pos.x += Math.sin(a) * speed * dt; p.pos.z += Math.cos(a) * speed * dt; p.yaw = turn(p.yaw, a, dt * 8);
        } else if (p.partner) {
          p.yaw = turn(p.yaw, Math.atan2(p.partner.pos.x - p.pos.x, p.partner.pos.z - p.pos.z), dt * 5);
          talking = (Math.sin(game.time * 0.9 + (p.leader ? 0 : Math.PI)) > 0) ? 1 : 0;
        }
        if (p.leader) { p.timer -= dt; if (p.timer <= 0) { this.unpair(p); p.mode = 'walk'; p.timer = 10 + this.rand() * 25; this.resync(p); } }
      } else if (p.mode === 'wait' || p.mode === 'cross') {
        const c = p.cross;
        if (p.mode === 'wait') {
          // at the kerb, facing the road, until the cars on it have red
          p.yaw = turn(p.yaw, Math.atan2(c.to.x - c.from.x, c.to.z - c.from.z), dt * 5);
          p.timer -= dt;
          const red = !game.lights || game.lights.state(c.node[0], c.node[1], c.axis, game.time) === 2;
          if (red) p.mode = 'cross';
          else if (p.timer <= 0) { p.mode = 'walk'; p.cross = null; }
        } else {
          c.t += dt * 1.55 / c.from.distanceTo(c.to);
          speed = 1.55;
          p.pos.lerpVectors(c.from, c.to, Math.min(c.t, 1));
          if (c.t >= 1) { p.bx = c.nbx; p.bz = c.nbz; this.resync(p); p.mode = 'walk'; p.cross = null; p.timer = 10 + this.rand() * 20; }
        }
      } else if (p.mode === 'idle') {
        // standing: on the phone or thinking; then off again
        p.timer -= dt; talking = Math.sin(game.time * 0.4 + k) > 0.6 ? 1 : 0;
        if (p.timer <= 0) { p.mode = 'walk'; p.timer = 10 + this.rand() * 25; if (p.atStop) { p.atStop = false; this.resync(p); } }
      } else {
        const before = Math.floor(((p.s % PERIM) + PERIM) % PERIM / (EDGE * 2));
        p.s += p.speed * p.dir * dt; speed = p.speed;
        const L = this.loop(p);
        const after = Math.floor(((p.s % PERIM) + PERIM) % PERIM / (EDGE * 2));
        p.pos.x = THREE.MathUtils.damp(p.pos.x, L.x, 6, dt); p.pos.z = THREE.MathUtils.damp(p.pos.z, L.z, 6, dt);
        p.yaw = turn(p.yaw, Math.atan2(L.fx, L.fz), dt * 6);
        p.timer -= dt;
        if (before !== after && this.rand() < 0.35) this.tryCross(p, game);
        else if (p.timer <= 0) {
          if (!(this.rand() < 0.55 && this.tryPair(p))) { p.mode = 'idle'; p.timer = 4 + this.rand() * 8; }
        }
        if (d > 7) { p.waved = false; p.greeted = false; }
      }
      p.rig.root.position.set(p.pos.x, CITY.CURB, p.pos.z);
      p.rig.root.rotation.y = p.yaw;
      // animation cost only for people that are close enough to be seen in detail
      p.rig.animate(d < 90 ? dt : 0, speed, { waving, talking });
    }
    this.bubbles.update(dt, game.ctx.camera);
  }

  // after fleeing: snap back onto the nearest point of their sidewalk loop
  resync(p) {
    let best = p.s, bd = Infinity;
    for (let s = 0; s < PERIM; s += 2) {
      const L = this.loop({ ...p, s });
      const dd = (L.x - p.pos.x) ** 2 + (L.z - p.pos.z) ** 2;
      if (dd < bd) { bd = dd; best = s; }
    }
    p.s = best;
    return true;
  }
}

function turn(from, to, k) {
  let d = to - from; d = Math.atan2(Math.sin(d), Math.cos(d));
  return from + d * Math.min(1, k);
}

const pick = (list) => (Array.isArray(list) ? list[Math.floor(Math.random() * list.length)] : '');

// Speech bubbles above people's heads (a small pool of sprites with canvas text).
class Bubbles {
  constructor(scene) {
    this.pool = Array.from({ length: 6 }, () => {
      const c = document.createElement('canvas'); c.width = 512; c.height = 128;
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteNodeMaterial({ map: tex, transparent: true, depthWrite: false }));
      sprite.visible = false; sprite.renderOrder = 5; scene.add(sprite);
      return { c, tex, sprite, life: 0, who: null };
    });
  }
  say(person, text) {
    if (!text) return;
    const b = this.pool.find((x) => x.life <= 0) || this.pool[0];
    const g = b.c.getContext('2d');
    g.clearRect(0, 0, 512, 128);
    g.font = '600 44px "Space Grotesk", sans-serif';
    const w = Math.min(500, g.measureText(text).width + 56);
    g.fillStyle = 'rgba(255,255,255,0.94)';
    g.beginPath(); g.roundRect((512 - w) / 2, 10, w, 84, 40); g.fill();
    g.beginPath(); g.moveTo(240, 92); g.lineTo(256, 116); g.lineTo(272, 92); g.fill();
    g.fillStyle = '#14182c'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 54);
    b.tex.needsUpdate = true;
    b.life = 2.8; b.who = person; b.sprite.visible = true;
    b.sprite.scale.set(2.4, 0.6, 1);
  }
  update(dt) {
    for (const b of this.pool) {
      if (b.life <= 0) continue;
      b.life -= dt;
      const p = b.who.pos;
      b.sprite.position.set(p.x, CITY.CURB + 2.25, p.z);
      b.sprite.material.opacity = Math.min(1, b.life * 3);
      if (b.life <= 0) b.sprite.visible = false;
    }
  }
}
