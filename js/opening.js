// Optional presentation: shared-module failure must never stop the game bootstrap.
export function initGameOpening({ onLanguage, onSettle }) {
  const intro = document.getElementById('intro');
  const root = document.documentElement;
  const langButton = document.getElementById('opening-lang');
  const themeButton = document.getElementById('opening-theme');
  const status = document.getElementById('opening-status');
  const media = matchMedia('(prefers-color-scheme: dark)');
  let release = () => {};
  let dismissed = false;
  let explicitTheme;
  try { explicitTheme = localStorage.getItem('isa-theme'); } catch { /* private browsing */ }
  if (!['light', 'dark'].includes(explicitTheme)) explicitTheme = null;
  const theme = explicitTheme === 'light' || explicitTheme === 'dark' ? explicitTheme : media.matches ? 'dark' : 'light';
  root.dataset.theme = theme;
  const refresh = () => {
    langButton.textContent = root.lang === 'en' ? 'ES' : 'EN';
    themeButton.setAttribute('aria-label', themeButton.dataset[root.dataset.theme === 'dark' ? 'labelLight' : 'labelDark']);
  };
  const finish = () => {
    if (dismissed) return;
    dismissed = true;
    intro.hidden = true;
    intro.dataset.openingState = 'done';
    release(intro);
    document.body.classList.remove('intro-open', 'entering');
    onSettle?.();
  };
  const controller = { active: false, refresh, dismiss: finish };
  themeButton.addEventListener('click', () => {
    explicitTheme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = explicitTheme;
    try { localStorage.setItem('isa-theme', explicitTheme); } catch { /* no persistence */ }
    refresh();
  });
  media.addEventListener('change', () => { if (!explicitTheme) { root.dataset.theme = media.matches ? 'dark' : 'light'; refresh(); } });
  langButton.addEventListener('click', async () => {
    const restoreFocus = document.activeElement === langButton;
    langButton.disabled = true;
    status.hidden = true;
    try { await onLanguage(root.lang === 'en' ? 'es' : 'en'); }
    catch { status.hidden = false; }
    finally {
      langButton.disabled = false; refresh();
      if (restoreFocus && !intro.hidden && [document.body, intro].includes(document.activeElement)) langButton.focus({ preventScroll: true });
    }
  });
  void (async () => {
    try {
      const [signature, { initIntro }, { releaseDialog }] = await Promise.all([
        import('/assets/ds/signature.js'), import('/assets/ds/intro.js'), import('/assets/ds/ds.js'),
      ]);
      if (dismissed) return;
      release = releaseDialog;
      document.getElementById('opening-signature').innerHTML = signature.signatureSVG('game-opening', 'Game');
      const svg = intro.querySelector('.sig');
      await document.fonts.ready;
      if (dismissed) return;
      signature.fitSignature(svg);
      root.classList.add('js');
      intro.hidden = false;
      controller.active = true;
      intro.dataset.openingState = 'ready';
      const scene = {
        async play(_intro, cancelled) { if (!cancelled()) await signature.playSignature(svg); },
        complete() { signature.skipSignature(svg); },
        async exit(_intro, end) { signature.skipSignature(svg); end(); },
      };
      const boundary = initIntro({ scene, home: '#boot', onSettle: () => { controller.active = false; finish(); } });
      if (!boundary) { controller.active = false; finish(); }
    } catch {
      controller.active = false;
      finish();
      intro.dataset.openingState = 'fallback';
    }
  })();
  refresh();
  return controller;
}
