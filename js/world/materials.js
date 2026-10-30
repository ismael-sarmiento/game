// City materials (TSL): CC0 textures mapped in world space plus procedural detail computed per pixel.
// NIGHT switches on windows, shop fronts and lamps; WET turns dry asphalt into a mirror of puddles.
import * as THREE from 'three/webgpu';
import {
  vec3, float, positionWorld, normalWorld, abs, fract, floor, hash, step, smoothstep, mix, select, time,
  instancedBufferAttribute, mx_noise_float, mod, min, max, texture, vec2, bumpMap,
} from 'three/tsl';
import { CITY } from './layout.js';
import { NIGHT, WET } from './timeofday.js';

const atNight = (dayLevel) => mix(float(dayLevel), float(1), NIGHT);

const band = (x, a, b, soft) => smoothstep(a - soft, a + soft, x).mul(float(1).sub(smoothstep(b - soft, b + soft, x)));

// Building types: window grid (cell size in metres, window extent inside the cell), wall texture and its tile size.
export const BUILDING_TYPES = {
  glass:   { cellW: 1.6, cellH: 3.7, winX: [0.03, 0.97], winY: [0.14, 0.97], tex: null, tile: 1 },
  office:  { cellW: 3.2, cellH: 3.7, winX: [0.22, 0.78], winY: [0.3, 0.76], tex: 'concrete', tile: 4, frame: 0.55 },
  brick:   { cellW: 2.7, cellH: 3.4, winX: [0.3, 0.7], winY: [0.22, 0.78], tex: 'bricks', tile: 1.8, frame: 0.85 },
  plaster: { cellW: 3.0, cellH: 3.3, winX: [0.28, 0.72], winY: [0.25, 0.78], tex: 'plaster', tile: 3.2, frame: 0.8 },
};

