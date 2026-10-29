// Procedural materials (TSL): no image textures, everything is computed per pixel from world position.
import * as THREE from 'three/webgpu';
import {
  vec3, float, positionWorld, normalWorld, abs, fract, floor, hash, step, smoothstep, mix, select, time,
  instancedBufferAttribute, mx_noise_float, mod, min, max, uniform, texture,
} from 'three/tsl';
import { CITY } from './layout.js';

const band = (x, a, b, soft) => smoothstep(a - soft, a + soft, x).mul(float(1).sub(smoothstep(b - soft, b + soft, x)));

// Facades with lit windows. Per instance: aSeed (variation) and aAccent (district colour for shops and some windows).
export function buildingMaterial(seedAttr, accentAttr) {
  const seed = instancedBufferAttribute(seedAttr);
  const accent = instancedBufferAttribute(accentAttr);
  const wp = positionWorld, nw = normalWorld;
  const sideX = abs(nw.x).greaterThan(0.5);
  const hor = select(sideX, wp.z, wp.x);
  const cx = hor.div(3.2), cy = wp.y.div(3.7);
  const fx = fract(cx), fy = fract(cy);
  const win = band(fx, 0.24, 0.76, 0.03).mul(band(fy, 0.34, 0.74, 0.03));
  const wall = step(abs(nw.y), 0.5);
  const cell = floor(cx).add(floor(cy).mul(31.7)).add(seed.mul(911.0));
  const r = hash(cell);
  const occupancy = mix(float(0.62), float(0.93), hash(seed.mul(3.1)));   // some towers are almost dark
  const lit = step(occupancy, hash(cell.add(floor(time.mul(0.02).add(r.mul(9.0))).mul(7.3))));
  const upper = smoothstep(3.6, 4.4, wp.y);
  const warm = vec3(1.0, 0.74, 0.46), cool = vec3(0.62, 0.86, 1.0);
  const tint = mix(warm, mix(cool, accent, 0.55), step(0.72, r));
  const windows = tint.mul(lit).mul(win).mul(wall).mul(upper).mul(r.mul(0.9).add(0.7));
  // ground floor: shop fronts in the district colour
  const shopDoors = band(fract(hor.div(6.0)), 0.08, 0.92, 0.02);
  const shopLit = step(0.38, hash(floor(hor.div(6.0)).add(seed.mul(77.0))));
  const mullion = band(fract(hor.div(1.5)), 0.06, 0.94, 0.02);
  const glass = band(wp.y, 0.45, 2.8, 0.08).mul(shopDoors).mul(shopLit).mul(mullion).mul(hash(floor(hor.div(6.0)).add(3.0)).mul(0.07).add(0.035));
  const awning = band(wp.y, 3.0, 3.18, 0.02).mul(shopLit).mul(1.1);
  const shops = accent.mul(glass.add(awning)).mul(wall);

  const m = new THREE.MeshStandardNodeMaterial();
  m.colorNode = mix(vec3(0.045, 0.05, 0.085), vec3(0.02, 0.025, 0.04), win).add(accent.mul(0.012));
  m.emissiveNode = windows.mul(1.05).add(shops);
  m.roughnessNode = mix(float(0.78), float(0.12), win.mul(wall));
  m.metalnessNode = mix(float(0.25), float(0.85), win.mul(wall));
  return m;
}

