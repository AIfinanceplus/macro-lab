"""Least-privilege capabilities and untrusted-content quarantine."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
import re
import secrets
from typing import Any
from uuid import uuid4

from .contracts import AGENTS, TOOLS


INJECTION_PATTERNS = (
    re.compile(r"ignore\s+(all\s+)?previous", re.I),
    re.compile(r"system\s+(prompt|message)", re.I),
    re.compile(r"reveal\s+.*(secret|api\s*key)", re.I),
    re.compile(r"execute\s+(this|the following)\s+(command|instruction)", re.I),
    re.compile(r"automatic_execution\s*=\s*true", re.I),
)


def scan_untrusted_text(text: str) -> list[str]:
    return [pattern.pattern for pattern in INJECTION_PATTERNS if pattern.search(text or "")]


@dataclass(frozen=True)
class CapabilityTicket:
    capability_id: str
    run_id: str
    contract_id: str
    agent_id: str
    tool_name: str
    scope: str
    effect_class: str
    issued_at: str
    expires_at: str
    max_uses: int
    signature: str

    def claims(self) -> dict[str, Any]:
        return {k: v for k, v in asdict(self).items() if k != "signature"}

    def public(self) -> dict[str, Any]:
        return {**self.claims(), "signature": f"{self.signature[:12]}…"}


class CapabilityAuthority:
    def __init__(self, secret: bytes | None = None):
        self._secret = secret or secrets.token_bytes(32)
        self._uses: dict[str, int] = {}

    def _sign(self, claims: dict[str, Any]) -> str:
        body = json.dumps(claims, sort_keys=True, separators=(",", ":")).encode()
        return hmac.new(self._secret, body, hashlib.sha256).hexdigest()

    def mint(self, *, run_id: str, contract_id: str, agent_id: str,
             tool_name: str, ttl_seconds: int = 45) -> CapabilityTicket:
        agent = AGENTS[agent_id]
        tool = TOOLS[tool_name]
        if tool.required_scope not in agent.scopes:
            raise PermissionError("agent contract does not grant the tool scope")
        if tool.effect_class not in {"PURE", "READ"}:
            raise PermissionError("macro research runtime permits only PURE and READ tools")
        now = datetime.now(timezone.utc)
        claims = {
            "capability_id": f"CAP-{uuid4().hex[:12]}", "run_id": run_id,
            "contract_id": contract_id, "agent_id": agent_id, "tool_name": tool_name,
            "scope": tool.required_scope, "effect_class": tool.effect_class,
            "issued_at": now.isoformat(),
            "expires_at": (now + timedelta(seconds=ttl_seconds)).isoformat(),
            "max_uses": 1,
        }
        return CapabilityTicket(**claims, signature=self._sign(claims))

    def authorize(self, ticket: CapabilityTicket, *, run_id: str,
                  contract_id: str, agent_id: str, tool_name: str) -> None:
        expected = {"run_id": run_id, "contract_id": contract_id,
                    "agent_id": agent_id, "tool_name": tool_name}
        reasons = [f"{key}_mismatch" for key, value in expected.items()
                   if getattr(ticket, key) != value]
        if not hmac.compare_digest(ticket.signature, self._sign(ticket.claims())):
            reasons.append("signature_invalid")
        if datetime.now(timezone.utc) >= datetime.fromisoformat(ticket.expires_at):
            reasons.append("capability_expired")
        if self._uses.get(ticket.capability_id, 0) >= ticket.max_uses:
            reasons.append("capability_consumed")
        if reasons:
            raise PermissionError("capability rejected: " + ", ".join(reasons))
        self._uses[ticket.capability_id] = self._uses.get(ticket.capability_id, 0) + 1
