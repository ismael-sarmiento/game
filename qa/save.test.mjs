import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/core/save.js', import.meta.url), 'utf8');
const cases = [
  { name: 'a fresh player follows reduced motion', system: true, stored: null, expected: true },
  { name: 'a fresh player keeps ordinary motion', system: false, stored: null, expected: false },
  { name: 'an explicit false survives a reduced-motion system', system: true, stored: { settings: { reduceMotion: false } }, expected: false },
  { name: 'an explicit true survives an ordinary-motion system', system: false, stored: { settings: { reduceMotion: true } }, expected: true },
  { name: 'blocked storage still respects the system', system: true, blocked: true, expected: true },
];
for (const [index, item] of cases.entries()) {
  test(item.name, async t => {
    for (const [key, value] of Object.entries({
      matchMedia: () => ({ matches: item.system }),
      localStorage: { getItem() { if (item.blocked) throw new Error('blocked'); return JSON.stringify(item.stored); }, setItem() {} },
    })) {
      const previous = Object.getOwnPropertyDescriptor(globalThis, key);
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
      t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
    }
    const { save } = await import('data:text/javascript,' + encodeURIComponent(source) + '#' + index);
    assert.equal(save.load().settings.reduceMotion, item.expected);
    save.reset();
    assert.equal(save.data.settings.reduceMotion, item.expected, 'resetting progress preserves the chosen setting');
  });
}
