// Traffic vehicle models built in code: sedan, SUV, van, taxi and bus. Each type gives a painted body, a glass
// greenhouse, a trim part (mirrors, plates, grille, bumpers; vertex-coloured) and its lights, plus wheel positions.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const TYPES = {
  sedan: { L: 4.6, W: 1.84, wheelbase: 2.75, r: 0.34, body: [[-2.3, 0.3], [-2.32, 0.72], [-1.95, 0.92], [-1.3, 0.96], [1.05, 0.93], [2.2, 0.74], [2.32, 0.42], [2.25, 0.3]],
    cabin: [[-1.38, 0.95], [-0.85, 1.42], [0.5, 1.44], [1.1, 0.93]], cabinW: 1.6, weight: 0.4 },
  suv: { L: 4.75, W: 1.92, wheelbase: 2.85, r: 0.39, body: [[-2.35, 0.36], [-2.38, 1.0], [-2.1, 1.08], [1.0, 1.08], [2.2, 0.95], [2.38, 0.6], [2.3, 0.36]],
    cabin: [[-2.15, 1.07], [-2.0, 1.74], [0.55, 1.76], [1.15, 1.07]], cabinW: 1.72, weight: 0.25 },
  van: { L: 5.1, W: 2.0, wheelbase: 3.2, r: 0.37, body: [[-2.55, 0.36], [-2.57, 1.15], [1.55, 1.15], [2.4, 0.95], [2.55, 0.6], [2.48, 0.36]],
    cabin: [[-2.5, 1.14], [-2.48, 2.12], [0.9, 2.12], [1.7, 1.14]], cabinW: 1.86, glassFront: true, weight: 0.12 },
  taxi: { base: 'sedan', paint: '#f2c230', roofSign: true, weight: 0.15 },
  bus: { L: 11.6, W: 2.5, wheelbase: 6.6, r: 0.5, body: [[-5.8, 0.38], [-5.82, 1.25], [5.75, 1.25], [5.82, 0.38]],
    cabin: [[-5.75, 1.24], [-5.75, 2.9], [5.7, 2.9], [5.8, 1.24]], cabinW: 2.42, paint: '#1f6fb2', weight: 0.08, tall: true },
};
export const TYPE_NAMES = Object.keys(TYPES);

function profile(points, arches, r) {
  const s = new THREE.Shape();
  const bottom = points[0][1];
  s.moveTo(points[0][0], bottom);
  // along the bottom from rear to front, cutting the wheel arches
  arches.forEach((ax) => { s.lineTo(ax - r - 0.08, bottom); s.absarc(ax, bottom + 0.04, r + 0.08, Math.PI, 0, true); });
  const last = points[points.length - 1];
  s.lineTo(last[0], bottom);
  for (let k = points.length - 1; k >= 1; k--) s.lineTo(points[k][0], points[k][1]);
  s.closePath();
  return s;
}

function extrude(shape, width, bevel) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 10 });
  g.rotateY(-Math.PI / 2);
  g.translate(width / 2, 0, 0);
  return g;
}

function box(w, h, d, x, y, z, color) {
  const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  const c = new THREE.Color(color), n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

export function buildVehicle(name) {
  const def = TYPES[name].base ? { ...TYPES[TYPES[name].base], ...TYPES[name] } : TYPES[name];
  const half = def.wheelbase / 2;
  const body = extrude(profile(def.body, [-half, half], def.r), def.W - 0.12, 0.06);
  const glass = extrude(new THREE.Shape(def.cabin.map(([x, y]) => new THREE.Vector2(x, y))), def.cabinW, 0.04);
  const L = def.L / 2, W = def.W / 2, top = Math.max(...def.body.map((p) => p[1]));
  const front = def.body[def.body.length - 2][1];
  const trim = [
    box(def.W * 0.98, 0.16, 0.12, 0, 0.36, L - 0.02, '#1a1b1f'), box(def.W * 0.98, 0.16, 0.12, 0, 0.36, -L + 0.02, '#1a1b1f'),   // bumpers
    box(0.52, 0.12, 0.02, 0, 0.5, L + 0.05, '#e9e9e2'), box(0.52, 0.12, 0.02, 0, 0.55, -L - 0.05, '#e9e9e2'),               // plates
    box(def.W * 0.42, 0.14, 0.03, 0, Math.max(0.55, front - 0.22), L + 0.02, '#0c0d10'),                                  // grille
    box(0.06, 0.12, 0.22, -W - 0.04, top + 0.1, def.cabin[def.cabin.length - 1][0] - 0.25, '#15161a'),                     // mirrors
    box(0.06, 0.12, 0.22, W + 0.04, top + 0.1, def.cabin[def.cabin.length - 1][0] - 0.25, '#15161a'),
  ];
  if (def.roofSign) trim.push(box(0.6, 0.18, 0.28, 0, def.cabin[1][1] + 0.12, -0.1, '#f7f3d0'));
  if (def.tall) trim.push(box(def.W * 0.9, 0.35, 0.05, 0, 2.6, L + 0.03, '#0e0f12'));      // bus destination board
  const lights = [
    box(0.32, 0.1, 0.05, -W + 0.28, front - 0.12, L + 0.01, '#f2f6ff'), box(0.32, 0.1, 0.05, W - 0.28, front - 0.12, L + 0.01, '#f2f6ff'),
    box(0.34, 0.12, 0.05, -W + 0.26, 0.75, -L - 0.01, '#ff1428'), box(0.34, 0.12, 0.05, W - 0.26, 0.75, -L - 0.01, '#ff1428'),
  ];
  if (def.roofSign) lights.push(box(0.5, 0.08, 0.3, 0, def.cabin[1][1] + 0.2, -0.1, '#ffd23f'));
  if (def.tall) lights.push(box(def.W * 0.8, 0.22, 0.03, 0, 2.6, L + 0.06, '#ffb020'));
  return {
    def, body, glass, trim: mergeGeometries(trim), lights: mergeGeometries(lights),
    wheels: [[-W + 0.12, half], [W - 0.12, half], [-W + 0.12, -half], [W - 0.12, -half]],
    collider: { hx: def.W / 2, hy: (def.tall ? 1.5 : 0.75), hz: def.L / 2 },
  };
}

export function pickType(r) {
  let x = r * TYPE_NAMES.reduce((a, n) => a + TYPES[n].weight, 0);
  for (const n of TYPE_NAMES) { x -= TYPES[n].weight; if (x <= 0) return n; }
  return 'sedan';
}
