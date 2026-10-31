// IsGame bootstrap and main loop: loads texts and libraries, builds Neo Academia, then runs a fixed 60 Hz physics
// step with interpolated rendering. Every system is created here and talks through the small `game` object.
import * as THREE from 'three/webgpu';
import RAPIER from 'rapier';
import { CONFIG } from './config.js';
import { createRenderer, Pipeline } from './core/renderer.js';
import { PRESETS, initialLevel, AutoQuality, isTouch, effects } from './core/quality.js';
import { Input } from './core/input.js';
import { Audio } from './core/audio.js';
import { save } from './core/save.js';
import { loadLang, t, pickLang } from './core/i18n.js';
import { buildCity } from './world/city.js';
import { loadTextures } from './world/textures.js';
import { loadKit } from './world/kit.js';
import { buildLobby } from './world/interiors.js';
import { buildProps, TrafficLights, buildBusStops, buildHackathon } from './world/props.js';
import { buildLandscape } from './world/landscape.js';
import { buildSky } from './world/sky.js';
import { TimeOfDay } from './world/timeofday.js';
import { Weather } from './world/weather.js';
import { buildSigns } from './world/signs.js';
import { Traffic } from './world/traffic.js';
import { Mentors } from './world/npcs.js';
import { loadPeople, Crowd } from './world/people.js';
import { Car } from './player/car.js';
import { Avatar } from './player/avatar.js';
import { FX, AMBIENT } from './world/fx.js';
import { cullTiles, setDrawScale } from './world/chunks.js';
import { Ambient } from './world/ambient.js';
import { Robots } from './world/robots.js';
import { ChaseCamera } from './player/camera.js';
import { Hud } from './game/hud.js';
import { Dialogue } from './game/dialogue.js';
import { Collectibles } from './game/collectibles.js';
import { Missions } from './game/missions.js';
import { Menu } from './game/menu.js';
import { Achievements, ACHIEVEMENTS } from './game/achievements.js';
import { blockAt } from './world/layout.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');

const progress = (pct, key) => {
  $('boot').querySelector('.progress-bar').style.width = `${pct}%`;
  $('boot').querySelector('.progress').setAttribute('aria-valuenow', String(pct));
  if (key) $('boot-status').textContent = t(key);
};
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

