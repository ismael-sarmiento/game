#!/usr/bin/env python3
"""Refresh the CSP hash of the inline import map in index.html (run after editing the import map)."""
import base64, hashlib, pathlib, re, sys

page = pathlib.Path(__file__).resolve().parent.parent / 'index.html'
html = page.read_text(encoding='utf-8')
match = re.search(r'<script type="importmap">(.*?)</script>', html, re.S)
if not match:
    sys.exit('index.html has no inline import map')
digest = base64.b64encode(hashlib.sha256(match.group(1).encode('utf-8')).digest()).decode()
updated, count = re.subn(r"'sha256-[^']*'", f"'sha256-{digest}'", html, count=1)
if count != 1:
    sys.exit('CSP hash placeholder not found')
page.write_text(updated, encoding='utf-8')
print(f'sha256-{digest}')
