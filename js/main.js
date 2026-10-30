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
import { buildProps, TrafficLights } from './world/props.js';
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
import { ChaseCamera } from './player/camera.js';
import { Hud } from './game/hud.js';
import { Dialogue } from './game/dialogue.js';
import { Collectibles } from './game/collectibles.js';
import { Missions } from './game/missions.js';
import { Menu } from './game/menu.js';
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
  const props = buildProps(ctx, city.lamps);
  const lights = new TrafficLights(ctx);
  const landscape = buildLandscape(ctx);
  const marble = await new THREE.TextureLoader().loadAsync('assets/kit/textures/T_MarbleFloor_BaseColor.jpg').then((tx) => { tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.colorSpace = THREE.SRGBColorSpace; return tx; }).catch(() => null);
  const lobby = buildLobby(ctx, city.tower, { marble }, t);
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
  const traffic = new Traffic(ctx, preset.traffic);
  progress(64, 'boot.loadingPeople');
  const people = await loadPeople((f) => progress(64 + Math.round(f * 10)));
  const CROWD = { high: 28, medium: 18, low: 10 };
  const walkers = new Crowd(ctx, people, CROWD[level]);
  const mentors = new Mentors(ctx, people);

  const car = new Car(ctx, new THREE.Vector3(5.8, 0, blockAt(6) - 4), Math.PI);
  const avatar = new Avatar(ctx, new THREE.Vector3(18, 0.2, blockAt(6) - 18), people, settings.character);
  avatar.facing = -Math.PI * 0.75;
  const chase = new ChaseCamera(camera, ctx);
  chase.snap(avatar.facing);

  const pipeline = new Pipeline(renderer, scene, camera);
  const applyGraphics = () => {
    renderer.setPixelRatio(Math.min(devicePixelRatio, preset.pixelRatio) * settings.gfx.scale);
    pipeline.configure(effects(preset, settings.gfx));
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
  const autoQ = new AutoQuality((next) => applyQuality(next, true));
  autoQ.enabled = q.auto && settings.quality === 'auto';
  game.setAutoQuality = (on) => { autoQ.enabled = on; };

  // warm-up: compile every pipeline before the player sees the city
  progress(78, 'boot.loadingShaders'); await nextFrame();
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
  pipeline.render();
  progress(100, 'boot.ready');

  const playBtn = $('play');
  playBtn.disabled = false;
  playBtn.focus();
  playBtn.addEventListener('click', () => {
    audio.start();
    audio.setVolumes(settings.music, settings.sfx);
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
    const side = new THREE.Vector3(-1.9, 0, 0).applyQuaternion(car.root.quaternion);
    const p = car.position.add(side);
    avatar.place(p.x, Math.max(p.y - 0.7, 0.2), p.z, car.heading);
    avatar.setEnabled(true);
    game.mode = 'foot'; car.occupied = false;
    audio.play('door');
    return true;
  }
  game.toggleCar = toggleCar;

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
          car.drive({ throttle: input.throttle, brake: input.brake, steer: input.axis.x, handbrake: input.jump }, step);
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

      car.sync();
      if (game.mode === 'foot') avatar.sync(dt);
      if (car.impact > 0.05) { audio.play('hit', car.impact); chase.bump(car.impact); if (navigator.vibrate && input.lastDevice === 'touch') navigator.vibrate(30); }
      audio.updateVehicle(game.mode === 'car', Math.abs(car.speed), input.throttle, car.slip);

      const look = input.consumeLook();
      if (game.mode === 'car') {
        game.focus.copy(car.position).add(tmp.set(0, 0.9, 0));
        chase.update(dt, look, { mode: 'car', focus: game.focus, heading: car.heading, speed: car.speed, exclude: car.body });
      } else {
        game.focus.copy(avatar.position).add(tmp.set(0, 1.55, 0));
        chase.update(dt, look, { mode: 'foot', focus: game.focus, heading: avatar.facing, speed: avatar.speed, exclude: avatar.body });
      }

      walkers.update(dt, game);
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
          l.userData.target = 120 * clock.night;
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
    // indoors: no rain falling on the camera and the rain only muffled through the glass
    const indoors = lobby.contains(camera.position, 0.5);
    sky.rain.setOn(!indoors);
    audio.setRain(game.started ? weather.p.rain * (indoors ? 0.3 : 1) : 0);
    props.wind.value = 0.6 + weather.p.rain * 0.6 + weather.p.storm * 1.4;
    landscape.update(dt, game.time, game.started ? game.player : camera.position, clock.night);
    lightsTimer -= dt;
    if (lightsTimer <= 0) { lightsTimer = 0.25; lights.update(game.time); }
    audio.setNight(clock.night);
    pipeline.render();

    frames++; fpsTime += dt;
    if (fpsTime >= 0.5) {
      fps = frames / fpsTime; frames = 0; fpsTime = 0;
      game.fps = fps;
      if (game.started && !game.paused) game.hud.setFps(fps, renderer.info);
    }
    if (game.started && !game.paused) autoQ.sample(dt, level);
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
