"""Deterministic CPI factor diagnostics used before any model synthesis."""

from __future__ import annotations

from datetime import date
from math import cos, isfinite, sqrt
from statistics import fmean
from typing import Any


CPI_SERIES: dict[str, dict[str, str]] = {
    "CPIAUCSL": {"label": "Headline CPI", "kind": "target", "publisher": "U.S. Bureau of Labor Statistics"},
    "CPILFESL": {"label": "Core CPI", "kind": "component", "publisher": "U.S. Bureau of Labor Statistics"},
    "CUSR0000SAH1": {"label": "Shelter", "kind": "component", "publisher": "U.S. Bureau of Labor Statistics"},
    "CUSR0000SAF11": {"label": "Food at home", "kind": "component", "publisher": "U.S. Bureau of Labor Statistics"},
    "CUSR0000SETB01": {"label": "Gasoline", "kind": "component", "publisher": "U.S. Bureau of Labor Statistics"},
    "CUSR0000SETA02": {"label": "Used vehicles", "kind": "component", "publisher": "U.S. Bureau of Labor Statistics"},
    "CES0500000003": {"label": "Private hourly earnings", "kind": "upstream", "publisher": "U.S. Bureau of Labor Statistics"},
    "PPIFIS": {"label": "Final-demand PPI", "kind": "upstream", "publisher": "U.S. Bureau of Labor Statistics"},
    "DCOILWTICO": {"label": "WTI crude oil", "kind": "upstream", "publisher": "U.S. Energy Information Administration"},
    "DTWEXBGS": {"label": "Broad U.S. dollar", "kind": "upstream", "publisher": "Board of Governors of the Federal Reserve System"},
}


def _month_shift(year: int, month: int, offset: int) -> str:
    absolute = year * 12 + month - 1 + offset
    return f"{absolute // 12:04d}-{absolute % 12 + 1:02d}-01"


def fixture_cpi_history(months: int = 96) -> dict[str, list[dict[str, Any]]]:
    """Create a deterministic, internally coherent teaching history."""
    end = date.today().replace(day=1)
    start_offset = -(months - 1)
    specs = {
        "CPIAUCSL": (252.0, 0.0027, 0.0008, 9),
        "CPILFESL": (258.0, 0.0029, 0.00045, 11),
        "CUSR0000SAH1": (305.0, 0.0034, 0.00035, 15),
        "CUSR0000SAF11": (245.0, 0.0025, 0.0010, 7),
        "CUSR0000SETB01": (220.0, 0.0016, 0.0100, 3),
        "CUSR0000SETA02": (138.0, 0.0012, 0.0060, 5),
        "CES0500000003": (27.0, 0.0035, 0.0005, 13),
        "PPIFIS": (122.0, 0.0024, 0.0015, 6),
        "DCOILWTICO": (62.0, 0.0010, 0.0180, 4),
        "DTWEXBGS": (105.0, 0.0005, 0.0030, 10),
    }
    result: dict[str, list[dict[str, Any]]] = {}
    for symbol, (level, drift, amplitude, cycle) in specs.items():
        points = []
        current = level
        for index in range(months):
            shock = amplitude * cos(index / cycle) + amplitude * 0.35 * cos(index / 2.7)
            # A late-cycle disinflation pulse makes the fixture useful for diagnostics.
            late = -0.0007 if index > months - 13 and symbol in {"CPIAUCSL", "CPILFESL"} else 0
            current *= 1 + drift + shock + late
            points.append({
                "date": _month_shift(end.year, end.month, start_offset + index),
                "value": round(current, 6),
            })
        result[symbol] = points
    return result


def _changes(values: list[float], periods: int) -> list[float | None]:
    result: list[float | None] = [None] * len(values)
    for index in range(periods, len(values)):
        previous = values[index - periods]
        if previous:
            result[index] = (values[index] / previous - 1) * 100
    return result


def _annualized(values: list[float], periods: int) -> float | None:
    if len(values) <= periods or values[-periods - 1] <= 0:
        return None
    return ((values[-1] / values[-periods - 1]) ** (12 / periods) - 1) * 100


def _pearson(left: list[float], right: list[float]) -> float | None:
    if len(left) < 18 or len(left) != len(right):
        return None
    mean_l, mean_r = fmean(left), fmean(right)
    numerator = sum((a - mean_l) * (b - mean_r) for a, b in zip(left, right))
    denom_l = sum((a - mean_l) ** 2 for a in left)
    denom_r = sum((b - mean_r) ** 2 for b in right)
    if denom_l <= 0 or denom_r <= 0:
        return None
    value = numerator / sqrt(denom_l * denom_r)
    return max(-1.0, min(1.0, value)) if isfinite(value) else None


def _lag_relation(target: dict[str, float], factor: dict[str, float]) -> tuple[int, float | None]:
    best_lag, best_corr = 0, None
    months = sorted(target)
    for lag in range(0, 7):
        xs, ys = [], []
        for index, month in enumerate(months):
            if index < lag:
                continue
            factor_month = months[index - lag]
            if factor_month in factor:
                xs.append(factor[factor_month])
                ys.append(target[month])
        corr = _pearson(xs, ys)
        if corr is not None and (best_corr is None or abs(corr) > abs(best_corr)):
            best_lag, best_corr = lag, corr
    return best_lag, best_corr


def _round(value: float | None, digits: int = 2) -> float | None:
    return None if value is None else round(value, digits)