// Wet asphalt with lane markings, crossings and puddles, computed from the road grid.
export function groundMaterial() {
  const wp = positionWorld;
  const p = CITY.PITCH, h = CITY.ROAD / 2;
  // shifted by whole pitches so mod() never sees a negative value (WGSL % keeps the sign)
  const lx = mod(wp.x.add(CITY.HALF - h + p * 20), p), lz = mod(wp.z.add(CITY.HALF - h + p * 20), p);
  const dx = min(lx, float(p).sub(lx)), dz = min(lz, float(p).sub(lz));   // distance to the nearest road centre line
  const inV = step(dx, h), inH = step(dz, h);
  const crossing = inV.mul(inH);
  const alongV = inV.mul(float(1).sub(crossing)), alongH = inH.mul(float(1).sub(crossing));
  const centreV = step(dx, 0.3).mul(step(0.1, dx)).mul(alongV);
  const centreH = step(dz, 0.3).mul(step(0.1, dz)).mul(alongH);
  const dashV = step(abs(dx.sub(3.7)), 0.1).mul(step(fract(wp.z.div(7.0)), 0.5)).mul(alongV);
  const dashH = step(abs(dz.sub(3.7)), 0.1).mul(step(fract(wp.x.div(7.0)), 0.5)).mul(alongH);
  const edgeV = step(abs(dx.sub(7.4)), 0.08).mul(alongV), edgeH = step(abs(dz.sub(7.4)), 0.08).mul(alongH);
  const zebraV = alongV.mul(band(dz, 8.6, 11.4, 0.02)).mul(step(fract(wp.x.div(1.3)), 0.55)).mul(step(dx, 6.8));
  const zebraH = alongH.mul(band(dx, 8.6, 11.4, 0.02)).mul(step(fract(wp.z.div(1.3)), 0.55)).mul(step(dz, 6.8));
  const white = max(max(dashV, dashH), max(max(edgeV, edgeH), max(zebraV, zebraH)));
  const yellow = max(centreV, centreH);   // double line: 0.1–0.3 m on each side of the centre

  const n = mx_noise_float(wp.xz.mul(0.07)).mul(0.5).add(0.5);
  const fine = mx_noise_float(wp.xz.mul(0.9)).mul(0.5).add(0.5);
  const puddle = smoothstep(0.52, 0.62, n);
  const asphalt = vec3(0.028, 0.03, 0.04).mul(fine.mul(0.35).add(0.8));

  const m = new THREE.MeshStandardNodeMaterial();
  m.colorNode = mix(mix(asphalt, vec3(0.62, 0.64, 0.7), white.mul(0.85)), vec3(0.85, 0.62, 0.25), yellow.mul(0.9)).mul(float(1).sub(puddle.mul(0.45)));
  m.emissiveNode = vec3(0.9, 0.62, 0.22).mul(yellow).mul(0.08).add(vec3(0.5, 0.55, 0.6).mul(white).mul(0.03));
  m.roughnessNode = mix(mix(float(0.42), float(0.16), fine.mul(0.4)), float(0.03), puddle);
  m.metalnessNode = float(0.0);
  return m;
}

// Sidewalks and plazas: concrete slabs with a thin cyan seam light every few metres in plazas.
export function pavementMaterial(plaza = false) {
  const wp = positionWorld;
  const gx = fract(wp.x.div(plaza ? 4 : 2)), gz = fract(wp.z.div(plaza ? 4 : 2));
  const seam = max(step(gx, 0.03), step(gz, 0.03));
  const m = new THREE.MeshStandardNodeMaterial();
  const n = mx_noise_float(wp.xz.mul(0.4)).mul(0.5).add(0.5);
  m.colorNode = mix(vec3(0.075, 0.08, 0.1).mul(n.mul(0.3).add(0.85)), vec3(0.03, 0.035, 0.05), seam);
  m.roughnessNode = mix(float(0.55), float(0.2), smoothstep(0.55, 0.7, n));
  m.metalnessNode = float(0.05);
  if (plaza) {
    const pulse = time.mul(0.6).add(wp.x.add(wp.z).mul(0.02)).sin().mul(0.5).add(0.5);
    m.emissiveNode = vec3(0.25, 0.85, 1.0).mul(seam).mul(pulse.mul(0.1).add(0.04));
  }
  return m;
}

// Unlit glowing colour above 1.0 so the bloom picks it up. Per-instance colour through aColor when given.
export function neonMaterial(colorOrAttr, intensity = 3, extra = {}) {
  const m = new THREE.MeshBasicNodeMaterial(extra);
  const base = colorOrAttr.isBufferAttribute ? instancedBufferAttribute(colorOrAttr) : vec3(colorOrAttr.r, colorOrAttr.g, colorOrAttr.b);
  m.colorNode = base.mul(intensity);
  m.fog = true;
  return m;
}

// Signs drawn on a canvas: texture alpha shapes the glyphs, intensity drives the bloom; some signs flicker.
export function signMaterial(tex, intensity = 2.4, flicker = 0) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const t = texture(tex);
  const phase = uniform(Math.random() * 100);
  const f = flicker ? float(1).sub(step(1 - flicker, hash(floor(time.mul(14).add(phase)))).mul(0.85)) : float(1);
  m.colorNode = t.rgb.mul(intensity).mul(f);
  m.opacityNode = t.a;
  return m;
}

export const COLORS = {
  ia: new THREE.Color('#3fe0ff'), data: new THREE.Color('#e2b25c'), net: new THREE.Color('#a98bff'),
  sec: new THREE.Color('#5dffa8'), alert: new THREE.Color('#ff5c7a'), gold: new THREE.Color('#f2d18b'),
  campus: new THREE.Color('#f2d18b'),
};
