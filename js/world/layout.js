// City grid shared by every system: 12 × 12 blocks of 64 m separated by 16 m roads (≈ 0.95 km²).
// Road i runs through x (or z) = roadAt(i); block i spans blockAt(i) ± BLOCK/2.
const N = 12, BLOCK = 64, ROAD = 16, SIDEWALK = 5;
const PITCH = BLOCK + ROAD;
const SIZE = N * PITCH + ROAD;
const HALF = SIZE / 2;

export const CITY = { N, BLOCK, ROAD, SIDEWALK, PITCH, SIZE, HALF, CURB: 0.18 };

export const roadAt = (i) => -HALF + ROAD / 2 + i * PITCH;
export const blockAt = (i) => -HALF + ROAD + BLOCK / 2 + i * PITCH;

// Campus: the four blocks around the central crossing (0, 0).
export const isCampus = (i, j) => (i === 5 || i === 6) && (j === 5 || j === 6);

export const DISTRICTS = {
  ia: { key: 'ia', color: '#3fe0ff' },
  data: { key: 'data', color: '#e2b25c' },
  net: { key: 'net', color: '#a98bff' },
  sec: { key: 'sec', color: '#5dffa8' },
  campus: { key: 'campus', color: '#f2d18b' },
};

export function districtAt(x, z) {
  if (Math.abs(x) < PITCH && Math.abs(z) < PITCH) return DISTRICTS.campus;
  if (x < 0) return z < 0 ? DISTRICTS.ia : DISTRICTS.net;
  return z < 0 ? DISTRICTS.data : DISTRICTS.sec;
}

// Deterministic random numbers so the city is the same on every visit.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Nearest road index and whether a point is on asphalt.
export const nearestRoad = (v) => Math.max(0, Math.min(N, Math.round((v + HALF - ROAD / 2) / PITCH)));
export function onRoad(x, z) {
  const dx = Math.abs(x - roadAt(nearestRoad(x))), dz = Math.abs(z - roadAt(nearestRoad(z)));
  return dx < ROAD / 2 || dz < ROAD / 2;
}