async function boot() {
  save.load();
  const settings = save.data.settings;
  if (isTouch()) document.querySelector('.boot-hint').dataset.i18n = 'boot.hintTouch';   // no keyboard on phones
  await loadLang(pickLang(settings.lang));
  progress(8, 'boot.loadingLibs');
  await Promise.all([
    document.fonts.load('700 64px "Space Grotesk"'), document.fonts.load('64px Allura'),
    RAPIER.init(),
  ]);

  const q = initialLevel(settings.quality);
  let level = q.level;
  const preset = { ...PRESETS[level] };
  progress(18, 'boot.loadingGpu');
  const { renderer, backend } = await createRenderer($('stage'), preset);
  // the WebGL2 fallback cannot hold 60 fps on High in the busiest views: on Auto it starts on Medium
  if (q.auto && backend === 'WebGL2' && level === 'high') { level = 'medium'; Object.assign(preset, PRESETS.medium); }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 3800);
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  const ctx = { scene, world, RAPIER, renderer, camera, preset };

  progress(24, 'boot.loadingTextures');
  const textures = await loadTextures(renderer, (f) => progress(24 + Math.round(f * 6)));
  const kit = await loadKit((f) => progress(30 + Math.round(f * 6)));
  kit.max = { high: 30, medium: 16, low: 6 }[level];   // detailed buildings are ~30k triangles each
  progress(36, 'boot.loadingCity'); await nextFrame();
  const city = buildCity(ctx, textures, kit);
  const props = buildProps(ctx, city.lamps, textures);
  const lights = new TrafficLights(ctx);
  const busStops = buildBusStops(ctx, t);
  const landscape = buildLandscape(ctx);
  const marble = await new THREE.TextureLoader().loadAsync('assets/kit/textures/T_MarbleFloor_BaseColor.jpg').then((tx) => { tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.colorSpace = THREE.SRGBColorSpace; return tx; }).catch(() => null);
  const lobby = buildLobby(ctx, city.tower, { marble }, t);
  buildHackathon(ctx, { x: city.tower.x + 20, z: city.tower.z + 22 }, t);
  const clock = new TimeOfDay(17.4);   // golden hour; night falls about a minute later (24-minute day)
  clock.set(settings.time, settings.cycle);
  const weather = new Weather(settings.weather === 'auto' ? 'clear' : settings.weather);
  weather.set(settings.weather);
  clock.update(0);
  const sky = buildSky(ctx, clock, weather);
  progress(48, 'boot.loadingSigns'); await nextFrame();
  const signs = buildSigns(ctx, city.signAnchors, city.tower, t);

  progress(60, 'boot.loadingLife'); await nextFrame();
  const audio = new Audio();
  const input = new Input(renderer.domElement, $('joy'), [...document.querySelectorAll('#touch .tbtn')]);
  input.sensitivity = settings.sens;
  const traffic = new Traffic(ctx, preset.traffic, busStops);
  progress(64, 'boot.loadingPeople');
  const people = await loadPeople((f) => progress(64 + Math.round(f * 10)));
  const CROWD = { high: 44, medium: 26, low: 12 };
  const walkers = new Crowd(ctx, people, CROWD[level]);
  const robots = new Robots(ctx, { high: 10, medium: 8, low: 4 }[level]);
  walkers.stops = busStops;
  // building doors of the detailed kit buildings: people step out of them
  for (const [name, list] of Object.entries(city.kitPlacements || {})) {
    const m = kit.buildings[name];
    for (const pl of list) walkers.doors.push({ x: pl.x + Math.sin(pl.rot) * (m.d / 2 + 0.4), z: pl.z + Math.cos(pl.rot) * (m.d / 2 + 0.4), face: pl.rot });
  }
  const mentors = new Mentors(ctx, people);

  const car = new Car(ctx, new THREE.Vector3(5.8, 0, blockAt(6) - 4), Math.PI);
  const avatar = new Avatar(ctx, new THREE.Vector3(18, 0.2, blockAt(6) - 18), people, settings.character);
  avatar.facing = -Math.PI * 0.75;
  const chase = new ChaseCamera(camera, ctx);
  const fx = new FX(ctx);
  const ambient = new Ambient(ctx, { fx, audio, tower: city.tower });
  car.fx = fx;
  car.onShift = () => audio.play('shift');
  chase.snap(avatar.facing);

  const pipeline = new Pipeline(renderer, scene, camera);
  const relief = {};   // effects the automatic quality switched off before lowering the level
  const applyGraphics = () => {
    renderer.setPixelRatio(Math.min(devicePixelRatio, preset.pixelRatio) * settings.gfx.scale);
    pipeline.configure(effects(preset, settings.gfx, { backend, relief }));
    setDrawScale(preset.detail);
  };
  applyGraphics();

  // dynamic light pool: the nearest neon signs really light the street and the car
  const pool = [];
  for (let i = 0; i < 6; i++) { const l = new THREE.PointLight(0xffffff, 0, 26, 1.8); scene.add(l); pool.push(l); }

  const game = {
    ctx, city, sky, signs, audio, clock, weather, lights, props, input, traffic, walkers, mentors, car, avatar, chase, save, t, backend,
    mode: 'foot', paused: true, started: false, time: 0, level,
    focus: new THREE.Vector3(),
    get player() { return this.mode === 'car' ? this.car.position : this.avatar.position; },
    get playerSpeed() { return this.mode === 'car' ? Math.abs(this.car.speed) : this.avatar.speed; },
  };
  game.hud = new Hud(game);
  game.dialogue = new Dialogue(game);
  game.collectibles = new Collectibles(game);
  game.missions = new Missions(game);
  game.achievements = new Achievements(game);
  window.__ACH = ACHIEVEMENTS;
  game.applyGraphics = () => applyGraphics();
  game.pipeline = pipeline;
  game.menu = new Menu(game, {
    onQuality(next) { applyQuality(next, false); },
    onLang: async (lang) => { await loadLang(lang); signs.refresh(); game.hud.refreshTexts(); game.missions.refreshObjective(); game.menu.refresh(); },
  });

  function applyQuality(next, auto) {
    if (!PRESETS[next]) return;
    level = game.level = next;
    Object.assign(preset, PRESETS[next]);
    applyGraphics();
    sky.setShadows(preset.shadows);
    sky.rain.setCount(preset.rain);
    traffic.setCount(preset.traffic);
    walkers.setCount(CROWD[next]);
    pool.forEach((l) => { l.visible = preset.lights; });
    if (auto) game.hud.toast(t('hud.qualityAuto', { level: t(`settings.${next}`) }));
  }
  // slow frames: first give up the heaviest effects left on Auto, then step the level down
  const autoQ = new AutoQuality(() => {
    const on = effects(preset, settings.gfx, { backend, relief });
    const drop = ['reflections', 'occlusion'].find((k) => on[k] && settings.gfx[k] === 'auto');
    if (drop) { relief[drop] = true; applyGraphics(); game.hud.toast(t('hud.effectsAuto')); }
    else if (level !== 'low') applyQuality(level === 'high' ? 'medium' : 'low', true);
  });
  autoQ.enabled = q.auto && settings.quality === 'auto';
  game.setAutoQuality = (on) => { autoQ.enabled = on; };

  // warm-up: compile every pipeline before the player sees the city
  progress(78, backend === 'WebGL2' ? 'boot.loadingShadersSlow' : 'boot.loadingShaders'); await nextFrame();
  camera.position.set(30, 6, 60); camera.lookAt(0, 4, 0);
  try { await renderer.compileAsync(scene, camera); } catch { /* compiled lazily instead */ }
  // render a few frames at noon, dusk and night behind the title card so no shader compiles mid-game
  const savedHour = clock.hour, savedMode = clock.mode;
  for (const h of [13, 17.6, 22]) {
    clock.mode = 'fixed'; clock.hour = h; clock.update(0);
    sky.update(0.016, new THREE.Vector3(), camera);
    renderer.toneMappingExposure = sky.exposure(); pipeline.setNight(clock.night);
    pipeline.render(); await nextFrame();
  }
  clock.mode = savedMode; clock.hour = savedHour; clock.update(0);
  ambient.plane.visible = ambient.heli.visible = false;   // shown only for the warm-up; they fly in later
  pipeline.render();
  progress(100, 'boot.ready');

  const playBtn = $('play');
  playBtn.disabled = false;
  playBtn.focus();
  playBtn.addEventListener('click', () => {
    audio.start();
    audio.setVolumes(settings.music, settings.sfx, settings.master, settings.ambience);
    $('boot').hidden = true;
    $('hud').hidden = false;
    if (isTouch()) $('touch').hidden = false;
    game.started = true; game.paused = false;
    renderer.domElement.focus();
    game.missions.start();
  }, { once: true });

  // enter / leave the car
  function toggleCar() {
    if (game.mode === 'foot') {
      if (avatar.position.distanceTo(car.position) > 4.2) return false;
      game.mode = 'car'; car.occupied = true;
      avatar.setEnabled(false);
      audio.play('door');
      chase.snap(car.heading);
      return true;
    }
    if (Math.abs(car.speed) > 6) { game.hud.toast(t('hud.tooFast')); return true; }
    // get out on whichever side is free: driver's door, passenger's door, behind, in front
    const capsule = new RAPIER.Capsule(0.55, 0.32), rot = { x: 0, y: 0, z: 0, w: 1 };
    let p = null;
    for (const off of [[-1.9, 0], [1.9, 0], [0, -3.4], [0, 3.4], [-2.6, -2], [2.6, 2]]) {
      const c = car.position.add(new THREE.Vector3(off[0], 0, off[1]).applyQuaternion(car.root.quaternion));
      const blocked = world.intersectionWithShape({ x: c.x, y: Math.max(c.y - 0.7, 0.2) + 1.0, z: c.z }, rot, capsule, undefined, undefined, undefined, car.body);
      if (!blocked) { p = c; break; }
    }
    if (!p) { game.hud.toast(t('hud.noRoom')); return true; }
    avatar.place(p.x, Math.max(p.y - 0.7, 0.2), p.z, car.heading);
    avatar.setEnabled(true);
    game.mode = 'foot'; car.occupied = false;
    audio.play('door');
    return true;
  }
  game.toggleCar = toggleCar;

  // full map: pauses the city while it is open
  function toggleMap() {
    const box = $('bigmap'), open = box.hidden;
    if (open && (game.paused || game.menu.cardOpen)) return;
    box.hidden = !open;
    game.paused = open; input.enabled = !open;
    if (open) game.hud.drawBigMap(); else renderer.domElement.focus();
  }
  $('bigmap-close').addEventListener('click', () => toggleMap());
  $('bigmap').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); toggleMap(); } });

  // photo mode: no HUD, free framing; the shot is read from the canvas right after a frame is drawn
  let capture = false;
  function togglePhoto() {
    const on = !document.body.classList.contains('photo-mode');
    document.body.classList.toggle('photo-mode', on);
    $('photo').hidden = !on;
  }
  $('photo-shot').addEventListener('click', () => { capture = true; });
  $('photo-exit').addEventListener('click', () => togglePhoto());

  // main loop
  let last = performance.now(), acc = 0, frames = 0, fpsTime = 0, fps = 60;
  const step = 1 / 60;
  const tmp = new THREE.Vector3();
  let lightTimer = 0, lightsTimer = 0;

  renderer.info.autoReset = false;   // one reset per frame so the counters cover every pass
  renderer.setAnimationLoop(() => {
    renderer.info.reset();
    const now = performance.now();
    let dt = Math.min((now - last) / 1000, 0.1); last = now;
    input.update(dt);

    if (input.take('pause') && game.started) game.menu.toggle();
    if (input.take('mute')) game.hud.toast(t(audio.toggleMute() ? 'hud.muted' : 'hud.unmuted'));
    if (input.take('map') && game.started) toggleMap();
    if (input.take('photo') && game.started && !game.paused) togglePhoto();
    if (input.take('radio')) game.hud.toast(t(`radio.${audio.nextStation()}`));

    if (game.started && !game.paused) {
      game.time += dt;
      // interaction: mentor first, then the car
      if (input.take('use')) {
        if (!game.dialogue.open && !game.missions.interact()) toggleCar();
      }
      if (input.take('horn') && game.mode === 'car') { audio.play('horn'); traffic.honk(car.position); walkers.scare(car.position, 14); }
      if (input.take('reset') && game.mode === 'car') car.reset();
      if (input.take('camera')) chase.cycle();

      acc += dt;
      let steps = 0;
      while (acc >= step && steps < 4) {
        if (game.mode === 'car') {
          car.drive({ throttle: input.throttle, brake: input.brake, steer: input.axis.x, handbrake: input.jump }, step, weather.wet);
          walkers.guardCar(car, step);
        } else {
          car.idle(step);
          const { f, r } = chase.basis();
          const mv = { x: f.x * input.axis.y + r.x * input.axis.x, z: f.z * input.axis.y + r.z * input.axis.x };
          avatar.update(step, mv, { sprint: input.sprint, jump: input.jump }, () => audio.play('step'));
        }
        traffic.update(step, game);
        world.step();
        acc -= step; steps++;
      }
      if (steps === 4) acc = 0;

      car.sync(dt, weather.wet);
      fx.update(dt, camera);
      cullTiles(camera);
      if (game.mode === 'foot') avatar.sync(dt);
      const hit = car.takeImpact();
      if (hit > 0.05) {
        audio.play('hit', hit); chase.bump(hit);
        // sparks where the body met the obstacle (the side the speed was lost towards)
        if (hit > 0.2) { const at = car.position.addScaledVector(car.impactDir, 2.0); at.y += 0.4; fx.sparks(at, car.impactDir, hit); audio.play('scrape', hit); }
        if (input.vibration !== false && navigator.vibrate && input.lastDevice === 'touch') navigator.vibrate(Math.round(20 + hit * 60));
      }
      audio.updateVehicle(game.mode === 'car', Math.abs(car.speed), input.throttle, car.slip, game.mode === 'car' ? car.rpm : 0);

      const look = input.consumeLook();
      if (game.mode === 'car') {
        game.focus.copy(car.position).add(tmp.set(0, 0.9, 0));
        chase.update(dt, look, { mode: 'car', focus: game.focus, heading: car.heading, speed: car.speed, exclude: car.body });
      } else {
        game.focus.copy(avatar.position).add(tmp.set(0, 1.55, 0));
        chase.update(dt, look, { mode: 'foot', focus: game.focus, heading: avatar.facing, speed: avatar.speed, exclude: avatar.body });
      }

      walkers.update(dt, game);
      robots.update(dt, { player: game.player, people: walkers.list.slice(0, walkers.visibleCount ?? walkers.count) });
      mentors.update(dt, game);
      game.collectibles.update(dt);
      game.missions.update(dt);
      game.hud.update(dt);

      // move the light pool to the closest signs every quarter second
      lightTimer -= dt;
      if (lightTimer <= 0 && preset.lights) {
        lightTimer = 0.25;
        const p = game.player;
        const near = signs.lights.map((s) => ({ s, d: (s.x - p.x) ** 2 + (s.z - p.z) ** 2 })).sort((a, b) => a.d - b.d).slice(0, pool.length);
        pool.forEach((l, i) => {
          const n = near[i];
          if (!n) { l.intensity = 0; return; }
          l.position.set(n.s.x, n.s.y, n.s.z); l.color.copy(n.s.color);
          l.userData.target = 30 * clock.night;   // the soft spill of a lit shop sign on the pavement
        });
      }
      pool.forEach((l) => { l.intensity = THREE.MathUtils.damp(l.intensity, l.userData.target || 0, 4, dt); });
    } else if (!game.started) {
      // title screen: slow drone flight over the avenue
      const a = now / 1000 * 0.05;
      camera.position.set(Math.sin(a) * 120, 38 + Math.sin(a * 2) * 6, Math.cos(a) * 120);
      camera.lookAt(0, 30, 0);
    }

    // clock and weather run on the title screen too, so the backdrop is alive
    if (!game.paused || !game.started) {
      const before = clock.hour;
      clock.update(dt);
      const hours = ((clock.hour - before) + 24) % 24;
      weather.update(dt, hours, (delay, strength) => setTimeout(() => audio.play('thunder', strength), delay * 1000));
    }
    sky.update(dt, game.started ? game.player : tmp.set(0, 0, 0), camera);
    renderer.toneMappingExposure = sky.exposure();
    pipeline.setNight(clock.night);
    car.spot.intensity = 40 + 220 * clock.night;
    AMBIENT.value = 1 - clock.night * 0.78;
    // indoors: no rain falling on the camera and the rain only muffled through the glass
    const indoors = lobby.contains(camera.position, 0.5);
    if (game.started && lobby.contains(game.player)) game.achievements.unlock('lobby');
    if (game.started) game.achievements.update(dt);
    sky.rain.setOn(!indoors);
    audio.setRain(game.started ? weather.p.rain * (indoors ? 0.3 : 1) : 0);
    props.wind.value = 0.6 + weather.p.rain * 0.6 + weather.p.storm * 1.4;
    landscape.update(dt, game.time, game.started ? game.player : camera.position, clock.night);
    signs.update(dt);
    if (!game.paused) ambient.update(dt, { camera, player: game.started ? game.player : camera.position, car, driving: game.mode === 'car', weather, night: clock.night, traffic, crowd: walkers, indoors, time: game.time });
    lightsTimer -= dt;
    if (lightsTimer <= 0) { lightsTimer = 0.25; lights.update(game.time); }
    audio.setNight(clock.night);
    pipeline.render();
    if (capture) {
      capture = false;
      renderer.domElement.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = `neo-academia-${Date.now()}.png`; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        game.hud.toast(t('photo.saved'), 'good'); game.achievements.unlock('photo');
      });
    }

    frames++; fpsTime += dt;
    if (fpsTime >= 0.5) {
      fps = frames / fpsTime; frames = 0; fpsTime = 0;
      game.fps = fps;
      if (game.started && !game.paused) game.hud.setFps(fps, renderer.info);
    }
    if (game.started && !game.paused) autoQ.sample(dt);
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.started && !game.paused) game.menu.open();
  });

  if (DEBUG) {
    window.__isgame = {
      game, THREE,
      teleport(x, z) { if (game.mode === 'car') car.teleport(x, z, car.heading); else avatar.place(x, 0.2, z); },
      complete(id) { game.missions.debugComplete(id); },
      collectAll() { game.collectibles.debugCollectAll(); },
      time(h) { clock.mode = 'fixed'; clock.hour = h; },
      sky(state) { weather.set(state); weather.p = { ...weather.p, ...((s) => s)(Object.fromEntries(Object.entries(weather.p))) }; },
      info() { return { backend, level, fps: Math.round(game.fps), calls: renderer.info.render.drawCalls, triangles: renderer.info.render.triangles, mode: game.mode, player: game.player.toArray().map((v) => +v.toFixed(1)) }; },
    };
    $('fps').hidden = false;
  }
  console.info(`IsGame ${CONFIG.VERSION} · ${backend} · ${level}`);
}

boot().catch((err) => {
  console.error(err);
  const box = $('boot-error');
  box.hidden = false;
  box.textContent = `${t('boot.error')} (${err && err.message ? err.message : err})`;
  $('boot-status').textContent = '';
});
