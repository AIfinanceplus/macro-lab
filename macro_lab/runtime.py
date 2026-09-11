"""Nine-principle, fail-closed macro research runtime."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import hashlib
from time import perf_counter
from typing import Any, Iterator
from uuid import uuid4

from .contracts import AGENTS, TOOLS, ContractCompiler, HandoffEnvelope, canonical_hash
from .cpi_research import (CPI_SERIES, analyze_cpi, cpi_evidence,
                           fixture_cpi_history)
from .model import (ModelProposalError, OpenAICompatibleModel,
                    deterministic_cpi_proposal, deterministic_proposal)
from .security import CapabilityAuthority, scan_untrusted_text
from .sources import (FixtureSources, OfficialRSSSource, OpenBBMacroSource,
                      OpenBBNewsSource, SERIES, SourceUnavailable)
from .storage import RunStore


PRINCIPLES = [
    (1, "任务理解与形式化", "Task Contract"),
    (2, "分层规划与策略搜索", "Bounded DAG"),
    (3, "上下文、状态与记忆", "State / Checkpoint / Redaction"),
    (4, "检索、证据与来源治理", "Evidence Graph"),
    (5, "工具与受控执行 Runtime", "Capability-gated Tools"),
    (6, "多 Agent 协作与交接", "Handoff Contract"),
    (7, "验证、批判与模型评测", "Verifier / Golden behavior"),
    (8, "安全、权限与风险控制", "Fail-closed Policy"),
    (9, "可观测性、恢复与治理", "Trace / Resume / SLO"),
]


PLAN = [
    {"task_id": "C1", "agent": "director", "name": "Compile Task Contract", "depends_on": []},
    {"task_id": "D1", "agent": "economist", "name": "OpenBB Macro Data", "depends_on": ["C1"]},
    {"task_id": "N1", "agent": "news_scout", "name": "OpenBB + Official News", "depends_on": ["C1"]},
    {"task_id": "E1", "agent": "evidence_steward", "name": "Evidence & Taint Gates", "depends_on": ["D1", "N1"]},
    {"task_id": "A1", "agent": "macro_analyst", "name": "Grounded Synthesis", "depends_on": ["E1"]},
    {"task_id": "V1", "agent": "critic", "name": "Adversarial Verification", "depends_on": ["A1"]},
    {"task_id": "G1", "agent": "governor", "name": "Nine-Principle Gate", "depends_on": ["V1"]},
]


class MacroResearchRuntime:
    def __init__(self, store: RunStore | None = None):
        self.store = store or RunStore()

    def manifest(self) -> dict[str, Any]:
        return {
            "name": "Rigorous Macro Research Agent Lab", "version": "0.1.0",
            "principles": [{"number": n, "title": title, "mechanism": mechanism}
                           for n, title, mechanism in PRINCIPLES],
            "agents": [agent.public() for agent in AGENTS.values()],
            "tools": [vars(tool) for tool in TOOLS.values()],
            "plan": PLAN,
            "research_templates": [
                {"id": "cpi_deep_dive", "name": "CPI 影响因子专题研究",
                 "default_question": "研究美国 CPI 的主要影响因子、当前动量、传导时滞与未来情景。"},
                {"id": "macro_regime", "name": "宏观周期综合研判",
                 "default_question": "Assess the current U.S. inflation-growth-policy regime and its key risks."},
            ],
            "openai_models": ["gpt-6-astra", "gpt-5.6-terra", "gpt-5.6-luna"],
            "data_sources": {
                "macro": ["OpenBB ODP", "FRED through OpenBB"],
                "news": ["OpenBB world news", "Federal Reserve RSS", "BLS RSS", "BEA RSS"],
            },
        }

    def run_stream(self, request: dict[str, Any]) -> Iterator[dict[str, Any]]:
        run_id = f"MR-{uuid4().hex[:14]}"
        started = perf_counter()
        state = self._initial_state(run_id, request)
        authority = CapabilityAuthority()

        yield self._emit(state, "run_started", "director", "decision", "START",
                         "研究运行已创建；Runtime 尚未授权任何工具。",
                         {"mode": state["mode"], "scenario": state["scenario"]})
        try:
            contract = ContractCompiler.compile(state["question"])
            state["contract"] = contract.to_dict()
            state["stage"] = "contract_compiled"
            state["status"] = "RUNNING"
            self._checkpoint(state)
            yield self._emit(state, "contract_compiled", "director", "decision", "C1",
                             "自然语言目标已编译为带哈希、预算和拒绝条件的 Task Contract。",
                             state["contract"])

            state["plan"] = deepcopy(PLAN)
            self._checkpoint(state)
            yield self._emit(state, "plan_compiled", "director", "decision", "P1",
                             "依赖图已编译；模型无权直接选择数据端点。",
                             {"tasks": state["plan"], "max_replans": 1})

            for receiver in ("economist", "news_scout"):
                event = self._handoff(state, "director", receiver, "approved_research_task")
                yield event

            macro = yield from self._call_macro_source(state, authority, request)
            news = yield from self._call_news_sources(state, authority, request)
            state["candidates"] = macro + news
            state["stage"] = "sources_collected"
            self._checkpoint(state)

            yield self._handoff(state, "economist", "evidence_steward", "macro_observations")
            yield self._handoff(state, "news_scout", "evidence_steward", "news_observations")
            accepted, quarantined = self._govern_evidence(state["candidates"])
            state["evidence"] = accepted
            state["quarantine"] = quarantined
            state["contradictions"] = self._detect_contradictions(accepted)
            state["stage"] = "evidence_ready"
            state["memory"] = {
                "short_term_keys": ["contract", "plan", "evidence", "quarantine"],
                "long_term_record": {"run_id": run_id, "topic": state["research_type"],
                                     "accepted_evidence_count": len(accepted),
                                     "contains_raw_content": False,
                                     "contains_credentials": False},
                "privacy_redacted": True,
            }
            self.store.append_memory(state["memory"]["long_term_record"])
            self._checkpoint(state)
            yield self._emit(state, "evidence_gate_completed", "evidence_steward", "risk", "E1",
                             f"接受 {len(accepted)} 条证据，隔离 {len(quarantined)} 条不可信内容。",
                             {"accepted": accepted, "quarantined": quarantined,
                              "independent_publishers": len({x["publisher"] for x in accepted}),
                              "contradictions": state["contradictions"]})

            if state["scenario"] == "checkpoint_pause":
                state["status"] = "PAUSED"
                self._checkpoint(state)
                yield self._emit(state, "run_paused", "governor", "risk", "PAUSE",
                                 "已在 Evidence Gate 后持久化；可用同一 run_id 从 A1 恢复。",
                                 {"resume_from": "A1", "checkpoint_persisted": True})
                return

            yield from self._finish(state, request, started)
        except Exception as exc:
            state["status"] = "FAILURE"
            state["stage"] = "terminal"
            state["error"] = f"{type(exc).__name__}: {exc}"
            self._checkpoint(state)
            yield self._emit(state, "run_failed", "governor", "risk", "END",
                             "运行失败；错误已持久化，未产生外部写入副作用。",
                             {"error": state["error"], "effect_count": state["effect_count"]})

    def resume_stream(self, run_id: str, request: dict[str, Any] | None = None) -> Iterator[dict[str, Any]]:
        state = self.store.load_checkpoint(run_id)
        if state.get("status") != "PAUSED" or state.get("stage") != "evidence_ready":
            raise ValueError("only a PAUSED evidence_ready run can be resumed")
        state["status"] = "RUNNING"
        state["scenario"] = "baseline"
        state["resumed"] = True
        state["resume_count"] = int(state.get("resume_count", 0)) + 1
        started = perf_counter()
        self._checkpoint(state)
        yield self._emit(state, "run_resumed", "governor", "risk", "RESUME",
                         "从持久化 Evidence Checkpoint 恢复；不会重新调用数据工具。",
                         {"resume_from": "A1", "tool_calls_replayed": 0})
        yield from self._finish(state, request or {}, started)

    def _finish(self, state: dict[str, Any], request: dict[str, Any],
                started: float) -> Iterator[dict[str, Any]]:
        yield self._handoff(state, "evidence_steward", "macro_analyst", "accepted_evidence_graph",
                            tuple(item["evidence_id"] for item in state["evidence"]))
        model_mode = request.get("model_mode", state.get("model_mode", "deterministic"))
        state["model_mode"] = model_mode
        model_error = None
        if model_mode == "live":
            try:
                proposal = OpenAICompatibleModel().propose(
                    question=state["question"], evidence=state["evidence"],
                    api_key=str(request.get("model_api_key", "")),
                    model=str(request.get("model", "gpt-6-astra")),
                    base_url=str(request.get("model_base_url", "https://api.openai.com/v1")),
                    research_type=state["research_type"], analysis=state.get("cpi_analysis"),
                )
            except ModelProposalError as exc:
                proposal, model_error = None, str(exc)
        else:
            proposal = (deterministic_cpi_proposal(state["evidence"], state["cpi_analysis"])
                        if state["research_type"] == "cpi_deep_dive"
                        else deterministic_proposal(state["evidence"]))
        state["proposal"] = proposal
        state["stage"] = "proposal_created"
        self._checkpoint(state)
        yield self._emit(state, "model_proposal_created" if proposal else "model_proposal_rejected",
                         "macro_analyst", "decision" if proposal else "risk", "A1",
                         "模型只产生研究提议；Runtime 将独立校验引用和权限。" if proposal
                         else "模型提议失败；Runtime 将安全 ABSTAIN。",
                         {"proposal": proposal, "model_mode": model_mode,
                          "model_error": model_error, "api_key_persisted": False})

        yield self._handoff(state, "macro_analyst", "critic", "report_proposal",
                            tuple(item["evidence_id"] for item in state["evidence"]))
        verification = self._verify(state, model_error=model_error)
        elapsed_ms = round((perf_counter() - started) * 1000, 3)
        deadline_ms = state["contract"]["budget"]["deadline_ms"]
        if elapsed_ms > deadline_ms:
            verification["passed"] = False
            verification["reasons"] = sorted(set(
                [*verification["reasons"], "slo_deadline_exceeded"]))
            verification["summary"] = "; ".join(verification["reasons"])
        state["verification"] = verification
        state["stage"] = "verified"
        self._checkpoint(state)
        yield self._emit(state, "verification_completed", "critic", "risk", "V1",
                         "引用、证据覆盖、矛盾披露和禁止行为已完成确定性检查。",
                         verification)

        yield self._handoff(state, "critic", "governor", "verification_result",
                            tuple(item["evidence_id"] for item in state["evidence"]))
        outcome = "COMPLETE" if verification["passed"] else "ABSTAIN"
        report = deepcopy(state.get("proposal") or {
            "executive_summary": "证据或模型输出未满足发布契约。",
            "claims": [], "risks": [verification["summary"]], "confidence": 0.0,
        })
        report.update({
            "status": outcome, "research_only": True, "automatic_execution": False,
            "effect_count": state["effect_count"], "contract_id": state["contract"]["contract_id"],
            "run_id": state["run_id"], "data_mode": state["mode"],
            "fixture_disclaimer": state["mode"] == "fixture",
            "research_type": state["research_type"],
            "cpi_analysis": state.get("cpi_analysis"),
        })
        state["report"] = report
        checks = self._principle_checks(state, elapsed_ms=elapsed_ms)
        state["principle_checks"] = checks
        state["status"] = outcome
        state["stage"] = "terminal"
        state["elapsed_ms"] = elapsed_ms
        self._checkpoint(state)
        yield self._emit(state, "principles_evaluated", "governor", "risk", "G1",
                         f"九项原则逐项核对：{sum(1 for x in checks if x['passed'])}/9 通过。",
                         {"checks": checks})
        yield self._emit(state, "run_completed", "governor", "decision", "END",
                         "研究报告已发布。" if outcome == "COMPLETE"
                         else "证据不足或验证失败，Agent 主动 ABSTAIN。",
                         {"report": report, "elapsed_ms": elapsed_ms,
                          "effect_count": state["effect_count"], "checks": checks})

    def _call_macro_source(self, state: dict[str, Any], authority: CapabilityAuthority,
                           request: dict[str, Any]) -> Iterator[dict[str, Any]]:
        ticket = authority.mint(run_id=state["run_id"],
                                contract_id=state["contract"]["contract_id"],
                                agent_id="economist", tool_name="openbb_macro")
        yield self._emit(state, "capability_minted", "governor", "risk", "D1",
                         "Runtime 签发一次性、只读 OpenBB 宏观数据能力票据。", ticket.public())
        authority.authorize(ticket, run_id=state["run_id"],
                            contract_id=state["contract"]["contract_id"],
                            agent_id="economist", tool_name="openbb_macro")
        state["tool_calls"].append({"tool": "openbb_macro", "effect": "READ", "authorized": True})
        symbols = list(CPI_SERIES) if state["research_type"] == "cpi_deep_dive" else list(SERIES)
        yield self._emit(state, "tool_started", "economist", "information", "D1",
                         "读取批准的宏观序列。", {"symbols": symbols, "secret_fields": []})
        try:
            if state["research_type"] == "cpi_deep_dive":
                histories = (OpenBBMacroSource().fetch_history(
                    symbols=symbols, fred_api_key=str(request.get("fred_api_key", "")), years=8)
                    if state["mode"] == "live" else fixture_cpi_history())
                analysis = analyze_cpi(histories)
                state["cpi_analysis"] = analysis
                rows = cpi_evidence(analysis, fixture=state["mode"] == "fixture")
                yield self._emit(state, "cpi_analysis_completed", "economist", "information", "D1",
                                 "CPI 同比、3m 年化动量、z-score 与 0–6 月领先滞后已确定性计算。",
                                 {"analysis": analysis, "model_used": False,
                                  "causal_claim": False, "effect_count": 0})
            elif state["mode"] == "live":
                rows = OpenBBMacroSource().fetch(symbols=symbols,
                                                 fred_api_key=str(request.get("fred_api_key", "")))
            else:
                rows = FixtureSources.macro(scenario=state["scenario"])
            yield self._emit(state, "tool_observation", "economist", "information", "D1",
                             f"OpenBB 适配器返回 {len(rows)} 条标准化宏观观测。",
                             {"count": len(rows), "provider": "OpenBB", "effect_count": 0})
            return rows
        except SourceUnavailable as exc:
            state["source_errors"].append(str(exc))
            yield self._emit(state, "source_failed", "economist", "risk", "D1",
                             "OpenBB 数据源失败；不以教学数据静默替代 Live 数据。",
                             {"error": str(exc), "fallback_used": False})
            return []

    def _call_news_sources(self, state: dict[str, Any], authority: CapabilityAuthority,
                           request: dict[str, Any]) -> Iterator[dict[str, Any]]:
        all_rows: list[dict[str, Any]] = []
        tools = ("openbb_news", "official_rss") if state["mode"] == "live" else ("openbb_news",)
        for tool_name in tools:
            ticket = authority.mint(run_id=state["run_id"],
                                    contract_id=state["contract"]["contract_id"],
                                    agent_id="news_scout", tool_name=tool_name)
            yield self._emit(state, "capability_minted", "governor", "risk", "N1",
                             f"Runtime 签发一次性、只读 {tool_name} 能力票据。", ticket.public())
            authority.authorize(ticket, run_id=state["run_id"],
                                contract_id=state["contract"]["contract_id"],
                                agent_id="news_scout", tool_name=tool_name)
            state["tool_calls"].append({"tool": tool_name, "effect": "READ", "authorized": True})
            yield self._emit(state, "tool_started", "news_scout", "information", "N1",
                             f"从 {tool_name} 获取不可信新闻数据。", {"effect": "READ"})
            try:
                if state["mode"] == "fixture":
                    rows = FixtureSources.news(scenario=state["scenario"])
                elif tool_name == "openbb_news":
                    rows = OpenBBNewsSource().fetch(
                        query=str(request.get("news_query", "inflation labor Federal Reserve growth")),
                        provider=str(request.get("news_provider", "")),
                        api_key=str(request.get("news_api_key", "")), limit=8)
                else:
                    rows = OfficialRSSSource().fetch(limit_per_feed=3)
                all_rows.extend(rows)
                yield self._emit(state, "tool_observation", "news_scout", "information", "N1",
                                 f"{tool_name} 返回 {len(rows)} 条候选新闻。",
                                 {"count": len(rows), "provider": tool_name, "effect_count": 0})
            except SourceUnavailable as exc:
                state["source_errors"].append(str(exc))
                yield self._emit(state, "source_failed", "news_scout", "risk", "N1",
                                 f"{tool_name} 失败；其他独立来源仍可继续。",
                                 {"error": str(exc), "fallback_used": False})
        return all_rows

    @staticmethod
    def _govern_evidence(candidates: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        accepted, quarantine = [], []
        seen_hashes = set()
        for candidate in candidates:
            content = str(candidate.get("content", ""))
            content_hash = hashlib.sha256(content.encode()).hexdigest()
            hits = scan_untrusted_text(content)
            item = deepcopy(candidate)
            freshness = MacroResearchRuntime._freshness(candidate.get("observed_at"),
                                                        fixture=bool(candidate.get("fixture")))
            item.update({
                "evidence_id": f"E-{content_hash[:12]}", "content_hash": content_hash,
                "taint_status": "QUARANTINED" if hits else "CLEAN",
                "injection_hits": hits, "provenance_complete": all(
                    item.get(key) for key in ("publisher", "uri", "retrieved_at", "observed_at")),
                "freshness_status": freshness,
            })
            if hits or not item["provenance_complete"] or freshness != "FRESH":
                item["rejection_reason"] = (
                    "prompt_injection" if hits else
                    "incomplete_provenance" if not item["provenance_complete"] else
                    f"evidence_{freshness.lower()}"
                )
                quarantine.append(item)
            elif content_hash not in seen_hashes:
                seen_hashes.add(content_hash)
                accepted.append(item)
        return accepted, quarantine

    @staticmethod
    def _freshness(value: Any, *, fixture: bool) -> str:
        if fixture:
            return "FRESH"
        if not value:
            return "UNKNOWN"
        text = str(value).strip().replace("Z", "+00:00")
        observed = None
        try:
            observed = datetime.fromisoformat(text)
        except ValueError:
            try:
                observed = parsedate_to_datetime(text)
            except (TypeError, ValueError):
                return "UNKNOWN"
        if observed.tzinfo is None:
            observed = observed.replace(tzinfo=timezone.utc)
        age_days = (datetime.now(timezone.utc) - observed.astimezone(timezone.utc)).total_seconds() / 86400
        return "FRESH" if -1 <= age_days <= 120 else "STALE"

    @staticmethod
    def _detect_contradictions(evidence: list[dict[str, Any]]) -> list[dict[str, Any]]:
        by_metric: dict[str, list[dict[str, Any]]] = {}
        for item in evidence:
            if item.get("metric") and isinstance(item.get("value"), (int, float)):
                by_metric.setdefault(item["metric"], []).append(item)
        contradictions = []
        for metric, rows in by_metric.items():
            values = [float(row["value"]) for row in rows]
            if len(values) > 1 and max(values) - min(values) > max(0.1, abs(sum(values) / len(values)) * 0.05):
                contradictions.append({"metric": metric,
                                       "evidence_ids": [row["evidence_id"] for row in rows],
                                       "values": values})
        return contradictions

    @staticmethod
    def _verify(state: dict[str, Any], *, model_error: str | None) -> dict[str, Any]:
        evidence_ids = {item["evidence_id"] for item in state["evidence"]}
        quarantined_ids = {item["evidence_id"] for item in state["quarantine"]}
        proposal = state.get("proposal")
        reasons = []
        citation_ids: list[str] = []
        if model_error:
            reasons.append("model_proposal_failed")
        if not isinstance(proposal, dict):
            reasons.append("proposal_missing")
        else:
            claims = proposal.get("claims")
            if not isinstance(claims, list) or not claims:
                reasons.append("claims_missing")
            else:
                for claim in claims:
                    ids = claim.get("evidence_ids") if isinstance(claim, dict) else None
                    if not isinstance(ids, list) or not ids:
                        reasons.append("claim_without_citation")
                        continue
                    citation_ids.extend(ids)
                    if claim.get("classification") not in {"FACT", "INFERENCE", "SCENARIO"}:
                        reasons.append("claim_classification_invalid")
            for section in ("factor_assessment", "scenario_outlook"):
                rows = proposal.get(section, [])
                if not isinstance(rows, list):
                    reasons.append(f"{section}_invalid")
                    continue
                for row in rows:
                    ids = row.get("evidence_ids") if isinstance(row, dict) else None
                    if not isinstance(ids, list):
                        reasons.append(f"{section}_citation_invalid")
                    else:
                        citation_ids.extend(ids)
            if not set(citation_ids).issubset(evidence_ids):
                reasons.append("unknown_or_quarantined_citation")
            if set(citation_ids) & quarantined_ids:
                reasons.append("quarantined_evidence_cited")
            confidence = proposal.get("confidence")
            if not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1:
                reasons.append("confidence_invalid")
        publishers = {item["publisher"] for item in state["evidence"]}
        sufficient = len(state["evidence"]) >= 3 and len(publishers) >= 2
        if not sufficient:
            reasons.append("insufficient_independent_evidence")
        passed = not reasons
        return {
            "passed": passed, "reasons": sorted(set(reasons)),
            "summary": "all deterministic verification gates passed" if passed
                       else "; ".join(sorted(set(reasons))),
            "citation_ids": citation_ids, "accepted_evidence_ids": sorted(evidence_ids),
            "independent_publishers": len(publishers), "sufficient_evidence": sufficient,
            "contradictions": state.get("contradictions", []),
        }

    def _principle_checks(self, state: dict[str, Any], *, elapsed_ms: float) -> list[dict[str, Any]]:
        contract = state["contract"]
        body = {k: v for k, v in contract.items() if k != "contract_hash"}
        verification = state["verification"]
        safe_abstain = not verification["passed"] and state["report"]["status"] == "ABSTAIN"
        event_rows = self.store.events(state["run_id"])
        handoffs_ok = bool(state["handoffs"]) and all(row["passed"] for row in state["handoffs"])
        checks = [
            (1, canonical_hash(body) == contract["contract_hash"] and bool(contract["success_criteria"]),
             "目标、成功标准、预算、权限和拒绝条件已固化并校验哈希。"),
            (2, len(state["plan"]) == 7 and all("depends_on" in task for task in state["plan"]),
             "七节点有界 DAG、显式依赖和最多一次重规划。"),
            (3, state["memory"]["privacy_redacted"] and
                not state["memory"]["long_term_record"]["contains_credentials"],
             "短期 State、持久化 Checkpoint 与脱敏长期记忆彼此分离。"),
            (4, (verification["sufficient_evidence"] and
                 all(item["provenance_complete"] and item["freshness_status"] == "FRESH"
                     for item in state["evidence"])) or safe_abstain,
             "证据有来源、时间和内容哈希；不足时强制 ABSTAIN。"),
            (5, bool(state["tool_calls"]) and
                all(call["authorized"] and call["effect"] == "READ" for call in state["tool_calls"]) and
                state["effect_count"] == 0,
             "每次 Tool 调用均经一次性 Capability 授权，外部写入为零。"),
            (6, handoffs_ok,
             "Agent 只按允许路线交接，Handoff 不传递或扩大工具权限。"),
            (7, verification["passed"] or safe_abstain,
             "Critic 检查所有引用；失败被转化为安全 ABSTAIN。"),
            (8, state["effect_count"] == 0 and
                all(item["taint_status"] == "QUARANTINED" for item in state["quarantine"]),
             "外部内容仅是 Data；恶意指令被隔离且不能触发副作用。"),
            (9, bool(event_rows) and all(row["run_id"] == state["run_id"] for row in event_rows)
                and elapsed_ms <= contract["budget"]["deadline_ms"],
             "事件先持久化再发布，具备序号、Root Trace、Checkpoint、恢复与 SLO。"),
        ]
        titles = {number: (title, mechanism) for number, title, mechanism in PRINCIPLES}
        return [{"number": number, "title": titles[number][0], "mechanism": titles[number][1],
                 "passed": bool(passed), "evidence": detail}
                for number, passed, detail in checks]

    def _handoff(self, state: dict[str, Any], sender: str, receiver: str,
                 payload_type: str, evidence_ids: tuple[str, ...] = ()) -> dict[str, Any]:
        envelope = HandoffEnvelope.create(
            contract_id=state["contract"]["contract_id"], sender=sender, receiver=receiver,
            payload_type=payload_type, evidence_ids=evidence_ids, delegated_scopes=())
        reasons = envelope.validate()
        state["handoffs"].append({"sender": sender, "receiver": receiver,
                                  "passed": not reasons, "reasons": reasons,
                                  "envelope_hash": envelope.envelope_hash})
        return self._emit(state, "handoff_accepted" if not reasons else "handoff_rejected",
                          receiver, "decision" if not reasons else "risk", "HANDOFF",
                          f"{AGENTS[sender].display_name} → {AGENTS[receiver].display_name}："
                          + ("契约通过。" if not reasons else "交接拒绝。"),
                          {"envelope": vars(envelope), "reasons": reasons,
                           "authority_escalation": False if not reasons else None})

    def _initial_state(self, run_id: str, request: dict[str, Any]) -> dict[str, Any]:
        mode = str(request.get("mode", "fixture"))
        if mode not in {"fixture", "live"}:
            raise ValueError("mode must be fixture or live")
        scenario = str(request.get("scenario", "baseline"))
        if scenario not in {"baseline", "tainted_news", "evidence_gap", "checkpoint_pause"}:
            raise ValueError("unsupported scenario")
        research_type = str(request.get("research_type", "macro_regime"))
        if research_type not in {"macro_regime", "cpi_deep_dive"}:
            raise ValueError("unsupported research_type")
        return {
            "schema_version": 1, "run_id": run_id, "trace_id": f"TRACE-{run_id}",
            "sequence": 0, "status": "CREATED", "stage": "created",
            "question": str(request.get("question") or (
                "研究美国 CPI 的主要影响因子、当前动量、传导时滞与未来情景。"
                if research_type == "cpi_deep_dive" else
                "Assess the current U.S. inflation-growth-policy regime and its key risks.")),
            "mode": mode, "scenario": scenario,
            "research_type": research_type, "cpi_analysis": None,
            "model_mode": str(request.get("model_mode", "deterministic")),
            "contract": None, "plan": [], "candidates": [], "evidence": [],
            "quarantine": [], "contradictions": [], "tool_calls": [], "handoffs": [], "source_errors": [],
            "proposal": None, "verification": None, "report": None,
            "principle_checks": [], "memory": {}, "effect_count": 0,
            "resume_count": 0, "resumed": False,
        }

    def _checkpoint(self, state: dict[str, Any]) -> None:
        self.store.save_checkpoint(state["run_id"], deepcopy(state))

    def _emit(self, state: dict[str, Any], event_type: str, actor: str, flow: str,
              stage: str, message: str, data: dict[str, Any]) -> dict[str, Any]:
        state["sequence"] += 1
        event = {
            "schema_version": 1, "run_id": state["run_id"], "trace_id": state["trace_id"],
            "sequence": state["sequence"], "timestamp": datetime.now(timezone.utc).isoformat(),
            "type": event_type, "actor": actor, "actor_name": AGENTS[actor].display_name,
            "flow": flow, "stage": stage, "message": message, "data": data,
            "persisted_before_publish": True,
        }
        self.store.append_event(state["run_id"], event)
        # Keep the checkpoint sequence aligned with the event that is about to
        # be published. This prevents duplicate sequence IDs after resume.
        self.store.save_checkpoint(state["run_id"], deepcopy(state))
        return event
