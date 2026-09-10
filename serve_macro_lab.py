"""Local web server for the Rigorous Macro Research Agent Lab."""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from urllib.parse import urlparse

from macro_lab import MacroResearchRuntime
from macro_lab.sources import preload_openbb


ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
RUNTIME = MacroResearchRuntime()


class MacroLabHandler(BaseHTTPRequestHandler):
    server_version = "RigorousMacroLab/0.1"

    def log_message(self, fmt, *args):
        # Never log request bodies: UI credentials are one-shot and secret.
        super().log_message(fmt, *args)

    def do_GET(self):
        path = urlparse(self.path).path
        if path in {"/", "/macro"}:
            return self._static("macro_lab.html", "text/html; charset=utf-8")
        if path == "/macro_lab.css":
            return self._static("macro_lab.css", "text/css; charset=utf-8")
        if path == "/macro_lab.js":
            return self._static("macro_lab.js", "text/javascript; charset=utf-8")
        if path == "/api/macro/manifest":
            return self._json(200, RUNTIME.manifest())
        if path == "/api/macro/runs":
            return self._json(200, {"runs": RUNTIME.store.list_runs()})
        if path.startswith("/api/macro/runs/"):
            run_id = path.rsplit("/", 1)[-1]
            try:
                return self._json(200, {
                    "checkpoint": RUNTIME.store.load_checkpoint(run_id),
                    "events": RUNTIME.store.events(run_id),
                })
            except KeyError as exc:
                return self._json(404, {"error": str(exc)})
        return self._json(404, {"error": "not found"})

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            payload = self._body()
        except (ValueError, json.JSONDecodeError) as exc:
            return self._json(400, {"error": str(exc)})
        if path == "/api/macro/run/stream":
            return self._ndjson(RUNTIME.run_stream(payload))
        if path == "/api/macro/resume/stream":
            run_id = str(payload.get("run_id", ""))
            if not run_id:
                return self._json(400, {"error": "run_id is required"})
            try:
                return self._ndjson(RUNTIME.resume_stream(run_id, payload))
            except (KeyError, ValueError) as exc:
                return self._json(409, {"error": str(exc)})
        return self._json(404, {"error": "not found"})

    def _body(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length > 64_000:
            raise ValueError("request body is too large")
        raw = self.rfile.read(length)
        return json.loads(raw or b"{}")

    def _ndjson(self, events):
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        try:
            for event in events:
                self.wfile.write((json.dumps(event, ensure_ascii=False) + "\n").encode("utf-8"))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        self.close_connection = True

    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _static(self, name, content_type):
        path = WEB / name
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)


def main():
    openbb_ready, openbb_status = preload_openbb()
    server = ThreadingHTTPServer(("127.0.0.1", 8011), MacroLabHandler)
    print("Rigorous Macro Research Agent Lab")
    print(f"OpenBB preload: {'READY' if openbb_ready else 'OPTIONAL'} · {openbb_status}")
    print("Open http://127.0.0.1:8011")
    print("Default: deterministic teaching fixtures · Live: OpenBB + official RSS")
    print("Research only · no trading · every event persists before NDJSON delivery")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Macro Agent Lab.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