def analyze_cpi(histories: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    """Return reproducible diagnostics; all calculations are model-independent."""
    cleaned: dict[str, list[dict[str, Any]]] = {}
    for symbol, points in histories.items():
        if symbol not in CPI_SERIES:
            continue
        by_month = {}
        for point in points:
            try:
                value = float(point["value"])
                month = str(point["date"])[:7]
            except (KeyError, TypeError, ValueError):
                continue
            if isfinite(value) and value > 0:
                by_month[month] = value
        cleaned[symbol] = [{"date": month + "-01", "value": value}
                           for month, value in sorted(by_month.items())]
    if len(cleaned.get("CPIAUCSL", [])) < 24:
        raise ValueError("CPI factor study requires at least 24 monthly headline observations")

    headline = cleaned["CPIAUCSL"]
    headline_values = [row["value"] for row in headline]
    headline_months = [row["date"][:7] for row in headline]
    headline_mom = _changes(headline_values, 1)
    target_changes = {month: value for month, value in zip(headline_months, headline_mom)
                      if value is not None}
    diagnostics = []
    evidence_summaries = []
    for symbol, meta in CPI_SERIES.items():
        rows = cleaned.get(symbol, [])
        if len(rows) < 13:
            continue
        values = [row["value"] for row in rows]
        months = [row["date"][:7] for row in rows]
        yoy_series = _changes(values, 12)
        mom_series = _changes(values, 1)
        factor_changes = {month: value for month, value in zip(months, mom_series)
                          if value is not None}
        lag, corr = (0, 1.0) if symbol == "CPIAUCSL" else _lag_relation(target_changes, factor_changes)
        valid_yoy = [value for value in yoy_series if value is not None]
        latest_yoy = valid_yoy[-1] if valid_yoy else None
        mean = fmean(valid_yoy) if valid_yoy else 0
        variance = fmean([(value - mean) ** 2 for value in valid_yoy]) if valid_yoy else 0
        z_score = (latest_yoy - mean) / sqrt(variance) if latest_yoy is not None and variance > 0 else 0
        momentum = _annualized(values, 3)
        acceleration = momentum - latest_yoy if momentum is not None and latest_yoy is not None else None
        if acceleration is None or abs(acceleration) < 0.35:
            signal = "NEUTRAL"
        else:
            signal = "HOTTER" if acceleration > 0 else "COOLER"
        item = {
            "symbol": symbol, "label": meta["label"], "kind": meta["kind"],
            "as_of": rows[-1]["date"], "latest_level": _round(values[-1], 3),
            "yoy": _round(latest_yoy), "momentum_3m_annualized": _round(momentum),
            "acceleration": _round(acceleration), "z_score": _round(z_score),
            "best_lag_months": lag, "lag_correlation": _round(corr), "signal": signal,
            "observation_count": len(rows),
        }
        diagnostics.append(item)
        evidence_summaries.append({
            "symbol": symbol, "label": meta["label"], "publisher": meta["publisher"],
            "as_of": rows[-1]["date"],
            "summary": (f"{meta['label']}: YoY {item['yoy']}%, 3m annualized momentum "
                        f"{item['momentum_3m_annualized']}%, signal {signal}; "
                        f"best 0-6m association with headline monthly inflation is "
                        f"{item['lag_correlation']} at lag {lag}m."),
        })

    chart = []
    core = {row["date"][:7]: value for row, value in zip(
        cleaned.get("CPILFESL", []), _changes([x["value"] for x in cleaned.get("CPILFESL", [])], 12))
        if value is not None}
    for month, value in list(zip(headline_months, _changes(headline_values, 12)))[-36:]:
        if value is not None:
            chart.append({"date": month, "headline": _round(value), "core": _round(core.get(month))})

    headline_diag = next(item for item in diagnostics if item["symbol"] == "CPIAUCSL")
    core_diag = next((item for item in diagnostics if item["symbol"] == "CPILFESL"), None)
    ranked = sorted(
        [item for item in diagnostics if item["kind"] != "target"],
        key=lambda item: abs(item["acceleration"] or 0) * (abs(item["lag_correlation"] or 0) + 0.25),
        reverse=True,
    )
    return {
        "analysis_version": "cpi-factor-v1", "as_of": headline[-1]["date"],
        "headline": headline_diag, "core": core_diag, "factors": ranked,
        "inflation_chart": chart, "evidence_summaries": evidence_summaries,
        "methodology": [
            "YoY = index level versus 12 months earlier.",
            "3m momentum = annualized compound change over the latest three months.",
            "Lag correlation searches 0-6 months against headline CPI monthly changes.",
            "Signals describe momentum/association, not causal contribution or forecast probability.",
        ],
        "limitations": [
            "CPI component weights and relative importance are not used in this version.",
            "Correlations can be unstable, overlapping components create collinearity, and releases may be revised.",
            "Scenario language is research judgment, not investment advice or an executable trade signal.",
        ],
    }


def cpi_evidence(analysis: dict[str, Any], *, fixture: bool) -> list[dict[str, Any]]:
    """Convert diagnostics into the same governed evidence contract as other sources."""
    from .sources import _candidate_id, _now  # avoids duplicating evidence ID behavior

    rows = []
    for summary in analysis["evidence_summaries"]:
        symbol = summary["symbol"]
        uri = (f"openbb-fixture://economy/fred_series/{symbol}" if fixture else
               f"https://fred.stlouisfed.org/series/{symbol}")
        rows.append({
            "candidate_id": _candidate_id("CPI", uri + summary["as_of"]),
            "source_type": "cpi_factor_diagnostic", "source_name": "OpenBB FRED adapter",
            "publisher": summary["publisher"], "uri": uri, "title": summary["label"],
            "content": summary["summary"], "observed_at": summary["as_of"],
            "retrieved_at": _now(), "metric": symbol,
            "value": next(item["yoy"] for item in [analysis["headline"], *analysis["factors"]]
                          if item["symbol"] == symbol),
            "unit": "percent_yoy", "confidence": 0.94, "fixture": fixture,
        })
    return rows