// Facades: textured walls, framed windows with sills, mirror-like glass by day and lit rooms at night.
// Per instance: aSeed (variation) and aAccent (district colour, a faint hint in some office windows).
export function buildingMaterial(type, seedAttr, accentAttr, textures) {
  const cfg = BUILDING_TYPES[type];
  const seed = instancedBufferAttribute(seedAttr);
  const accent = instancedBufferAttribute(accentAttr);
  const wp = positionWorld, nw = normalWorld;
  const sideX = abs(nw.x).greaterThan(0.5);
  const hor = select(sideX, wp.z, wp.x);
  const cx = hor.div(cfg.cellW), cy = wp.y.div(cfg.cellH);
  const fx = fract(cx), fy = fract(cy);
  const wall = step(abs(nw.y), 0.5);
  const upper = smoothstep(3.6, 4.4, wp.y);
  const win = band(fx, cfg.winX[0], cfg.winX[1], 0.012).mul(band(fy, cfg.winY[0], cfg.winY[1], 0.012)).mul(wall).mul(upper);
  const cell = floor(cx).add(floor(cy).mul(31.7)).add(seed.mul(911.0));
  const r = hash(cell);
  const occupancy = mix(float(0.6), float(0.92), hash(seed.mul(3.1)));   // some towers are almost dark
  const lit = step(occupancy, hash(cell.add(floor(time.mul(0.02).add(r.mul(9.0))).mul(7.3))));
  const warm = vec3(1.0, 0.74, 0.46), cool = vec3(0.62, 0.86, 1.0);
  const tint = mix(warm, mix(cool, accent, 0.12), step(0.72, r));   // offices: warm or cool white, barely a hint of the district
  // blinds: some rooms half lit
  // rooms: brighter towards the ceiling lights, some with blinds half down; never a flat white plate
  const roomLight = smoothstep(cfg.winY[0], cfg.winY[1], fy).mul(0.55).add(0.45);
  const windows = tint.mul(lit).mul(win).mul(roomLight).mul(r.mul(0.35).add(0.3)).mul(step(fy, mix(cfg.winY[1], cfg.winY[0] + 0.15, step(0.85, r))));

  // shop fronts: glazed ground floors lit from inside with warm or neutral light; above them a dark fascia band
  // where the shop signs hang (signs.js)
  const shopDoors = band(fract(hor.div(6.0)), 0.08, 0.92, 0.02);
  const shopId = floor(hor.div(6.0)).add(seed.mul(77.0));
  const shopLit = step(0.2, hash(shopId));
  const mullion = band(fract(hor.div(1.5)), 0.06, 0.94, 0.02);
  const glassFront = band(wp.y, 0.45, 2.8, 0.08).mul(shopDoors).mul(wall);
  const shopTint = mix(vec3(1.0, 0.82, 0.6), vec3(0.7, 0.78, 0.88), step(0.55, hash(shopId.add(5.0))));
  // the room behind the glass: brighter under the ceiling lights, shelves and counters as darker shapes
  const ceiling = smoothstep(0.5, 2.75, wp.y).pow(1.5).mul(0.8).add(0.2);   // light falls off from the ceiling down
  const shelfCol = step(0.45, fract(hor.mul(0.9).add(hash(shopId.add(9.0)))));
  const shelves = float(1).sub(shelfCol.mul(band(wp.y, 0.5, 1.9, 0.04)).mul(0.65));
  const shopGlow = glassFront.mul(shopLit).mul(mullion).mul(ceiling).mul(shelves).mul(hash(shopId.add(3.0)).mul(0.35).add(0.35));
  const fascia = band(wp.y, 3.0, 3.8, 0.02).mul(wall);
  const shops = shopTint.mul(shopGlow);

  const m = new THREE.MeshStandardNodeMaterial();
  const glassColor = mix(vec3(0.025, 0.04, 0.06), vec3(0.05, 0.07, 0.09), hash(seed.mul(5.0)));
  const glassPane = win.add(glassFront.mul(float(1).sub(upper)));
  if (cfg.tex) {
    const t = textures[cfg.tex];
    const uvW = vec2(hor, wp.y).div(cfg.tile).add(vec2(seed.mul(13.0), seed.mul(7.0)));
    const albedo = texture(t.color, uvW).rgb;
    const shade = hash(seed.mul(13.0)).mul(0.35).add(0.8);
    const tone = type === 'plaster'
      ? mix(mix(vec3(1.0, 0.9, 0.75), vec3(0.95, 0.72, 0.6), hash(seed.mul(17.0))), vec3(0.78, 0.86, 0.92), step(0.7, hash(seed.mul(19.0))))
      : type === 'brick' ? mix(vec3(1, 1, 1), vec3(0.8, 0.62, 0.55), hash(seed.mul(17.0))) : mix(vec3(1, 0.98, 0.95), vec3(0.85, 0.88, 0.92), hash(seed.mul(17.0)));
    const frame = band(fx, cfg.winX[0] - 0.05, cfg.winX[1] + 0.05, 0.01).mul(band(fy, cfg.winY[0] - 0.07, cfg.winY[1] + 0.04, 0.01)).mul(wall).mul(upper).sub(win).max(0);
    const sill = band(fy, cfg.winY[0] - 0.1, cfg.winY[0] - 0.05, 0.01).mul(band(fx, cfg.winX[0] - 0.08, cfg.winX[1] + 0.08, 0.01)).mul(wall).mul(upper);
    const wallColor = mix(albedo.mul(tone).mul(shade), vec3(cfg.frame, cfg.frame, cfg.frame * 0.97), frame.add(sill).min(1));
    m.colorNode = mix(mix(wallColor, vec3(0.08, 0.085, 0.09), fascia.mul(0.85)), glassColor, glassPane);
    m.roughnessNode = mix(texture(t.rough, uvW).r.mul(0.25).add(0.7), float(0.06), glassPane);
    m.metalnessNode = mix(float(0.0), float(0.85), glassPane);
    m.normalNode = bumpMap(texture(t.color, uvW), float(0.9).mul(float(1).sub(glassPane)));
  } else {
    // curtain wall: glass panels between thin metal mullions and spandrels at each floor
    const frameMetal = float(1).sub(win.max(glassFront));
    const spandrel = vec3(0.12, 0.13, 0.15).mul(hash(seed.mul(9.0)).mul(0.5).add(0.75));
    m.colorNode = mix(glassColor.mul(hash(seed.mul(23.0)).mul(1.4).add(0.6)), spandrel, frameMetal);
    m.roughnessNode = mix(float(0.04), float(0.35), frameMetal);
    m.metalnessNode = mix(float(0.92), float(0.7), frameMetal);
  }
  // shop interiors: faintly visible through the glass by day; at night a lit room, not a white plate
  m.emissiveNode = windows.mul(mix(float(0.025), float(1.0), NIGHT)).add(shops.mul(mix(float(0.18), float(0.6), NIGHT)));
  return m;
}

