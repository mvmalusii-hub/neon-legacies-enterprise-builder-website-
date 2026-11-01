"""Command line entry point – the only thing the workflows call.

    python -m neon_agents.cli onboard --input samples.json --out results.json
    python -m neon_agents.cli legis --industry Construction --context "..." --out r.json
    python -m neon_agents.cli validate --agent onboard --file some.json
    python -m neon_agents.cli selftest          # offline end-to-end, no API key

Exit codes: 0 everything valid, 1 something failed validation or the provider.
Arguments arrive as flags/environment only – nothing is interpolated into code,
so a workflow input can never become executable Python.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from typing import Any, Dict, List

from . import logging_config
from .fake import FakeClient, good_legis, good_onboard
from .provider import call_agent
from .validate import validate

log = logging.getLogger("neon_agents.cli")


def _read_json(path: str) -> Any:
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def _write_json(path: str, payload: Any) -> None:
    directory = os.path.dirname(os.path.abspath(path))
    if directory:
        os.makedirs(directory, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def _client_for(args: argparse.Namespace, agent: str) -> Any:
    """--offline returns a fake client; otherwise provider.py builds the SDK."""
    if getattr(args, "offline", False):
        sample = good_onboard() if agent == "onboard" else good_legis(
            getattr(args, "industry", None) or "Construction")
        return lambda: FakeClient([sample])
    return None


def cmd_onboard(args: argparse.Namespace) -> int:
    samples = _read_json(args.input)
    if isinstance(samples, dict):
        samples = samples.get("samples", [])
    results: List[Dict[str, Any]] = []
    failures = 0

    for index, sample in enumerate(samples):
        description = sample.get("description") if isinstance(sample, dict) else str(sample)
        if not description:
            results.append({"input": sample,
                            "output": {"ok": False, "error": "no description"}})
            failures += 1
            continue
        result = call_agent("onboard", description, provider=args.provider,
                            client_factory=_client_for(args, "onboard"))
        results.append({"input": sample, "output": result})
        if not result.get("ok"):
            failures += 1
        log.info(json.dumps({"event": "sample", "index": index,
                             "ok": result.get("ok")}))

    _write_json(args.out, results)
    print(f"processed {len(results)} samples, {failures} failed -> {args.out}")
    return 0 if failures == 0 else 1


def cmd_legis(args: argparse.Namespace) -> int:
    message = json.dumps({"industry": args.industry, "context": args.context or ""})
    result = call_agent("legis", message, provider=args.provider,
                        client_factory=_client_for(args, "legis"))
    _write_json(args.out, result)
    if result.get("ok"):
        size = result["data"]["roadmap_size"]
        print(f"{args.industry}: roadmap_size={size} -> {args.out}")
        return 0
    print(f"{args.industry}: FAILED {result.get('error')}", file=sys.stderr)
    return 1


def cmd_validate(args: argparse.Namespace) -> int:
    problems = validate(args.agent, _read_json(args.file))
    if problems:
        for problem in problems:
            print(f"- {problem}", file=sys.stderr)
        return 1
    print(f"{args.file}: valid {args.agent} output")
    return 0


def cmd_selftest(args: argparse.Namespace) -> int:
    """Exercise both agents offline – the CI smoke test that needs no secrets."""
    checks: List[tuple] = []

    onboard = call_agent("onboard", "I run a small construction company in Gauteng.",
                         provider="deepseek",
                         client_factory=lambda: FakeClient([good_onboard()]))
    checks.append(("onboard happy path", onboard.get("ok") is True))

    bad = good_onboard()
    bad["first_three_documents"] = bad["first_three_documents"] + ["extra"]
    corrected = call_agent("onboard", "I run a construction company.",
                           provider="deepseek",
                           client_factory=lambda: FakeClient([bad, good_onboard()]))
    checks.append(("onboard repairs a 4-item list", corrected.get("ok") is True
                   and corrected.get("attempts") == 2))

    wrong_size = good_onboard()
    wrong_size["roadmap_size"] = 3
    doomed = call_agent("onboard", "construction", provider="deepseek",
                        max_retries=2,
                        client_factory=lambda: FakeClient([wrong_size, wrong_size]))
    checks.append(("onboard rejects a wrong roadmap_size",
                   doomed.get("ok") is False
                   and "roadmap_size" in (doomed.get("error") or "")))

    legis = call_agent("legis", json.dumps({"industry": "Construction", "context": ""}),
                       provider="deepseek",
                       client_factory=lambda: FakeClient([good_legis()]))
    checks.append(("legis happy path", legis.get("ok") is True))

    broken = good_legis()
    broken["document_categories"][0]["document_count"] += 1
    rejected = call_agent("legis", json.dumps({"industry": "Construction"}),
                          provider="deepseek", max_retries=1,
                          client_factory=lambda: FakeClient([broken]))
    checks.append(("legis rejects category counts that do not sum",
                   rejected.get("ok") is False
                   and "sum to" in (rejected.get("error") or "")))

    failed = 0
    for label, passed in checks:
        print(("  ok   " if passed else "  FAIL ") + label)
        failed += 0 if passed else 1
    print(f"{len(checks) - failed}/{len(checks)} self-checks passed")
    return 0 if failed == 0 else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="neon_agents", description=__doc__)
    parser.add_argument("--log-level", default=os.getenv("LOG_LEVEL", "INFO"))
    sub = parser.add_subparsers(dest="command", required=True)

    onboard = sub.add_parser("onboard", help="classify a batch of client descriptions")
    onboard.add_argument("--input", required=True)
    onboard.add_argument("--out", default="results_onboard.json")
    onboard.add_argument("--provider", default=os.getenv("PROVIDER", "deepseek"))
    onboard.add_argument("--offline", action="store_true")
    onboard.set_defaults(func=cmd_onboard)

    legis = sub.add_parser("legis", help="generate one industry roadmap")
    legis.add_argument("--industry", required=True)
    legis.add_argument("--context", default="")
    legis.add_argument("--out", default="result_legis.json")
    legis.add_argument("--provider", default=os.getenv("PROVIDER", "deepseek"))
    legis.add_argument("--offline", action="store_true")
    legis.set_defaults(func=cmd_legis)

    check = sub.add_parser("validate", help="validate a saved output file")
    check.add_argument("--agent", required=True, choices=["onboard", "legis"])
    check.add_argument("--file", required=True)
    check.set_defaults(func=cmd_validate)

    selftest = sub.add_parser("selftest", help="offline end-to-end smoke test")
    selftest.set_defaults(func=cmd_selftest)
    return parser


def main(argv: List[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging_config.configure(args.log_level)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
