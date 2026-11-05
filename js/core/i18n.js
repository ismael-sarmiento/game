// Texts in Spanish and English from i18n/<lang>.json. t('a.b', { n: 3 }) replaces {n}; arrays come back as they are.
let dict = {};
let lang = 'es';

export const getLang = () => lang;

// The language of the universe: every site on the origin remembers the visitor's explicit choice in «isa-lang»
// (portada /assets/ds/i18n.js and IsAcademy), so a visitor reading in English arrives here in English.
const UNIVERSE_LANG = 'isa-lang';
const universeLang = () => { try { return localStorage.getItem(UNIVERSE_LANG); } catch { return null; } };

// ?lang wins, then the universe's choice, then the language saved with the game, then the browser's
export function pickLang(saved) {
  const param = new URLSearchParams(location.search).get('lang');
  const wanted = param || universeLang() || saved || (navigator.language || 'es').slice(0, 2);
  return wanted === 'en' ? 'en' : 'es';
}

// only an explicit choice of the player is shared with the other sites, as they do
export function rememberLang(next) {
  try { localStorage.setItem(UNIVERSE_LANG, next === 'en' ? 'en' : 'es'); } catch { /* storage unavailable */ }
}

export async function loadLang(next) {
  const res = await fetch(`i18n/${next}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`i18n ${next}: ${res.status}`);
  dict = await res.json();
  lang = next;
  document.documentElement.lang = next;
  applyDom();
}

export function t(key, vars) {
  const value = key.split('.').reduce((node, part) => (node == null ? node : node[part]), dict);
  if (value == null) return key;
  if (typeof value !== 'string' || !vars) return value;
  return value.replace(/\{(\w+)\}/g, (_, name) => (name in vars ? vars[name] : `{${name}}`));
}

export function applyDom(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder)); });
  root.querySelectorAll('[data-i18n-href]').forEach((el) => { el.setAttribute('href', t(el.dataset.i18nHref)); });   // links to the universe keep the language
  const title = t('meta.title');
  if (title !== 'meta.title') document.title = title;
}
