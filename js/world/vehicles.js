// Traffic vehicle models built in code: sedan, SUV, van, taxi and bus. The body is lofted from rounded cross-sections
// along the car (a superellipse that is boxier for vans and buses), with real wheel arches cut out of its lower edge,
// a greenhouse that narrows towards the roof, glass windows framed by A, B and C pillars, and dark plastic sills and
// lower bumpers. The `part` attribute tells the material what each vertex is: 0 paint, 1 black plastic, 2 glass (so a
// window blends into the paint through a thin black seal).
// Each type also gives a trim part (plates, grille, mirrors, handles; vertex-coloured), its lights and wheel positions.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// top: side profile of the lower body [z, y]; roof: the greenhouse [z, y] from its rear base to its front base;
// pillar: z of the B pillar(s); n: roundness of the sections (2 = ellipse, higher = boxier); ride: sill height
export const TYPES = {
  sedan: { L: 4.6, W: 1.82, wheelbase: 2.72, r: 0.33, ride: 0.3, n: 3.2, tumble: 0.8,
    top: [[-2.3, 0.74], [-2.2, 0.93], [-1.7, 0.98], [-1.2, 0.97], [0.95, 0.93], [1.6, 0.87], [2.15, 0.8], [2.3, 0.68]],
    roof: [[-1.75, 0.98], [-1.05, 1.4], [0.25, 1.44], [1.12, 0.93]], pillar: [-0.38], weight: 0.4 },
  suv: { L: 4.75, W: 1.92, wheelbase: 2.84, r: 0.38, ride: 0.42, n: 3.8, tumble: 0.84,
    top: [[-2.37, 0.85], [-2.3, 1.08], [-1.8, 1.12], [1.05, 1.1], [1.7, 1.04], [2.25, 0.96], [2.37, 0.75]],
    roof: [[-2.22, 1.11], [-2.05, 1.76], [0.55, 1.8], [1.18, 1.1]], pillar: [-0.5, -1.45], weight: 0.25 },
  van: { L: 5.1, W: 2.0, wheelbase: 3.2, r: 0.36, ride: 0.4, n: 5, tumble: 0.92,
    top: [[-2.55, 1.0], [-2.52, 1.15], [1.5, 1.16], [2.15, 1.05], [2.45, 0.95], [2.55, 0.7]],
    roof: [[-2.5, 1.15], [-2.47, 2.12], [0.95, 2.14], [1.75, 1.15]], pillar: [0.35], panelsBehind: 0.2, weight: 0.12 },
  taxi: { base: 'sedan', paint: '#f2c230', roofSign: true, weight: 0.15 },
  // the player's car: a low two-door fastback (not in the traffic)
  coupe: { L: 4.5, W: 1.9, wheelbase: 2.63, r: 0.36, ride: 0.24, n: 3.4, tumble: 0.76,
    top: [[-2.25, 0.76], [-2.15, 0.9], [-1.6, 0.96], [-1.0, 0.95], [0.9, 0.88], [1.6, 0.8], [2.1, 0.7], [2.25, 0.56]],
    roof: [[-2.0, 0.96], [-0.85, 1.27], [0.05, 1.29], [1.0, 0.88]], pillar: [-0.62], weight: 0 },
  bus: { L: 11.6, W: 2.5, wheelbase: 6.4, r: 0.5, ride: 0.42, n: 7, tumble: 0.97, step: 0.14,
    top: [[-5.8, 1.15], [-5.75, 1.25], [5.72, 1.25], [5.8, 1.15]],
    roof: [[-5.78, 1.24], [-5.76, 2.95], [5.66, 2.95], [5.79, 1.24]], pillar: [-3.6, -1.2, 1.2, 3.6], roofBand: 2.55, paint: '#1f6fb2', weight: 0.08, tall: true },
};
export const TYPE_NAMES = Object.keys(TYPES).filter((n) => TYPES[n].weight > 0);

