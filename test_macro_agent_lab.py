import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from macro_lab.contracts import HandoffEnvelope
from macro_lab.cpi_research import analyze_cpi, fixture_cpi_history
from macro_lab.model import OpenAICompatibleModel
from macro_lab.runtime import MacroResearchRuntime
from macro_lab.sources import (OpenBBMacroSource, OpenBBNewsSource,
                               SourceUnavailable, preload_openbb)
from macro_lab.storage import RunStore


class MacroAgentLabTests(unittest.TestCase):
    def runtime(self, directory):
        return MacroResearchRuntime(RunStore(directory))

    def test_baseline_passes_all_nine_principles(self):
        with TemporaryDirectory() as directory:
            events = list(self.runtime(directory).run_stream({
                "mode": "fixture", "scenario": "baseline",
                "question": "Assess the U.S. inflation, labor, rates and policy regime.",
            }))
            terminal = events[-1]
            self.assertEqual(terminal["type"], "run_completed")
            self.assertEqual(terminal["data"]["report"]["status"], "COMPLETE")
            self.assertTrue(all(check["passed"] for check in terminal["data"]["checks"]))
            self.assertEqual(terminal["data"]["effect_count"], 0)

    def test_cpi_deep_dive_builds_diagnostics_and_institutional_report(self):
        with TemporaryDirectory() as directory:
            events = list(self.runtime(directory).run_stream({
                "research_type": "cpi_deep_dive", "mode": "fixture",
                "scenario": "baseline", "model_mode": "deterministic",
            }))
            analysis_event = next(event for event in events
                                  if event["type"] == "cpi_analysis_completed")
            self.assertFalse(analysis_event["data"]["model_used"])
            self.assertFalse(analysis_event["data"]["causal_claim"])
            report = events[-1]["data"]["report"]
            self.assertEqual(report["status"], "COMPLETE")
            self.assertEqual(report["research_type"], "cpi_deep_dive")
            self.assertEqual(report["cpi_analysis"]["analysis_version"], "cpi-factor-v1")
            self.assertEqual(len(report["scenario_outlook"]), 3)
            self.assertTrue(all(claim["evidence_ids"] for claim in report["claims"]))

    def test_cpi_factor_math_is_reproducible_and_not_labeled_causal(self):
        analysis = analyze_cpi(fixture_cpi_history())
        self.assertEqual(len(analysis["inflation_chart"]), 36)
        self.assertGreaterEqual(len(analysis["factors"]), 8)
        self.assertTrue(all(0 <= item["best_lag_months"] <= 6
                            for item in analysis["factors"]))
        self.assertIn("not causal", " ".join(analysis["methodology"]))

    def test_openai_model_uses_responses_api_and_strict_schema(self):
        captured = {}
        model_result = {
            "output": [{"type": "message", "content": [{
                "type": "output_text", "text": json.dumps({
                    "report_title": "CPI report", "executive_summary": "Summary",
                    "key_findings": ["Finding"],
                    "claims": [{"text": "Fact", "evidence_ids": ["E-1"],
                                "classification": "FACT"}],
                    "factor_assessment": [], "scenario_outlook": [],
                    "risks": ["Risk"], "methodology": ["Method"], "confidence": 0.7,
                })
            }]}]
        }

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self):
                return json.dumps(model_result).encode()

        def fake_urlopen(request, **kwargs):
            captured["url"] = request.full_url
            captured["payload"] = json.loads(request.data)
            return FakeResponse()

        evidence = [{"evidence_id": "E-1", "title": "CPI", "content": "2.5%",
                     "publisher": "BLS", "observed_at": "2026-08-01",
                     "metric": "CPIAUCSL", "value": 2.5, "unit": "percent_yoy"}]
        with patch("macro_lab.model.urlopen", side_effect=fake_urlopen), \
             patch("macro_lab.model.system_ssl_context", return_value=None):
            result = OpenAICompatibleModel().propose(
                question="Research U.S. CPI factors", evidence=evidence,
                api_key="request-only-key", model="gpt-6-astra",
                base_url="https://api.openai.com/v1", research_type="cpi_deep_dive")
        self.assertEqual(captured["url"], "https://api.openai.com/v1/responses")
        self.assertTrue(captured["payload"]["text"]["format"]["strict"])
        self.assertFalse(captured["payload"]["store"])
        self.assertEqual(result["claims"][0]["classification"], "FACT")

    def test_tainted_news_is_quarantined_and_never_cited(self):
        with TemporaryDirectory() as directory:
            events = list(self.runtime(directory).run_stream({
                "mode": "fixture", "scenario": "tainted_news",
            }))
            gate = next(event for event in events if event["type"] == "evidence_gate_completed")
            self.assertEqual(len(gate["data"]["quarantined"]), 1)
            tainted = gate["data"]["quarantined"][0]
            self.assertEqual(tainted["taint_status"], "QUARANTINED")
            cited = {citation for claim in events[-1]["data"]["report"]["claims"]
                     for citation in claim["evidence_ids"]}
            self.assertNotIn(tainted["evidence_id"], cited)
            self.assertEqual(events[-1]["data"]["effect_count"], 0)

    def test_evidence_gap_abstains_but_safety_contracts_pass(self):
        with TemporaryDirectory() as directory:
            events = list(self.runtime(directory).run_stream({
                "mode": "fixture", "scenario": "evidence_gap",
            }))
            terminal = events[-1]
            self.assertEqual(terminal["data"]["report"]["status"], "ABSTAIN")
            self.assertTrue(all(check["passed"] for check in terminal["data"]["checks"]))
            verification = next(event for event in events
                                if event["type"] == "verification_completed")
            self.assertIn("insufficient_independent_evidence", verification["data"]["reasons"])

    def test_checkpoint_resume_does_not_repeat_tool_calls(self):
        with TemporaryDirectory() as directory:
            runtime = self.runtime(directory)
            first = list(runtime.run_stream({"mode": "fixture", "scenario": "checkpoint_pause"}))
            self.assertEqual(first[-1]["type"], "run_paused")
            run_id = first[-1]["run_id"]
            resumed = list(runtime.resume_stream(run_id))
            self.assertEqual(resumed[0]["type"], "run_resumed")
            self.assertEqual(resumed[0]["data"]["tool_calls_replayed"], 0)
            self.assertFalse(any(event["type"] == "tool_started" for event in resumed))
            all_events = runtime.store.events(run_id)
            self.assertEqual([event["sequence"] for event in all_events],
                             list(range(1, len(all_events) + 1)))

    def test_handoff_rejects_authority_escalation(self):
        envelope = HandoffEnvelope.create(
            contract_id="C-1", sender="director", receiver="economist",
            payload_type="task", delegated_scopes=("openbb:macro:read",))
        self.assertIn("authority_escalation", envelope.validate())

    def test_openbb_adapter_uses_documented_fred_series_surface(self):
        class FakeRow:
            def items(self):
                return [("value", 4.125)]

        class FakeILoc:
            def __getitem__(self, key):
                return FakeRow()

        class FakeFrame:
            empty = False
            iloc = FakeILoc()
            index = ["2026-09-09"]

            def dropna(self, how):
                self.dropna_how = how
                return self

        calls = []

        class FakeResult:
            def to_dataframe(self):
                return FakeFrame()

        def fred_series(**kwargs):
            calls.append(kwargs)
            return FakeResult()

        credentials = SimpleNamespace(fred_api_key=None)
        fake_obb = SimpleNamespace(
            economy=SimpleNamespace(fred_series=fred_series),
            user=SimpleNamespace(credentials=credentials),
        )
        with patch("macro_lab.sources.importlib.import_module",
                   return_value=SimpleNamespace(obb=fake_obb)):
            rows = OpenBBMacroSource().fetch(symbols=["DGS10"], fred_api_key="secret")
        self.assertEqual(calls[0]["symbol"], "DGS10")
        self.assertEqual(calls[0]["provider"], "fred")
        self.assertRegex(calls[0]["start_date"], r"^\d{4}-\d{2}-\d{2}$")
        self.assertEqual(rows[0]["metric"], "DGS10")
        self.assertEqual(rows[0]["value"], 4.125)
        self.assertFalse(rows[0]["fixture"])
        self.assertIsNone(credentials.fred_api_key)

    def test_openbb_preload_builds_lazy_routes_before_requests(self):
        fake_obb = SimpleNamespace(
            economy=SimpleNamespace(fred_series=lambda: None),
            news=SimpleNamespace(world=lambda: None),
        )
        with patch("macro_lab.sources.importlib.import_module",
                   return_value=SimpleNamespace(obb=fake_obb)) as imported:
            ready, status = preload_openbb()
        self.assertTrue(ready)
        self.assertEqual(status, "ready")
        imported.assert_called_once_with("openbb")

    def test_openbb_provider_failure_becomes_safe_source_unavailable(self):
        def fail(**kwargs):
            raise ValueError("signal only works in main thread of the main interpreter")

        fake_obb = SimpleNamespace(
            economy=SimpleNamespace(fred_series=fail),
            user=SimpleNamespace(credentials=SimpleNamespace(fred_api_key=None)),
        )
        with patch("macro_lab.sources.importlib.import_module",
                   return_value=SimpleNamespace(obb=fake_obb)):
            with self.assertRaisesRegex(SourceUnavailable, "OpenBB FRED request failed"):
                OpenBBMacroSource().fetch(symbols=["DGS10"], fred_api_key="secret")

    def test_cpi_is_transformed_from_index_to_year_over_year_percent(self):
        class FakeSeries:
            def __init__(self):
                self.values = [(f"2025-{month:02d}-01", 100.0)
                               for month in range(1, 13)] + [("2026-01-01", 103.0)]

            def dropna(self):
                return self

            def items(self):
                return iter(self.values)

        class FakeFrame:
            empty = False
            columns = ["CPIAUCSL"]

            def dropna(self, how):
                return self

            def __getitem__(self, key):
                return FakeSeries()

        output = SimpleNamespace(to_dataframe=lambda: FakeFrame())
        obb = SimpleNamespace(economy=SimpleNamespace(
            fred_series=lambda **kwargs: output))
        rows = OpenBBMacroSource._fetch_symbol(obb, "CPIAUCSL")
        self.assertAlmostEqual(rows[0]["value"], 3.0)
        self.assertEqual(rows[0]["unit"], "percent_yoy")
        self.assertIn("12-month percentage change", rows[0]["content"])

    def test_openbb_news_adapter_uses_world_news_surface_and_filters_query(self):
        class FakeRecord:
            def to_dict(self):
                return {
                    "title": "Federal Reserve discusses inflation outlook",
                    "text": "Policy remains sensitive to inflation data.",
                    "url": "https://example.test/article",
                    "source": "Test Wire",
                    "date": "2026-09-09",
                }

        class FakeFrame:
            def head(self, count):
                return self

            def iterrows(self):
                return iter([(0, FakeRecord())])

        calls = []

        def world(**kwargs):
            calls.append(kwargs)
            return SimpleNamespace(to_dataframe=lambda: FakeFrame())

        credentials = SimpleNamespace(tiingo_token=None)
        fake_obb = SimpleNamespace(
            news=SimpleNamespace(world=world),
            user=SimpleNamespace(credentials=credentials),
        )
        with patch("macro_lab.sources.importlib.import_module",
                   return_value=SimpleNamespace(obb=fake_obb)):
            rows = OpenBBNewsSource().fetch(
                query="inflation labor policy", provider="tiingo",
                api_key="news-secret", limit=8)
        self.assertEqual(calls, [{"limit": 8, "provider": "tiingo"}])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["source_type"], "openbb_news")
        self.assertIsNone(credentials.tiingo_token)

    def test_secrets_are_absent_from_trace_checkpoint_and_memory(self):
        with TemporaryDirectory() as directory:
            runtime = self.runtime(directory)
            secret = "TOP-SECRET-KEY-MUST-NOT-PERSIST"
            events = list(runtime.run_stream({
                "mode": "fixture", "scenario": "baseline", "model_api_key": secret,
                "fred_api_key": secret, "news_api_key": secret,
            }))
            run_id = events[-1]["run_id"]
            serialized = json.dumps({"events": runtime.store.events(run_id),
                                     "checkpoint": runtime.store.load_checkpoint(run_id)})
            memory = Path(directory, "long_term_memory.json").read_text(encoding="utf-8")
            self.assertNotIn(secret, serialized)
            self.assertNotIn(secret, memory)

    def test_ui_exposes_agents_three_flows_and_nine_checks(self):
        root = Path(__file__).resolve().parent
        html = (root / "web/macro_lab.html").read_text(encoding="utf-8")
        js = (root / "web/macro_lab.js").read_text(encoding="utf-8")
        self.assertIn("信息流 · 决策流 · 风险流", html)
        self.assertIn("9-PRINCIPLE CONFORMANCE", html)
        self.assertIn("Resume from checkpoint", html)
        self.assertIn("event belongs to another run", js)
        self.assertIn("↻ Run again", js)

    def test_3d_architecture_exposes_full_system_without_webgl(self):
        root = Path(__file__).resolve().parent
        html = (root / "web/macro_architecture.html").read_text(encoding="utf-8")
        js = (root / "web/macro_architecture.js").read_text(encoding="utf-8")
        server = (root / "serve_macro_lab.py").read_text(encoding="utf-8")
        self.assertIn('id="architecture-canvas"', html)
        self.assertIn("Story mode", html)
        self.assertIn("Visible flows", html)
        self.assertIn("canvas.getContext('2d')", js)
        self.assertNotIn("WebGLRenderer", js)
        self.assertEqual(js.count("plane:'agent'"), 7)
        self.assertIn("9-Principle Gate", js)
        self.assertIn("pinchDistance", js)
        self.assertIn('path in {"/architecture", "/architecture/"}', server)


if __name__ == "__main__":
    unittest.main()
