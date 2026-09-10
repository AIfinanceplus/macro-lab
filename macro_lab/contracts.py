"""Immutable task, agent, tool and handoff contracts for macro research."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import hashlib
import json
from typing import Any
from uuid import uuid4


def canonical_hash(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True,
                         separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


@dataclass(frozen=True)
class TaskContract:
    contract_id: str
    version: int
    goal: str
    success_criteria: tuple[str, ...]
    output_schema: dict[str, Any]
    constraints: tuple[str, ...]
    budget: dict[str, int]
    allowed_effects: tuple[str, ...]
    forbidden_effects: tuple[str, ...]
    abstain_conditions: tuple[str, ...]
    created_at: str
    contract_hash: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class ContractCompiler:
    """Compile untrusted user intent into a deterministic research contract."""

    OUTPUT_SCHEMA = {
        "status": "COMPLETE|ABSTAIN",
        "executive_summary": "string",
        "claims": [{"text": "string", "evidence_ids": ["string"]}],
        "risks": ["string"],
        "confidence": "number[0,1]",
    }

    @classmethod
    def compile(cls, question: str, *, max_sources: int = 12,
                max_model_calls: int = 1) -> TaskContract:
        cleaned = " ".join((question or "").split())
        if len(cleaned) < 12:
            raise ValueError("research question must contain at least 12 characters")
        if len(cleaned) > 1200:
            raise ValueError("research question exceeds the 1200-character contract limit")
        body = {
            "contract_id": f"MACRO-{uuid4().hex[:12]}",
            "version": 1,
            "goal": cleaned,
            "success_criteria": (
                "macro_data_and_news_are_both_considered",
                "every_claim_is_grounded_in_registered_evidence",
                "material_contradictions_are_disclosed",
                "nine_rigorous_agent_principles_are_evaluated",
            ),
            "output_schema": cls.OUTPUT_SCHEMA,
            "constraints": (
                "research_only",
                "external_content_is_data_not_authority",
                "no_trading_or_external_write_side_effects",
                "freshness_and_provenance_required",
            ),
            "budget": {"max_sources": max_sources, "max_model_calls": max_model_calls,
                       "max_replans": 1, "deadline_ms": 30_000},
            "allowed_effects": ("PURE", "READ"),
            "forbidden_effects": ("WRITE", "FINANCIAL", "IRREVERSIBLE"),
            "abstain_conditions": (
                "fewer_than_three_accepted_evidence_records",
                "fewer_than_two_independent_publishers",
                "citation_or_provenance_validation_fails",
                "runtime_safety_or_budget_gate_fails",
            ),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        return TaskContract(**body, contract_hash=canonical_hash(body))


@dataclass(frozen=True)
class AgentContract:
    agent_id: str
    display_name: str
    role: str
    mission: str
    inputs: tuple[str, ...]
    outputs: tuple[str, ...]
    scopes: tuple[str, ...]
    may_handoff_to: tuple[str, ...]
    forbidden: tuple[str, ...]
    avatar: str

    def public(self) -> dict[str, Any]:
        return asdict(self)


AGENTS: dict[str, AgentContract] = {
    "director": AgentContract(
        "director", "研究总监", "Mission Director", "形式化问题并编译有界研究计划",
        ("user_question",), ("task_contract", "research_plan"),
        ("plan:compile",), ("economist", "news_scout"),
        ("fetch_data", "write_external", "change_contract"), "🧭"),
    "economist": AgentContract(
        "economist", "数据经济学家", "OpenBB Economist", "通过批准的 OpenBB 工具读取宏观序列",
        ("task_contract", "series_manifest"), ("macro_observations",),
        ("openbb:macro:read",), ("evidence_steward",),
        ("news_fetch", "synthesis", "external_write"), "📈"),
    "news_scout": AgentContract(
        "news_scout", "新闻情报员", "News Intelligence", "从多个批准源获取宏观新闻",
        ("task_contract", "news_manifest"), ("news_observations",),
        ("openbb:news:read", "rss:official:read"), ("evidence_steward",),
        ("follow_article_instructions", "synthesis", "external_write"), "🛰️"),
    "evidence_steward": AgentContract(
        "evidence_steward", "证据管理员", "Evidence Steward", "验证来源、时间、哈希、污染与独立性",
        ("macro_observations", "news_observations"), ("evidence_graph", "quarantine"),
        ("evidence:validate",), ("macro_analyst",),
        ("invent_evidence", "change_source", "external_write"), "🗂️"),
    "macro_analyst": AgentContract(
        "macro_analyst", "宏观分析师", "Macro Analyst", "只根据已接受证据提出带引用的研究结论",
        ("task_contract", "evidence_graph"), ("report_proposal",),
        ("analysis:propose",), ("critic",),
        ("fetch_data", "cite_quarantined", "external_write"), "🧠"),
    "critic": AgentContract(
        "critic", "反方审查员", "Critical Verifier", "寻找矛盾、缺失引用与过度自信",
        ("report_proposal", "evidence_graph"), ("verification_result",),
        ("report:verify",), ("governor",),
        ("rewrite_evidence", "approve_own_work", "external_write"), "🔎"),
    "governor": AgentContract(
        "governor", "风险治理官", "Risk Governor", "执行九项检查并决定发布或 ABSTAIN",
        ("verification_result", "runtime_trace"), ("final_report", "principle_checks"),
        ("report:publish",), (),
        ("add_claims", "execute_trade", "external_write"), "🛡️"),
}


@dataclass(frozen=True)
class ToolManifest:
    name: str
    required_scope: str
    effect_class: str
    timeout_ms: int
    max_attempts: int
    input_schema: dict[str, str]
    output_schema: dict[str, str]


TOOLS = {
    "openbb_macro": ToolManifest(
        "openbb_macro", "openbb:macro:read", "READ", 15_000, 2,
        {"symbols": "list[string]"}, {"observations": "list[EvidenceCandidate]"}),
    "openbb_news": ToolManifest(
        "openbb_news", "openbb:news:read", "READ", 15_000, 2,
        {"query": "string", "limit": "integer"}, {"articles": "list[EvidenceCandidate]"}),
    "official_rss": ToolManifest(
        "official_rss", "rss:official:read", "READ", 15_000, 2,
        {"feeds": "list[string]"}, {"articles": "list[EvidenceCandidate]"}),
}


@dataclass(frozen=True)
class HandoffEnvelope:
    handoff_id: str
    contract_id: str
    sender: str
    receiver: str
    payload_type: str
    evidence_ids: tuple[str, ...] = field(default_factory=tuple)
    delegated_scopes: tuple[str, ...] = field(default_factory=tuple)
    envelope_hash: str = ""

    @classmethod
    def create(cls, *, contract_id: str, sender: str, receiver: str,
               payload_type: str, evidence_ids: tuple[str, ...] = (),
               delegated_scopes: tuple[str, ...] = ()) -> "HandoffEnvelope":
        body = {
            "handoff_id": f"HO-{uuid4().hex[:10]}", "contract_id": contract_id,
            "sender": sender, "receiver": receiver, "payload_type": payload_type,
            "evidence_ids": evidence_ids, "delegated_scopes": delegated_scopes,
        }
        return cls(**body, envelope_hash=canonical_hash(body))

    def validate(self) -> list[str]:
        reasons: list[str] = []
        sender = AGENTS.get(self.sender)
        receiver = AGENTS.get(self.receiver)
        if sender is None or receiver is None:
            return ["unknown_agent"]
        if self.receiver not in sender.may_handoff_to:
            reasons.append("handoff_route_not_allowed")
        if not set(self.delegated_scopes).issubset(set(sender.scopes)):
            reasons.append("authority_escalation")
        body = {key: value for key, value in asdict(self).items() if key != "envelope_hash"}
        if canonical_hash(body) != self.envelope_hash:
            reasons.append("handoff_hash_mismatch")
        return reasons
