"""Persist-before-publish event journal and atomic checkpoints."""

from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
from threading import Lock
from typing import Any


def atomic_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


class RunStore:
    def __init__(self, root: str | Path = ".macro_agent_runs"):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()

    def append_event(self, run_id: str, event: dict[str, Any]) -> None:
        directory = self.root / run_id
        directory.mkdir(parents=True, exist_ok=True)
        line = json.dumps(event, ensure_ascii=False, sort_keys=True,
                          separators=(",", ":")) + "\n"
        with self._lock, (directory / "events.ndjson").open("a", encoding="utf-8") as handle:
            handle.write(line)
            handle.flush()
            os.fsync(handle.fileno())

    def save_checkpoint(self, run_id: str, state: dict[str, Any]) -> None:
        with self._lock:
            atomic_json(self.root / run_id / "checkpoint.json", state)

    def load_checkpoint(self, run_id: str) -> dict[str, Any]:
        path = self.root / run_id / "checkpoint.json"
        if not path.exists():
            raise KeyError(f"checkpoint not found for {run_id}")
        return json.loads(path.read_text(encoding="utf-8"))

    def events(self, run_id: str) -> list[dict[str, Any]]:
        path = self.root / run_id / "events.ndjson"
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()
                if line.strip()]

    def list_runs(self) -> list[dict[str, Any]]:
        rows = []
        for path in sorted(self.root.glob("*/checkpoint.json"), reverse=True):
            try:
                state = json.loads(path.read_text(encoding="utf-8"))
                rows.append({"run_id": path.parent.name, "status": state.get("status"),
                             "stage": state.get("stage"), "question": state.get("question")})
            except (OSError, json.JSONDecodeError):
                continue
        return rows[:20]

    def append_memory(self, record: dict[str, Any]) -> None:
        """Persist only explicitly redacted, non-secret cross-run memory."""
        path = self.root / "long_term_memory.json"
        with self._lock:
            rows = []
            if path.exists():
                try:
                    document = json.loads(path.read_text(encoding="utf-8"))
                    rows = document.get("records", []) if isinstance(document, dict) else []
                except (OSError, json.JSONDecodeError):
                    rows = []
            rows.append(record)
            atomic_json(path, {"schema_version": 1, "records": rows[-100:]})
