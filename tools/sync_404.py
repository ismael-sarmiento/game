#!/usr/bin/env python3
"""Copy the universe's 404 page (portada repository) to /game/404.html without Cloudflare Web Analytics.

Unknown /game/... addresses then show the same 404 as every other site of the universe. IsGame does not use
Cloudflare Web Analytics, so the only change is removing that beacon line; the anonymous page signal of
/assets/ds/views.js counts /game/ like every other site (F11). Run it after every new version of the portada:  python3 tools/sync_404.py
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
HUB_404 = ROOT.parent / 'ismael-sarmiento.github.io' / '404.html'
BEACON = 'static.cloudflareinsights.com/beacon.min.js'

if not HUB_404.exists():
    sys.exit(f'missing {HUB_404}: the portada repository must sit next to isgame/')
lines = HUB_404.read_text(encoding='utf-8').splitlines(keepends=True)
beacon = [i for i, line in enumerate(lines) if BEACON in line]
line = lines[beacon[0]].strip() if len(beacon) == 1 else ''
# the whole line is the beacon block: «<!-- Cloudflare Web Analytics --><script …></script><!-- End Cloudflare Web Analytics -->»
if not (line.startswith(('<script', '<!-- Cloudflare Web Analytics -->')) and line.count('<script') == 1
        and line.endswith(('</script>', '<!-- End Cloudflare Web Analytics -->'))):
    sys.exit('the analytics beacon is not a single <script> line any more: review the portada 404 before syncing')
del lines[beacon[0]]
(ROOT / '404.html').write_text(''.join(lines), encoding='utf-8')
print(f'404.html ← portada (without the analytics beacon, {len(lines)} lines)')
