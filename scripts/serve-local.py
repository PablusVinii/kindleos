#!/usr/bin/env python3
"""Local static server for ReKindle visual testing.

Cloudflare Pages serves extensionless URLs, and theme.js may reload a page from
/jumpy.html to /jumpy. Plain `python3 -m http.server` 404s those. This server
falls back to `<path>.html` and is threaded so a slow page cannot block the
screenshot loop.

Usage:
    python3 scripts/serve-local.py [port] [root]
"""
import http.server
import os
import socketserver
import sys
import urllib.parse

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8899
ROOT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), '..')
os.chdir(os.path.abspath(ROOT))


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        path = urllib.parse.urlsplit(self.path).path
        if path != '/' and not os.path.exists('.' + path):
            if os.path.exists('.' + path + '.html'):
                self.path = path + '.html'
        return super().do_GET()

    def log_message(self, *args):
        pass


class ThreadingServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    print('ReKindle local server: http://127.0.0.1:%d' % PORT)
    ThreadingServer(('127.0.0.1', PORT), Handler).serve_forever()
