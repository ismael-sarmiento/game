#!/usr/bin/env bash
# Release metadata only: version own modules, CSS and shared imports; keep the inline map's CSP hash in sync.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - "${1:?Usage: bash tools/bump-version.sh VERSION}" <<'PY'
from pathlib import Path
import json, re, sys

version = sys.argv[1]
if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}', version):
    raise SystemExit('Invalid version: use 1–64 letters, digits, dots, underscores or hyphens')
root = Path.cwd()
index = root / 'index.html'
source = index.read_text()
match = re.search(r'(<script type="importmap">)(.*?)(</script>)', source, re.S)
if not match:
    raise SystemExit('Import map missing; no files written')
mapping = json.loads(match[2])
for module in sorted((root / 'js').rglob('*.js')):
    key = './' + module.relative_to(root).as_posix()
    mapping['imports'][key] = key + '?v=' + version
encoded = json.dumps(mapping, separators=(',', ':'))
source = source[:match.start(2)] + encoded + source[match.end(2):]
for file, text in [(index, source), (root / 'js/main.js', (root / 'js/main.js').read_text())]:
    file.write_text(re.sub(r'(?<=\?v=)[A-Za-z0-9._-]+', version, text))
PY
python3 tools/csp_hash.py
python3 tools/sync_404.py
