// Browser body for kit/tools/browser_check.mjs. Always use an isolated browser context.
const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });
const until = async (predicate, ms = 60000) => {
  for (let elapsed = 0; elapsed < ms; elapsed += 100) { if (predicate()) return true; await wait(100); }
  return !!predicate();
};
const intro = document.getElementById('intro');
const play = document.getElementById('play');
const params = new URLSearchParams(location.search);
if (params.get('simulate') === 'nogfx') {
  check('unsupported graphics has a recovery state', await until(() => document.getElementById('boot').classList.contains('failed')));
  check('failure is readable and presentation is dismissed', intro.hidden && !document.getElementById('boot-error').hidden && !!document.getElementById('boot-error').textContent.trim());
  return { ok: checks.every(c => c.pass), notes: checks };
}
await until(() => !!intro.dataset.openingState, 15000);
if (params.get('audit') === 'fallback') {
  check('optional module failure hands control to boot', intro.hidden && intro.dataset.openingState === 'fallback', intro.dataset.openingState);
} else {
  check('presentation appears', !intro.hidden && intro.dataset.openingState === 'ready', intro.dataset.openingState);
  const svg = intro.querySelector('.sig');
  const scale = svg ? svg.getBoundingClientRect().width / svg.viewBox.baseVal.width : 0;
  check('official shared scale', Math.abs(scale - Math.min(1160, innerWidth * .92) / 1401) < .002, scale);
  const previousBackground = getComputedStyle(document.body).backgroundColor;
  const beforeTheme = document.documentElement.dataset.theme;
  document.getElementById('opening-theme').click();
  check('theme persists explicitly without changing city palette', document.documentElement.dataset.theme !== beforeTheme && localStorage.getItem('isa-theme') === document.documentElement.dataset.theme && previousBackground === getComputedStyle(document.body).backgroundColor);
  document.getElementById('opening-theme').click();
  const initialLang = document.documentElement.lang;
  document.getElementById('opening-lang').focus();
  document.getElementById('opening-lang').click();
  if (params.get('audit') === 'language-failure') {
    check('language failure is recoverable', await until(() => !document.getElementById('opening-lang').disabled && !document.getElementById('opening-status').hidden, 10000));
    check('failed language preserves the current choice', document.documentElement.lang === initialLang && localStorage.getItem('isa-lang') === initialLang);
  } else {
    check('opening changes ES/EN', await until(() => document.documentElement.lang !== initialLang && !document.getElementById('opening-lang').disabled, 10000));
    check('explicit language is shared', localStorage.getItem('isa-lang') === document.documentElement.lang);
    document.getElementById('opening-lang').click();
    check('language returns without stale response', await until(() => document.documentElement.lang === initialLang && !document.getElementById('opening-lang').disabled, 10000));
  }
  check('language retains keyboard focus', document.activeElement.id === 'opening-lang', document.activeElement.id);
  intro.focus();
  intro.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  check('Tab enters the focus boundary', document.activeElement.id === 'opening-lang');
  const skip = intro.querySelector('[data-action="skip"]');
  if (!skip.hidden) skip.click();
  await wait(100);
  check('skip preserves complete signature', !intro.querySelector('[data-action="enter"]').hidden && intro.querySelector('.sig')?.classList.contains('is-live'));
  intro.querySelector('[data-action="enter"]').click();
  check('enter closes presentation', await until(() => intro.hidden, 5000));
}
check('game is not started by presentation', document.getElementById('hud').hidden);
check('real loading completes', await until(() => !play.disabled || document.getElementById('boot').classList.contains('failed')), document.getElementById('boot-status').textContent);
check('play is ready without loading error', !play.disabled && document.getElementById('boot-error').hidden, document.getElementById('boot-error').textContent);
check('ready state remains translatable', document.getElementById('boot-status').dataset.i18n === 'boot.ready', document.getElementById('boot-status').textContent);
check('focus belongs to boot', ['play', 'boot-title'].includes(document.activeElement.id), document.activeElement.id);
if (params.get('audit') !== 'language-failure' && !play.disabled) {
  const originalLanguage = document.documentElement.lang;
  const selector = document.getElementById('boot-lang');
  selector.value = originalLanguage === 'es' ? 'en' : 'es';
  selector.dispatchEvent(new Event('change', { bubbles: true }));
  check('language after loading preserves ready status', await until(() => document.documentElement.lang !== originalLanguage) && document.getElementById('boot-status').dataset.i18n === 'boot.ready');
  selector.value = originalLanguage; selector.dispatchEvent(new Event('change', { bubbles: true }));
  check('boot language restores without stale response', await until(() => document.documentElement.lang === originalLanguage));
}
if (params.get('audit') === 'play' && !play.disabled) {
  play.click(); await wait(500);
  const welcome=document.querySelector('#toasts .toast');
  check('welcome feedback remains visible', !!welcome && getComputedStyle(welcome).opacity !== '0');
  check('play starts the actual city', document.getElementById('boot').hidden && !document.getElementById('hud').hidden && window.__isgame?.game.started);
  document.getElementById('pause-btn').click(); await wait(100);
  check('pause works', !document.getElementById('pause').hidden && window.__isgame?.game.paused);
  for (const tab of document.querySelectorAll('#pause [role="tab"]')) {
    tab.click();
    check('menu tab ' + tab.dataset.tab, tab.getAttribute('aria-selected') === 'true' && !document.getElementById(tab.getAttribute('aria-controls')).hidden);
  }
  document.getElementById('resume').click(); await wait(100);
  check('resume returns to city', document.getElementById('pause').hidden && !window.__isgame?.game.paused);
}
check('no page overflow', document.documentElement.scrollWidth <= innerWidth);
return { ok: checks.every(c => c.pass), notes: checks };
