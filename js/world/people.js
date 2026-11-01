// People: seven clothed CC0 characters (Quaternius, see CREDITS.md) with skeletal animation. Each model is merged into
// a single vertex-coloured skinned mesh (one draw call) with smoothed normals (hard edges only where the model folds
// sharply). Every vertex knows what it is (skin, clothes, hair, eyes, metal), so each passer-by gets their own skin
// tone, hair and clothes colours. PersonRig drives the animations from the speed; Crowd keeps a few dozen people
// around the player: they stroll the sidewalks, chat in pairs, wave and run from fast cars.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { vertexColor, attribute, uniform, mix, step, float } from 'three/tsl';
import { CITY, blockAt, isCampus, rng } from './layout.js';

// Collision groups (membership << 16 | filter): vehicles and people never touch physically — cars brake for people
// instead (non-violent by design) — while the player on foot does bump into them.
export const GROUPS = {
  vehicle: ((0x0002 << 16) | (0xffff & ~0x0004)) >>> 0,
  person: ((0x0004 << 16) | (0xffff & ~0x0002)) >>> 0,
  notPeople: ((0xffff << 16) | (0xffff & ~0x0004)) >>> 0,
};

export const VARIANTS = ['man_beach', 'man_suit', 'man_worker', 'woman_casual', 'woman_formal', 'woman_suit', 'woman_worker'];
const STREET = VARIANTS.filter((v) => v !== 'man_beach');   // swimwear stays a choice for the player, not the city
const HEIGHT = { man: 1.78, woman: 1.67 };
// what each material of the models is: 0 skin, 1 clothes, 2 hair, 3 eyes, 4 metal
const KIND = (name) => (name === 'Skin' ? 0 : /Hair|Eyebrows|Moustache/.test(name) ? 2 : name === 'Eye' ? 3 : /Gold|Earrings/.test(name) ? 4 : 1);
// clothes that keep their colour: high-visibility workwear
const KEEP = /^Worker_/;
const SKIN = ['#f1d3bf', '#e6bc98', '#d6a27c', '#b77f5a', '#8d5a3c', '#6b4129', '#4a2c1d'];
const HAIR = ['#141110', '#2a1b12', '#4a3020', '#6f4a2c', '#a07a4a', '#c9a66b', '#7a3b22', '#8c8c8c'];
const CLOTH = ['#2b3a55', '#1d1d20', '#4a4a52', '#5b6f8a', '#e8e6e1', '#3f5d3a', '#7a2e2e', '#2f6f73', '#a33b3b', '#6d5a7a', '#9aa3ad', '#24324a', '#5e4636'];   // nothing close to a skin tone

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
  const slots = new Map();   // clothes materials in order of appearance: up to three recolourable garments
  const whole = new THREE.Box3().setFromObject(scene), tall = whole.max.y - whole.min.y;
  const geos = parts.map((mesh) => {
    // some models name their hair after its colour ('Brown'): anything that is not skin and sits on the head is hair
    const box = new THREE.Box3().setFromBufferAttribute(mesh.geometry.attributes.position).applyMatrix4(mesh.matrixWorld);
    const onHead = (box.min.y - whole.min.y) / tall > 0.8;
    let g = mesh.geometry.clone();
    for (const key of Object.keys(g.attributes)) if (!['position', 'skinIndex', 'skinWeight'].includes(key)) g.deleteAttribute(key);
    g.morphAttributes = {};
    g = toCreasedNormals(g, THREE.MathUtils.degToRad(50));
    const name = mesh.material.name || '', kind = KEEP.test(name) ? 1 : onHead && KIND(name) === 1 ? 2 : KIND(name);
    if (kind === 1 && !KEEP.test(name) && !slots.has(name)) slots.set(name, slots.size % 3);
    const slot = kind === 1 && !KEEP.test(name) ? slots.get(name) : -1;
    const c = (mesh.material.color || new THREE.Color(1, 1, 1)).clone(), n = g.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('kind', new THREE.BufferAttribute(new Float32Array(n).fill(kind), 1));
    g.setAttribute('slot', new THREE.BufferAttribute(new Float32Array(n).fill(slot), 1));
    return g;
  });
  const merged = mergeGeometries(geos, false);
  const keep = parts[0];
  keep.geometry = merged;
  keep.material = personMaterial();
  parts.slice(1).forEach((p) => p.parent.remove(p));
  return { scene, animations: gltf.animations, scale: height / Math.max(0.1, tall) };   // measured before the merge
}