// smooth profile through the points (centripetal Catmull-Rom), looked up by z
function profile(points) {
  const curve = new THREE.CatmullRomCurve3(points.map(([z, y]) => new THREE.Vector3(z, y, 0)), false, 'centripetal');
  const table = curve.getPoints(240).sort((a, b) => a.x - b.x);
  return (z) => {
    if (z <= table[0].x) return table[0].y;
    for (let k = 1; k < table.length; k++) {
      if (z <= table[k].x) { const a = table[k - 1], b = table[k], t = (z - a.x) / Math.max(b.x - a.x, 1e-6); return a.y + (b.y - a.y) * t; }
    }
    return table[table.length - 1].y;
  };
}
// superellipse: |cos|^(2/n), keeping the sign
const se = (c, n) => Math.sign(c) * Math.pow(Math.abs(c), 2 / n);

// loft rings of `count` points along `stations`; ring(z) returns [[x, y, part], ...]; the ends are closed by fans
function loft(stations, ring, closed) {
  const pos = [], part = [], idx = [];
  let count = 0;
  stations.forEach((z) => { const pts = ring(z); count = pts.length; pts.forEach(([x, y, p]) => { pos.push(x, y, z); part.push(p); }); });
  const rings = stations.length;
  for (let i = 0; i < rings - 1; i++) for (let j = 0; j < count - (closed ? 0 : 1); j++) {
    const a = i * count + j, b = i * count + ((j + 1) % count), c = a + count, d = b + count;
    idx.push(a, b, c, b, d, c);   // outward: rings run counter-clockwise seen from the front (+z)
  }
  // end caps: a fan around each end ring's centre
  [0, rings - 1].forEach((i, e) => {
    let cx = 0, cy = 0;
    for (let j = 0; j < count; j++) { cx += pos[(i * count + j) * 3]; cy += pos[(i * count + j) * 3 + 1]; }
    const centre = pos.length / 3;
    pos.push(cx / count, cy / count, stations[i]); part.push(0);
    for (let j = 0; j < count - (closed ? 0 : 1); j++) {
      const a = i * count + j, b = i * count + ((j + 1) % count);
      if (e === 0) idx.push(centre, b, a); else idx.push(centre, a, b);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('part', new THREE.Float32BufferAttribute(part, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
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

// side profile (top, bottom with the wheel arches) and half-width along the car
function shapeOf(def) {
  const L = def.L / 2, half = def.wheelbase / 2, arches = [-half, half];
  const top = profile(def.top);
  // wheel arches: the sill rises in a circle over each wheel
  const bottom = (z) => {
    let y = def.ride + (Math.abs(z) > L - 0.45 ? (Math.abs(z) - (L - 0.45)) * 0.15 : 0);
    for (const a of arches) { const d = z - a, R = def.r + 0.07; if (Math.abs(d) < R) y = Math.max(y, def.r + Math.sqrt(R * R - d * d)); }
    return y;
  };
  // the body narrows a little at the very ends (rounded corners seen from above)
  const width = (z) => { const e = Math.max(0, Math.abs(z) - (L - 0.4)) / 0.4; return (def.W / 2) * (1 - 0.13 * e * e); };
  return { top, bottom, width };
}

function bodyOf(def) {
  const L = def.L / 2, step = def.step || 0.1;
  const { top, bottom, width } = shapeOf(def);
  const stations = [];
  for (let z = -L; z < L - 1e-6; z += step) stations.push(z);
  stations.push(L);
  const K = 18;
  const lower = loft(stations, (z) => {
    const yb = bottom(z), yt = top(z), yc = yb + (yt - yb) * 0.3, w = width(z), pts = [];   // widest low down: upright sides
    const end = Math.abs(z) > L - 0.35;
    for (let k = 0; k < K; k++) {
      const a = (k / K) * Math.PI * 2 - Math.PI / 2, s = Math.sin(a);
      // dark sills along the bottom, black lower bumpers at both ends
      const plastic = s < -0.88 || (end && s < -0.62);
      const n = s > 0 ? Math.min(def.n * 1.9, 10) : Math.max(def.n * 1.5, 4.5);   // broad shoulders, upright sides
      pts.push([w * se(Math.cos(a), n), yc + (s > 0 ? yt - yc : yc - yb) * se(s, n), plastic ? 1 : 0]);
    }
    return pts;
  }, true);

  // greenhouse: from just under the belt line (its base hides in the body's shoulders) up to the roof, narrowing
  // upwards (tumblehome)
  const roof = profile(def.roof), [r0, r1] = [def.roof[0][0], def.roof[def.roof.length - 1][0]];
  const flat0 = def.roof[1][0], flat1 = def.roof[def.roof.length - 2][0];
  const gs = stations.filter((z) => z > r0 && z < r1);
  gs.unshift(r0); gs.push(r1);
  const G = 12;
  const upper = loft(gs, (z) => {
    const yb = top(z) - 0.06, yt = Math.max(roof(z), yb + 0.001), h = yt - yb, w = width(z) * 0.84, pts = [];
    const pillar = def.pillar.some((p) => Math.abs(z - p) < (def.tall ? 0.07 : 0.055));
    const roofFlat = z > flat0 + 0.03 && z < flat1 - 0.03;
    const panel = def.panelsBehind != null && z < def.panelsBehind;   // vans: no side windows behind the cab
    for (let k = 0; k <= G; k++) {
      const a = (k / G) * Math.PI, s = Math.sin(a);
      const y = yb + h * Math.pow(s, 2 / def.n);
      const x = (w * (1 - (1 - def.tumble) * (y - yb) / Math.max(h, 0.3))) * se(Math.cos(a), def.n);
      // roof panel on top, pillars at its corners and between the side windows, a band above the bus windows
      let part = 2;
      if (s >= 0.94 && roofFlat) part = 0;
      else if (s >= 0.72 && s < 0.94) part = 0;
      else if (pillar || panel || (def.roofBand && y > def.roofBand) || k === 0 || k === G) part = 0;
      pts.push([x, y, part]);
    }
    return pts;
  }, false);
  return mergeGeometries([lower, upper]);
}

export function buildVehicle(name) {
  const def = TYPES[name].base ? { ...TYPES[TYPES[name].base], ...TYPES[name] } : TYPES[name];
  const half = def.wheelbase / 2;
  const body = bodyOf(def);
  const L = def.L / 2, W = def.W / 2, { top, bottom, width } = shapeOf(def);
  // lamps sit on the rounded ends: a little above the middle of the end section, well inside its width
  const at = (z) => { const yb = bottom(z), yt = top(z); return { y: yb + (yt - yb) * 0.66, x: width(z) * 0.62 }; };
  const front = at(L - 0.04), rear = at(-L + 0.04), frontY = front.y, rearY = rear.y;
  const trim = [
    box(0.52, 0.11, 0.02, 0, bottom(L) + 0.08, L + 0.01, '#e9e9e2'), box(0.52, 0.11, 0.02, 0, bottom(-L) + 0.1, -L - 0.01, '#e9e9e2'),   // plates
    box(front.x * 0.9, 0.07, 0.03, 0, frontY - 0.08, L + 0.005, '#0c0d10'),                                                             // grille
  ];
  if (!def.tall) {
    const mx = def.roof[def.roof.length - 1][0] - 0.16, my = top(mx) + 0.06, mw = width(mx) * 0.84 + 0.09;
    trim.push(box(0.13, 0.1, 0.17, -mw, my, mx, '#15161a'), box(0.13, 0.1, 0.17, mw, my, mx, '#15161a'));   // mirrors
    // door handles
    [def.pillar[0] + 0.45, def.pillar[0] - 0.55].forEach((z) => [-1, 1].forEach((sx) => trim.push(box(0.03, 0.03, 0.16, sx * (width(z) - 0.01), top(z) - 0.12, z, '#9aa0a8'))));
  } else {
    trim.push(box(def.W * 0.8, 0.3, 0.04, 0, 2.72, L + 0.02, '#0e0f12'));   // destination board
  }
  if (def.roofSign) trim.push(box(0.6, 0.18, 0.28, 0, def.roof[1][1] + 0.12, -0.3, '#f7f3d0'));
  const lights = [
    box(0.34, 0.08, 0.05, -front.x + 0.17, frontY, L - 0.01, '#f2f6ff'), box(0.34, 0.08, 0.05, front.x - 0.17, frontY, L - 0.01, '#f2f6ff'),
    box(0.32, 0.09, 0.05, -rear.x + 0.16, rearY, -L + 0.01, '#ff1428'), box(0.32, 0.09, 0.05, rear.x - 0.16, rearY, -L + 0.01, '#ff1428'),
  ];
  if (def.roofSign) lights.push(box(0.5, 0.08, 0.3, 0, def.roof[1][1] + 0.2, -0.3, '#ffd23f'));
  if (def.tall) lights.push(box(def.W * 0.7, 0.2, 0.03, 0, 2.72, L + 0.05, '#ffb020'));
  return {
    def, body, trim: mergeGeometries(trim), lights: mergeGeometries(lights),
    wheels: [[-W + 0.16, half], [W - 0.16, half], [-W + 0.16, -half], [W - 0.16, -half]],
    blink: { front: frontY, rear: rearY },
    collider: { hx: def.W / 2, hy: (def.tall ? 1.5 : 0.75), hz: def.L / 2 },
  };
}

// one wheel of radius 1 (scaled per car): a tyre with rounded shoulders and an alloy face with five spokes on both
// sides; vertex colours carry the material (dark rubber, bright alloy, grey hub)
export function buildWheel() {
  const tyre = [];
  for (let k = 0; k <= 6; k++) {
    const a = (k / 6) * Math.PI;
    tyre.push(new THREE.Vector2(0.72 + 0.28 * Math.sin(a), -0.38 * Math.cos(a)));
  }
  const rubber = new THREE.LatheGeometry(tyre, 16).rotateZ(Math.PI / 2);
  const parts = [rubber];
  const colors = [[rubber, '#121214']];
  [-1, 1].forEach((side) => {
    const face = new THREE.CircleGeometry(0.72, 16).rotateY(side * Math.PI / 2).translate(side * 0.26, 0, 0);
    colors.push([face, '#2a2c31']); parts.push(face);
    const hub = new THREE.CylinderGeometry(0.16, 0.18, 0.08, 8, 1, true).rotateZ(Math.PI / 2).translate(side * 0.34, 0, 0);
    colors.push([hub, '#c9ced6']); parts.push(hub);
    for (let s = 0; s < 5; s++) {
      const spoke = new THREE.BoxGeometry(0.06, 0.5, 0.14).translate(0, 0.4, 0).rotateX((s / 5) * Math.PI * 2).translate(side * 0.31, 0, 0);
      colors.push([spoke, '#b9bec6']); parts.push(spoke);
    }
    const lip = new THREE.TorusGeometry(0.66, 0.035, 3, 16).rotateY(Math.PI / 2).translate(side * 0.33, 0, 0);
    colors.push([lip, '#b9bec6']); parts.push(lip);
  });
  for (const [g, hex] of colors) {
    const c = new THREE.Color(hex), arr = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < arr.length; i += 3) arr.set([c.r, c.g, c.b], i);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    g.deleteAttribute('uv');
  }
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
}

export function pickType(r) {
  let x = r * TYPE_NAMES.reduce((a, n) => a + TYPES[n].weight, 0);
  for (const n of TYPE_NAMES) { x -= TYPES[n].weight; if (x <= 0) return n; }
  return 'sedan';
}
