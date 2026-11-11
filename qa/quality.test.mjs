import assert from 'node:assert/strict';
import test from 'node:test';
import { initialLevel } from '../js/core/quality.js';

test('quality: only known URL and saved presets override automatic selection', t => {
  for (const [name, value] of Object.entries({
    navigator: { hardwareConcurrency: 8, maxTouchPoints: 0 },
    matchMedia: () => ({ matches: false }),
    location: { search: '' },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true });
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name]);
  }
  for (const name of ['toString', 'constructor', '__proto__', 'invalid']) {
    location.search = '?quality=' + name;
    assert.deepEqual(initialLevel(name), { level: 'high', auto: true });
    assert.deepEqual(initialLevel('low'), { level: 'low', auto: false });
  }
  for (const level of ['high', 'medium', 'low']) {
    location.search = '?quality=' + level;
    assert.deepEqual(initialLevel('auto'), { level, auto: false });
  }
});
