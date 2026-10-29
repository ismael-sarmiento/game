// Texts in Spanish and English from i18n/<lang>.json. t('a.b', { n: 3 }) replaces {n}; arrays come back as they are.
let dict = {};
let lang = 'es';

export const getLang = () => lang;

export function pickLang(saved) {
  const param = new URLSearchParams(location.search).get('lang');
  const wanted = param || saved || (navigator.language || 'es').slice(0, 2);
  return wanted === 'en' ? 'en' : 'es';
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
  const title = t('meta.title');
  if (title !== 'meta.title') document.title = title;
}