// skin a little satin, clothes matte, hair with a sheen, glossy eyes. With a `look` ({ skin, hair, cloth: [3] }, sRGB
// strings), skin, hair and the recolourable garments take those colours instead of the model's own.
function personMaterial(look = null) {
  const m = new THREE.MeshStandardNodeMaterial();
  const kind = attribute('kind', 'float'), slot = attribute('slot', 'float');
  const is = (k) => step(k - 0.5, kind).mul(step(kind, k + 0.5));
  let color = vertexColor();
  if (look) {
    const col = (hex) => uniform(new THREE.Color(hex));
    const garment = mix(mix(col(look.cloth[0]), col(look.cloth[1]), step(0.5, slot)), col(look.cloth[2]), step(1.5, slot));
    color = mix(mix(mix(color, col(look.skin), is(0)), col(look.hair), is(2)), garment, is(1).mul(step(-0.5, slot)));
  }
  m.colorNode = color;
  m.roughnessNode = float(0.88).sub(is(0).mul(0.36)).sub(is(2).mul(0.46)).sub(is(3).mul(0.72)).sub(is(4).mul(0.58));
  m.metalnessNode = is(4).mul(0.9);
  return m;
}

// a random but plausible look for a passer-by
export function randomLook(r) {
  const pick = (list) => list[Math.floor(r() * list.length)];
  const cloth = [];
  while (cloth.length < 3) { const c = pick(CLOTH); if (!cloth.includes(c)) cloth.push(c); }   // garments in different colours
  return { skin: pick(SKIN), hair: pick(HAIR), cloth };
}

