"""Deterministic stand-in for the provider SDK.

Used by `cli.py --offline`, by `selftest`, and by the unit tests. It produces
outputs that *obey the same rules as a good model* – roadmap sizes come from the
industry table and category counts add up – so the wiring, validation and
retry paths can be exercised with no API key and no network.
"""
from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any, Dict, List, Optional

from .validate import load_industries


class FakeClient:
    """Returns queued payloads in order; accepts dicts, JSON strings or exceptions."""

    def __init__(self, queue: Optional[List[Any]] = None) -> None:
        self.queue = list(queue or [])
        self.calls: List[Dict[str, Any]] = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        if not self.queue:
            raise AssertionError("FakeClient ran out of queued responses")
        item = self.queue.pop(0)
        if isinstance(item, Exception):
            raise item
        payload = item if isinstance(item, str) else json.dumps(item)
        message = SimpleNamespace(
            content=None,
            tool_calls=[SimpleNamespace(function=SimpleNamespace(arguments=payload))],
        )
        usage = SimpleNamespace(prompt_tokens=100, completion_tokens=50, total_tokens=150)
        usage.model_dump = lambda: {"prompt_tokens": 100, "completion_tokens": 50,
                                    "total_tokens": 150}
        return SimpleNamespace(
            choices=[SimpleNamespace(message=message, finish_reason="stop")],
            usage=usage,
        )


class FakeContentClient:
    """Provider that answers in `message.content` (no tool call), fences and all.

    Some OpenAI-compatible backends ignore `tool_choice` and return prose or a
    fenced code block; this is the client that proves the fallback works.
    """

    def __init__(self, payloads: List[Any]) -> None:
        self.queue = list(payloads)
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kwargs: Any) -> Any:
        if not self.queue:
            raise AssertionError("FakeContentClient ran out of queued responses")
        item = self.queue.pop(0)
        text = item if isinstance(item, str) else json.dumps(item)
        message = SimpleNamespace(content=text, tool_calls=[])
        usage = SimpleNamespace(prompt_tokens=100, completion_tokens=50, total_tokens=150)
        usage.model_dump = lambda: {"prompt_tokens": 100, "completion_tokens": 50,
                                    "total_tokens": 150}
        return SimpleNamespace(
            choices=[SimpleNamespace(message=message, finish_reason="stop")],
            usage=usage,
        )


def good_onboard(industry: str = "Construction") -> Dict[str, Any]:
    table = load_industries()
    size = table["industries"][industry]["roadmap_size"]
    return {
        "industry": industry,
        "roadmap_size": size,
        "first_three_documents": [
            "CIPC CoR14.1",
            "SARS tax registration",
            table["industries"][industry]["sector_licences"][0],
        ],
        "compliance_bodies": ["CIPC", "SARS", "COIDA / Compensation Fund"],
        "confidence": "high",
    }


def good_legis(industry: str = "Construction") -> Dict[str, Any]:
    table = load_industries()
    size = table["industries"][industry]["roadmap_size"]
    names = list(table["industries"][industry]["sector_licences"])
    categories: List[Dict[str, Any]] = []
    remaining = size
    weights = [0.2, 0.2, 0.25, 0.1, 0.1, 0.1, 0.05]
    for index, (category, weight) in enumerate(zip(table["categories"], weights)):
        if index == len(table["categories"]) - 1:
            count = remaining
        else:
            count = int(round(size * weight))
        count = max(count, 0)
        remaining -= count
        examples = names[:2] if index == 4 else []
        categories.append({"category": category, "document_count": count,
                           "examples": examples})
    return {
        "industry": industry,
        "roadmap_size": size,
        "document_categories": categories,
        "critical_path": ["CIPC CoR14.1", "MOI", "SARS tax registration",
                          "COIDA registration", "Letter of Good Standing (LOGS)"],
        "first_document": "CIPC CoR14.1",
        "notes": None,
    }
