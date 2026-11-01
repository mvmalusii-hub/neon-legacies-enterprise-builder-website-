"""Zero-dependency validation for the Onboard and Legis outputs.

Why hand-written instead of `jsonschema`: the GitHub runner installs whatever
requirements.txt asks for, but the machine that develops this code has no PyPI
access, and the two schemas are small and fixed. A dependency-free checker means
the tests run anywhere, including offline.

It enforces three things the model cannot be trusted with:

1. shape      – types, required keys, no extra keys, enums, array lengths
2. tables     – the industry exists and roadmap_size equals the published number
3. arithmetic – the Legis category counts add up to roadmap_size

Every function returns a list of human-readable errors; [] means valid.
"""
from __future__ import annotations

import json
import os
from typing import Any, Dict, List

HERE = os.path.dirname(os.path.abspath(__file__))
INDUSTRY_FILE = os.path.join(HERE, "agents", "neon_industries.json")
UNCLASSIFIED = "Unclassified"


def load_industries(path: str = INDUSTRY_FILE) -> Dict[str, Any]:
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


# --------------------------------------------------------------------------
# generic helpers
# --------------------------------------------------------------------------
def _missing(data: Dict[str, Any], required: List[str]) -> List[str]:
    return [f"missing key: {key}" for key in required if key not in data]


def _extra(data: Dict[str, Any], allowed: List[str]) -> List[str]:
    return [f"unexpected key: {key}" for key in data if key not in allowed]


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _str_list(value: Any, field: str, errors: List[str]) -> None:
    if not isinstance(value, list):
        errors.append(f"{field} must be an array")
        return
    for index, item in enumerate(value):
        if not isinstance(item, str) or not item.strip():
            errors.append(f"{field}[{index}] must be a non-empty string")


# --------------------------------------------------------------------------
# Onboard
# --------------------------------------------------------------------------
ONBOARD_KEYS = ["industry", "roadmap_size", "first_three_documents",
                "compliance_bodies", "confidence"]
CONFIDENCE = {"high", "medium", "low"}


def validate_onboard(data: Any, table: Dict[str, Any] | None = None) -> List[str]:
    table = table or load_industries()
    industries = table["industries"]
    bodies = set(table["compliance_bodies"])

    if not isinstance(data, dict):
        return ["output must be a JSON object"]

    errors: List[str] = []
    errors += _missing(data, ONBOARD_KEYS)
    errors += _extra(data, ONBOARD_KEYS)
    if errors:
        return errors

    industry = data["industry"]
    if not isinstance(industry, str) or not industry.strip():
        errors.append("industry must be a non-empty string")
    elif industry != UNCLASSIFIED and industry not in industries:
        errors.append(
            "industry must be one of the 26 listed industries or "
            f"'{UNCLASSIFIED}', got: {industry}")

    if not _is_int(data["roadmap_size"]):
        errors.append("roadmap_size must be an integer")
    elif industry == UNCLASSIFIED:
        if data["roadmap_size"] != 0:
            errors.append("roadmap_size must be 0 when industry is Unclassified")
    elif industry in industries:
        expected = industries[industry]["roadmap_size"]
        if data["roadmap_size"] != expected:
            errors.append(
                f"roadmap_size for {industry} must be {expected}, "
                f"got {data['roadmap_size']}")

    docs = data["first_three_documents"]
    _str_list(docs, "first_three_documents", errors)
    if isinstance(docs, list) and len(docs) != 3:
        errors.append(f"first_three_documents must hold exactly 3 items, got {len(docs)}")
    elif isinstance(docs, list) and len({d.strip().lower() for d in docs}) != len(docs):
        errors.append("first_three_documents must not repeat a document")

    _str_list(data["compliance_bodies"], "compliance_bodies", errors)
    if isinstance(data["compliance_bodies"], list):
        unknown = [b for b in data["compliance_bodies"] if b not in bodies]
        if unknown:
            errors.append(f"compliance_bodies not in the table: {', '.join(unknown)}")

    if data["confidence"] not in CONFIDENCE:
        errors.append(
            f"confidence must be one of {sorted(CONFIDENCE)}, got: {data['confidence']}")

    return errors


# --------------------------------------------------------------------------
# Legis
# --------------------------------------------------------------------------
LEGIS_KEYS = ["industry", "roadmap_size", "document_categories",
              "critical_path", "first_document", "notes"]
CATEGORY_KEYS = ["category", "document_count", "examples"]


def validate_legis(data: Any, table: Dict[str, Any] | None = None) -> List[str]:
    table = table or load_industries()
    industries = table["industries"]
    categories = set(table["categories"])

    if not isinstance(data, dict):
        return ["output must be a JSON object"]

    errors: List[str] = []
    errors += _missing(data, LEGIS_KEYS)
    errors += _extra(data, LEGIS_KEYS)
    if errors:
        return errors

    industry = data["industry"]
    known = isinstance(industry, str) and industry in industries
    if not isinstance(industry, str) or not industry.strip():
        errors.append("industry must be a non-empty string")

    if not _is_int(data["roadmap_size"]):
        errors.append("roadmap_size must be an integer")
    elif known and data["roadmap_size"] != industries[industry]["roadmap_size"]:
        errors.append(
            f"roadmap_size for {industry} must be "
            f"{industries[industry]['roadmap_size']}, got {data['roadmap_size']}")

    rows = data["document_categories"]
    total = 0
    if not isinstance(rows, list):
        errors.append("document_categories must be an array")
    else:
        seen = set()
        for index, row in enumerate(rows):
            label = f"document_categories[{index}]"
            if not isinstance(row, dict):
                errors.append(f"{label} must be an object")
                continue
            errors += [f"{label} {e}" for e in _missing(row, CATEGORY_KEYS)]
            errors += [f"{label} {e}" for e in _extra(row, CATEGORY_KEYS)]
            if row.get("category") in seen:
                errors.append(f"{label} repeats category {row.get('category')}")
            seen.add(row.get("category"))
            if row.get("category") not in categories:
                errors.append(f"{label} unknown category: {row.get('category')}")
            if not _is_int(row.get("document_count")):
                errors.append(f"{label} document_count must be an integer")
            elif row["document_count"] < 0:
                errors.append(f"{label} document_count must not be negative")
            else:
                total += row["document_count"]
            _str_list(row.get("examples"), f"{label} examples", errors)

        if _is_int(data["roadmap_size"]) and total != data["roadmap_size"]:
            errors.append(
                f"document_count values sum to {total}, but roadmap_size is "
                f"{data['roadmap_size']}")

    path = data["critical_path"]
    _str_list(path, "critical_path", errors)
    if isinstance(path, list) and len(path) != 5:
        errors.append(f"critical_path must hold exactly 5 documents, got {len(path)}")

    if not isinstance(data["first_document"], str) or not data["first_document"].strip():
        errors.append("first_document must be a non-empty string")

    if data["notes"] is not None and not isinstance(data["notes"], str):
        errors.append("notes must be a string or null")

    if not known and data["notes"] is None:
        errors.append("an unknown industry must explain itself in notes")

    return errors


VALIDATORS = {"onboard": validate_onboard, "legis": validate_legis}


def validate(agent: str, data: Any, table: Dict[str, Any] | None = None) -> List[str]:
    if agent not in VALIDATORS:
        raise ValueError(f"unknown agent: {agent} (expected onboard|legis)")
    return VALIDATORS[agent](data, table)