// Wet asphalt with lane markings, crossings and puddles, computed from the road grid on a CC0 asphalt texture.
export function groundMaterial(textures) {
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
  const stopV = alongV.mul(band(dz, 11.9, 12.35, 0.02)).mul(step(dx, 7.2));
  const stopH = alongH.mul(band(dx, 11.9, 12.35, 0.02)).mul(step(dz, 7.2));
  const n = mx_noise_float(wp.xz.mul(0.07)).mul(0.5).add(0.5);
  const wear = smoothstep(0.25, 0.7, mx_noise_float(wp.xz.mul(1.7)).mul(0.5).add(0.5));
  const white = max(max(max(dashV, dashH), max(edgeV, edgeH)), max(max(zebraV, zebraH), max(stopV, stopH))).mul(wear.mul(0.4).add(0.6));
  const yellow = max(centreV, centreH).mul(wear.mul(0.3).add(0.7));   // double line: 0.1–0.3 m each side of the centre

  const uvA = wp.xz.div(7.0);
  const t = textures.asphalt;
  const tex = texture(t.color, uvA).rgb;
  const patch = mx_noise_float(wp.xz.mul(0.02)).mul(0.5).add(0.5);   // repaired patches and tyre-worn lanes
  const puddle = smoothstep(mix(float(0.75), float(0.5), WET), mix(float(0.85), float(0.6), WET), n).mul(WET);
  const asphalt = tex.mul(mix(float(0.42), float(0.6), patch)).mul(float(1).sub(WET.mul(0.45)));

  const m = new THREE.MeshStandardNodeMaterial();
  m.colorNode = mix(mix(asphalt, vec3(0.7, 0.72, 0.76), white.mul(0.9)), vec3(0.85, 0.62, 0.22), yellow.mul(0.9)).mul(float(1).sub(puddle.mul(0.45)));
  m.emissiveNode = vec3(0.9, 0.62, 0.22).mul(yellow).mul(0.06).add(vec3(0.5, 0.55, 0.6).mul(white).mul(0.025)).mul(NIGHT);
  const dry = texture(t.rough, uvA).r.mul(0.25).add(0.68), wet = texture(t.rough, uvA).r.mul(0.2).add(0.16);
  m.roughnessNode = mix(mix(dry, wet, WET), float(0.03), puddle);
  m.metalnessNode = float(0.0);
  m.normalNode = bumpMap(texture(t.color, uvA), float(1.2).mul(float(1).sub(puddle)).mul(float(1).sub(white.max(yellow))));
  return m;
}

// Sidewalks (concrete slabs with a granite curb) and plazas (stone tiles with night seam lights).
export function pavementMaterial(textures, plaza = false) {
  const wp = positionWorld, nw = normalWorld;
  const t = plaza ? textures.tiles : textures.concrete;
  const uvP = wp.xz.div(plaza ? 4.5 : 3.0);
  const m = new THREE.MeshStandardNodeMaterial();
  const p = CITY.PITCH;
  const bx = mod(wp.x.add(CITY.HALF - CITY.ROAD + p * 20), p), bz = mod(wp.z.add(CITY.HALF - CITY.ROAD + p * 20), p);
  const edge = min(min(bx, float(CITY.BLOCK).sub(bx)), min(bz, float(CITY.BLOCK).sub(bz)));
  const curb = max(step(edge, 0.32), step(abs(nw.y), 0.5));        // top rim and the vertical faces
  // large-scale variation so the texture never reads as a repeated grid
  const dirt = mx_noise_float(wp.xz.mul(0.05)).mul(0.5).add(0.5);
  const raw = texture(t.color, uvP).rgb;
  // plaza stone: the CC0 tile photo has reddish stains; keep its relief and joints but neutralise the colour and
  // soften the contrast so the paving reads as clean, slightly warm limestone
  const grey = vec3(raw.dot(vec3(0.299, 0.587, 0.114)));
  const base = plaza ? mix(grey, vec3(0.6, 0.58, 0.55), 0.35).mul(vec3(1.0, 0.98, 0.94)) : raw;
  const albedo = base.mul(plaza ? 0.85 : 0.62).mul(dirt.mul(0.25).add(0.85));
  const slab = albedo.mul(float(1).sub(WET.mul(0.35)));
  m.colorNode = mix(slab, vec3(0.5, 0.5, 0.52).mul(float(1).sub(WET.mul(0.3))), curb);
  const rough = texture(t.rough, uvP).r.mul(0.3).add(0.62);
  m.roughnessNode = mix(rough, mix(float(0.3), float(0.14), smoothstep(0.55, 0.7, mx_noise_float(wp.xz.mul(0.4)).mul(0.5).add(0.5))), WET);
  m.metalnessNode = float(0.02);
  m.normalNode = bumpMap(texture(t.color, uvP), float(0.8));
  return m;
}

// Unlit glowing colour above 1.0 so the bloom picks it up. Per-instance colour through an attribute when given.
// dayLevel: how bright it stays in daylight (1 = always on, 0 = lamps that only light at night).
export function neonMaterial(colorOrAttr, intensity = 3, extra = {}, dayLevel = 1) {
  const m = new THREE.MeshBasicNodeMaterial(extra);
  const base = colorOrAttr.isBufferAttribute ? instancedBufferAttribute(colorOrAttr) : vec3(colorOrAttr.r, colorOrAttr.g, colorOrAttr.b);
  m.colorNode = dayLevel < 1 ? base.mul(intensity).mul(atNight(dayLevel)) : base.mul(intensity);
  m.fog = true;
  return m;
}

export { NIGHT, WET, atNight };

export const COLORS = {
  ia: new THREE.Color('#3fe0ff'), data: new THREE.Color('#e2b25c'), net: new THREE.Color('#a98bff'),
  sec: new THREE.Color('#5dffa8'), alert: new THREE.Color('#ff5c7a'), gold: new THREE.Color('#f2d18b'),
  campus: new THREE.Color('#f2d18b'),
};
