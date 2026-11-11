#!/usr/bin/env python3
"""Loopback-only public preview: python3 tools/serve.py [port], then http://127.0.0.1:8765/."""
import functools
import http.server
import pathlib
import sys

PUBLIC_FILES = frozenset({'index.html', '404.html', 'sitemap.xml', 'robots.txt'})
PUBLIC_DIRS = frozenset({'assets', 'css', 'i18n', 'js', 'vendor'})


def public_path(relative):
    parts = relative.parts
    return bool(parts) and not any(part.startswith('.') for part in parts) and (
        parts[0] in PUBLIC_DIRS or (len(parts) == 1 and parts[0] in PUBLIC_FILES)
    )


def resolve_public(root, requested):
    """Resolve one file under the public subset, checking both sides of any symlink."""
    try:
        relative = requested.relative_to(root)
        if not relative.parts:
            requested = root / 'index.html'
            relative = requested.relative_to(root)
        if not public_path(relative):
            return None
        resolved = requested.resolve(strict=True)
        if public_path(resolved.relative_to(root)) and resolved.is_file():
            return resolved
    except (OSError, RuntimeError, ValueError):
        pass
    return None


class NoCache(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        root = pathlib.Path(self.directory).resolve()
        requested = pathlib.Path(super().translate_path(path))
        resolved = resolve_public(root, requested)
        if resolved is None:
            raise FileNotFoundError
        return str(resolved)

    def send_head(self):
        try:
            return super().send_head()
        except FileNotFoundError:
            self.send_error(404)
            return None

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


class LocalServer(http.server.ThreadingHTTPServer):
    request_queue_size = 128   # the game asks for ~60 modules at once; the default backlog of 5 resets connections


def main():
    root = pathlib.Path(__file__).resolve().parent.parent
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    with LocalServer(('127.0.0.1', port), functools.partial(NoCache, directory=str(root))) as server:
        server.serve_forever()


if __name__ == '__main__':
    main()