export class PersonRig {
  constructor(template, look = null) {
    this.root = new THREE.Group();
    const body = cloneSkinned(template.scene);
    body.scale.setScalar(template.scale);
    body.traverse((o) => {
      if (!o.isMesh) return;
      if (look) o.material = personMaterial(look);
      o.castShadow = true;
      // cull people out of view: a generous sphere around the bind pose covers every animation
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      o.boundingSphere = o.geometry.boundingSphere.clone();
      o.boundingSphere.radius *= 1.35;
      o.frustumCulled = true;
    });
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

// roughly inside the camera's view cone (buildings in the way are ignored, so this errs on the side of "seen")
const toPoint = new THREE.Vector3(), camFwd = new THREE.Vector3();
export function inView(camera, x, z) {
  toPoint.set(x - camera.position.x, 1 - camera.position.y, z - camera.position.z);
  if (toPoint.lengthSq() > 160 * 160) return false;
  camera.getWorldDirection(camFwd);
  return toPoint.normalize().dot(camFwd) > Math.cos(THREE.MathUtils.degToRad(camera.fov * 0.5 * Math.max(1, camera.aspect) + 8));
}

const EDGE = CITY.BLOCK / 2 - 2.6;     // people walk 2.6 m inside the block edge (trees sit at 1.7 m)
const PERIM = EDGE * 8;

export class Crowd {
  constructor({ scene, world, RAPIER }, people, count) {
    this.scene = scene; this.world = world; this.RAPIER = RAPIER; this.people = people; this.rand = rng(57);
    this.doors = []; this.stops = [];
    const canopy = new THREE.ConeGeometry(0.62, 0.32, 10, 1, true).translate(0, 2.18, 0);
    const stick = new THREE.CylinderGeometry(0.015, 0.015, 0.95, 5).translate(0, 1.7, 0);
    this.umbrellaGeo = { canopy, stick };
    this.umbrellaMats = ['#14182c', '#7a1f2b', '#1f4a44', '#e2b25c', '#2e3c74'].map((c) => new THREE.MeshStandardNodeMaterial({ color: c, roughness: 0.5, side: THREE.DoubleSide }));
    this.list = [];
    this.bubbles = new Bubbles(scene);
    this.setCount(count);
  }

  setCount(n) {
    while (this.list.length < n) {
      const variant = STREET[this.list.length % STREET.length];
      const rig = new PersonRig(this.people[variant], randomLook(this.rand));
      this.scene.add(rig.root);
      // a solid body: the player on foot bumps into people instead of walking through them
      const body = this.world.createRigidBody(this.RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -30, 0));
      this.world.createCollider(this.RAPIER.ColliderDesc.capsule(0.55, 0.3).setCollisionGroups(GROUPS.person), body);
      // an umbrella for rainy days (most people carry one)
      const k = this.list.length, umbrella = new THREE.Group();
      umbrella.add(new THREE.Mesh(this.umbrellaGeo.canopy, this.umbrellaMats[k % this.umbrellaMats.length]), new THREE.Mesh(this.umbrellaGeo.stick, this.umbrellaMats[0]));
      umbrella.position.set(0.18, 0, 0.12); umbrella.visible = false; rig.root.add(umbrella);
      this.list.push({ rig, body, umbrella, carries: k % 10 < 7, pos: new THREE.Vector3(), yaw: 0, s: 0, dir: 1, speed: 1.3, mode: 'walk', timer: 0, flee: 0, waved: false, placed: false, anim: 0 });
    }
    this.list.forEach((p, k) => { p.rig.root.visible = k < n; if (k >= n) p.body.setNextKinematicTranslation({ x: 0, y: -30, z: 0 }); });
    this.count = n;
  }

  // a person on a sidewalk of the blocks around the player, preferably 15–60 m away and out of the camera's view, so
  // the street near the player stays busy and nobody pops up in sight
  respawn(p, centre) {
    const r = this.rand, cam = this.game?.ctx.camera;
    const ci = Math.round((centre.x + CITY.HALF - CITY.ROAD - CITY.BLOCK / 2) / CITY.PITCH);
    const cj = Math.round((centre.z + CITY.HALF - CITY.ROAD - CITY.BLOCK / 2) / CITY.PITCH);
    let best = null;
    for (let tries = 0; tries < 16; tries++) {
      const i = THREE.MathUtils.clamp(ci + Math.floor(r() * 3) - 1, 0, CITY.N - 1);
      const j = THREE.MathUtils.clamp(cj + Math.floor(r() * 3) - 1, 0, CITY.N - 1);
      if (isCampus(i, j) && r() > 0.4) continue;
      p.bx = blockAt(i); p.bz = blockAt(j); p.s = r() * PERIM;
      const L = this.loop(p), d = Math.hypot(L.x - centre.x, L.z - centre.z);
      const score = (d < 15 ? 3 : d > 60 ? 1 + (d - 60) / 20 : 0) + (cam && inView(cam, L.x, L.z) ? 1.5 : 0);
      if (!best || score < best.score) best = { score, bx: p.bx, bz: p.bz, s: p.s };
      if (score === 0) break;
    }
    p.mode = 'walk'; p.partner = null; p.cross = null;
    if (best) { p.bx = best.bx; p.bz = best.bz; p.s = best.s; }
    p.dir = r() < 0.5 ? 1 : -1;
    p.speed = 1.15 + r() * 0.5; p.flee = 0; p.waved = false;
    p.mode = r() < 0.72 ? 'walk' : 'idle';
    p.timer = 6 + r() * 20;
    p.placed = true;
    const L = this.loop(p); p.pos.set(L.x, CITY.CURB, L.z); p.yaw = Math.atan2(L.fx, L.fz);
    p.jog = null; p.out = null;
    // joggers circle the campus park
    const park = { x: blockAt(5), z: blockAt(6) };
    const joggers = this.list.filter((q) => q.mode === 'jog').length;
    if (joggers < 3 && Math.hypot(park.x - centre.x, park.z - centre.z) < 170 && r() < 0.16) {
      p.mode = 'jog'; p.jog = { a: r() * Math.PI * 2, dir: r() < 0.5 ? 1 : -1, x: park.x, z: park.z };
      return;
    }
    // others step out of a building door and join the sidewalk
    const door = this.doors.find((dd) => Math.hypot(dd.x - centre.x, dd.z - centre.z) < 120 && r() < 0.25);
    if (door) {
      p.mode = 'out'; p.out = { t: 0, from: new THREE.Vector3(door.x, CITY.CURB, door.z), dir: door.face };
      p.pos.copy(p.out.from); p.yaw = door.face;
      const near = (v) => blockAt(THREE.MathUtils.clamp(Math.round((v - blockAt(0)) / CITY.PITCH), 0, CITY.N - 1));
      p.bx = near(door.x); p.bz = near(door.z);
      return;
    }
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
    const rainy = game.weather.p.rain > 0.3;
    // fewer people about late at night
    const hour = game.clock.hour, quiet = hour < 6 || hour > 23 ? 0.45 : hour < 7.5 || hour > 21.5 ? 0.75 : 1;
    this.visibleCount = Math.round(this.count * quiet);
    for (let k = 0; k < this.count; k++) {
      const p = this.list[k];
      const off = k >= this.visibleCount;
      if (p.rig.root.visible === off) { p.rig.root.visible = !off; if (off) { this.unpair(p); p.body.setNextKinematicTranslation({ x: 0, y: -30, z: 0 }); } }
      if (off) continue;
      if (!p.placed || p.pos.distanceToSquared(player) > 100 * 100) { this.unpair(p); this.respawn(p, player); }
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
      } else if (p.mode === 'jog') {
        const j = p.jog; speed = 3.3;
        j.a += j.dir * speed / 27 * dt;
        p.pos.set(j.x + Math.cos(j.a) * 27, CITY.CURB, j.z + Math.sin(j.a) * 27);
        p.yaw = turn(p.yaw, Math.atan2(-Math.sin(j.a) * j.dir, Math.cos(j.a) * j.dir), dt * 8);
      } else if (p.mode === 'out') {
        // walk out of the doorway towards the kerb, then carry on along the sidewalk
        const o = p.out; o.t += dt; speed = 1.3;
        p.pos.x += Math.sin(o.dir) * speed * dt; p.pos.z += Math.cos(o.dir) * speed * dt;
        if (o.t > 2.2) { this.resync(p); p.mode = 'walk'; p.timer = 10 + this.rand() * 20; }
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
      p.body.setNextKinematicTranslation({ x: p.pos.x, y: CITY.CURB + 0.86, z: p.pos.z });
      p.umbrella.visible = p.carries && rainy && p.mode !== 'jog';
      // animation level of detail: every frame up close, every third frame further away, frozen beyond 90 m
      p.anim += dt;
      const every = d < 40 ? 0 : d < 90 ? 0.05 : Infinity;
      if (p.anim >= every) { p.rig.animate(p.anim, speed, { waving, talking }); p.anim = 0; }
    }
    this.bubbles.update(dt, game.ctx.camera);
  }

  // the player's car stops before reaching a person (soft automatic braking) and the person steps away
  guardCar(car, dt) {
    const p0 = car.position, f = car.forward, r = car.right, v = car.speed;
    if (Math.abs(v) < 0.3) return;
    const sign = v > 0 ? 1 : -1;
    let limit = Infinity;
    for (let k = 0; k < (this.visibleCount ?? this.count); k++) {
      const p = this.list[k];
      const dx = p.pos.x - p0.x, dz = p.pos.z - p0.z;
      if (dx * dx + dz * dz > 400) continue;
      const ahead = (dx * f.x + dz * f.z) * sign, lat = Math.abs(dx * r.x + dz * r.z);
      if (ahead > 0 && lat < 1.45 && ahead < 3.2 + Math.abs(v) * 0.35) {
        limit = Math.min(limit, Math.max(0, (ahead - 3.0) * 2.2));
        if (p.flee <= 0 && Math.abs(v) > 1) this.startFlee(p, p0);
      }
    }
    if (limit < Math.abs(v)) {
      const lv = car.body.linvel(), cut = (Math.abs(v) - limit) * sign;
      car.body.setLinvel({ x: lv.x - f.x * cut, y: lv.y, z: lv.z - f.z * cut }, true);
      car.lastVel.set(lv.x - f.x * cut, lv.y, lv.z - f.z * cut);   // a gentle stop, not a crash
    }
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
const BUBBLE_NDC = new THREE.Vector3();
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
  update(dt, camera) {
    for (const b of this.pool) {
      if (b.life <= 0) continue;
      b.life -= dt;
      const p = b.who.pos;
      b.sprite.position.set(p.x, CITY.CURB + 2.25, p.z);
      if (camera) {
        // keep the whole bubble on screen: near the edge it slides in sideways instead of being cut off
        const v = BUBBLE_NDC.copy(b.sprite.position).project(camera);
        const dist = camera.position.distanceTo(b.sprite.position);
        const half = b.sprite.scale.x / 2 / (dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
        const lim = Math.max(0, 0.98 - half);
        if (v.z < 1 && Math.abs(v.x) > lim && Math.abs(v.x) < 1 + half) { v.x = THREE.MathUtils.clamp(v.x, -lim, lim); b.sprite.position.copy(v.unproject(camera)); }   // only bubbles already partly in view
      }
      b.sprite.material.opacity = Math.min(1, b.life * 3);
      if (b.life <= 0) b.sprite.visible = false;
    }
  }
}
