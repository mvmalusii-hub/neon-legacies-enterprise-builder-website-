"""Triage: what a human has to look at, and what can be trusted.

The confidence field is only useful if something acts on it. This module splits
an Onboard batch into:

* **auto**   – high/medium confidence, classified industry, validator-clean
* **review** – low confidence, `Unclassified`, or a failed call

`Unclassified` is never auto-accepted: it means the industry list or the prompt
needs work, not that the client has no industry.
"""
from __future__ import annotations

from typing import Any, Dict, List, Tuple

REVIEW_REASONS = {
    "low_confidence": "confidence is low – closest-match classification",
    "unclassified": "no industry matched – expand the list or the prompt",
    "failed": "the call did not produce valid output",
}


def classify(rows: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]],
                                                  List[Dict[str, Any]]]:
    auto: List[Dict[str, Any]] = []
    review: List[Dict[str, Any]] = []
    for row in rows:
        output = row.get("output") or {}
        reasons: List[str] = []
        if not output.get("ok"):
            reasons.append(REVIEW_REASONS["failed"])
        data = output.get("data") or {}
        if data.get("industry") == "Unclassified":
            reasons.append(REVIEW_REASONS["unclassified"])
        if data.get("confidence") == "low":
            reasons.append(REVIEW_REASONS["low_confidence"])
        if reasons:
            review.append({**row, "review_reasons": reasons})
        else:
            auto.append(row)
    return auto, review


def summarise(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    auto, review = classify(rows)
    counts: Dict[str, int] = {}
    for row in rows:
        industry = ((row.get("output") or {}).get("data") or {}).get("industry")
        if industry:
            counts[industry] = counts.get(industry, 0) + 1
    return {"total": len(rows), "auto": len(auto), "review": len(review),
            "by_industry": counts}
