#!/usr/bin/env python3
"""Local preview without browser caching (every reload loads the latest modules): python3 tools/serve.py [port].
Listens on IPv6 and IPv4 so 'localhost' works whichever address the browser tries first."""
import contextlib, functools, http.server, pathlib, socket, sys

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

class DualStack(http.server.ThreadingHTTPServer):
    address_family = socket.AF_INET6
    request_queue_size = 128   # the game asks for ~60 modules at once; the default backlog of 5 resets connections
    def server_bind(self):
        with contextlib.suppress(Exception):
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        return super().server_bind()

root = pathlib.Path(__file__).resolve().parent.parent
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
DualStack(('::', port), functools.partial(NoCache, directory=str(root))).serve_forever()
