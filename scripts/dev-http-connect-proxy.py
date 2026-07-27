#!/usr/bin/env python3
"""Small development HTTP/CONNECT proxy for bridging a Windows pilot over link-local Ethernet.

This is intentionally minimal and intended for temporary package/bootstrap traffic.
It does not log headers or request bodies.
"""

from __future__ import annotations

import argparse
import select
import socket
import socketserver
from urllib.parse import urlsplit


class ProxyHandler(socketserver.StreamRequestHandler):
    timeout = 30

    def handle(self) -> None:
        line = self.rfile.readline(65536).decode("iso-8859-1", "replace")
        if not line:
            return
        parts = line.strip().split()
        if len(parts) != 3:
            return
        method, target, _version = parts
        headers = []
        while True:
            header = self.rfile.readline(65536)
            if not header or header in (b"\r\n", b"\n"):
                break
            headers.append(header)

        if method.upper() == "CONNECT":
            host, _, port_s = target.partition(":")
            port = int(port_s or "443")
            self._tunnel(host, port)
            return

        parsed = urlsplit(target)
        if not parsed.hostname:
            self.wfile.write(b"HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n")
            return
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        path = parsed.path or "/"
        if parsed.query:
            path += "?" + parsed.query
        with socket.create_connection((parsed.hostname, port), timeout=self.timeout) as upstream:
            upstream.sendall(f"{method} {path} HTTP/1.1\r\n".encode("ascii"))
            for header in headers:
                if not header.lower().startswith(b"proxy-connection:"):
                    upstream.sendall(header)
            upstream.sendall(b"Connection: close\r\n\r\n")
            self._relay_oneway(upstream)

    def _tunnel(self, host: str, port: int) -> None:
        try:
            upstream = socket.create_connection((host, port), timeout=self.timeout)
        except OSError:
            self.wfile.write(b"HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n")
            return
        with upstream:
            self.wfile.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            sockets = [self.connection, upstream]
            while True:
                readable, _, _ = select.select(sockets, [], [], self.timeout)
                if not readable:
                    return
                for src in readable:
                    dst = upstream if src is self.connection else self.connection
                    data = src.recv(65536)
                    if not data:
                        return
                    dst.sendall(data)

    def _relay_oneway(self, upstream: socket.socket) -> None:
        while True:
            data = upstream.recv(65536)
            if not data:
                return
            self.connection.sendall(data)


class ThreadingTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="169.254.254.6")
    parser.add_argument("--port", type=int, default=18798)
    args = parser.parse_args()
    with ThreadingTCPServer((args.host, args.port), ProxyHandler) as server:
        print(f"proxy listening on {args.host}:{args.port}", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
