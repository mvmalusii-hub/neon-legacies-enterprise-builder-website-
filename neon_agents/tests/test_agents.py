"""Provider + CLI tests. No network, no API key, no openai SDK required."""
from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)

from neon_agents import cli  # noqa: E402
from neon_agents.fake import (FakeClient, FakeContentClient, good_legis,  # noqa: E402
                              good_onboard)
from neon_agents.provider import AGENT_LIMITS, PROVIDERS, call_agent  # noqa: E402
from neon_agents.review import classify, summarise  # noqa: E402

SAMPLES = os.path.join(ROOT, "neon_agents", "tests", "samples", "onboard_samples.json")


class ProviderTests(unittest.TestCase):
    def test_good_output_is_accepted_first_try(self):
        result = call_agent("onboard", "construction company", provider="deepseek",
                            client_factory=lambda: FakeClient([good_onboard()]))
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["attempts"], 1)

    def test_schema_violation_is_corrected_in_one_round_trip(self):
        bad = good_onboard()
        bad["confidence"] = "pretty sure"
        result = call_agent("onboard", "construction", provider="deepseek",
                            client_factory=lambda: FakeClient([bad, good_onboard()]))
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["attempts"], 2)

    def test_violation_survives_all_retries_then_fails(self):
        bad = good_onboard()
        bad["roadmap_size"] = 1
        result = call_agent("onboard", "construction", provider="deepseek",
                            max_retries=2,
                            client_factory=lambda: FakeClient([bad, bad]))
        self.assertFalse(result["ok"])
        self.assertIn("roadmap_size", result["error"])
        self.assertEqual(result["validation"], result["validation"])  # list present

    def test_provider_exception_is_retried(self):
        result = call_agent("onboard", "construction", provider="deepseek",
                            client_factory=lambda: FakeClient(
                                [RuntimeError("429 rate limited"), good_onboard()]))
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["attempts"], 2)

    def test_fenced_json_in_content_is_parsed(self):
        fenced = "```json\n" + json.dumps(good_onboard()) + "\n```"
        result = call_agent("onboard", "construction", provider="deepseek",
                            client_factory=lambda: FakeContentClient([fenced]))
        self.assertTrue(result["ok"], result)

    def test_prose_instead_of_json_is_rejected(self):
        result = call_agent("onboard", "construction", provider="deepseek",
                            max_retries=1,
                            client_factory=lambda: FakeContentClient(
                                ["Sure! Here is the JSON you asked for."]))
        self.assertFalse(result["ok"])
        self.assertIn("unparseable", result["error"])

    def test_unknown_provider_is_refused(self):
        with self.assertRaises(ValueError):
            call_agent("onboard", "x", provider="gemini")

    def test_legis_gets_more_tokens_than_onboard(self):
        self.assertLess(AGENT_LIMITS["onboard"], AGENT_LIMITS["legis"])
        self.assertGreaterEqual(AGENT_LIMITS["legis"], 1000)

    def test_both_providers_are_openai_compatible(self):
        for name in ("deepseek", "qwen"):
            self.assertIn(name, PROVIDERS)
            self.assertTrue(PROVIDERS[name]["base_url"].startswith("https://"))


class CliTests(unittest.TestCase):
    def test_offline_onboard_batch(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "results.json")
            code = cli.main(["onboard", "--input", SAMPLES, "--out", out, "--offline"])
            self.assertEqual(code, 0)
            payload = json.load(open(out, encoding="utf-8"))
            self.assertEqual(len(payload), 10)
            for row in payload:
                self.assertTrue(row["output"]["ok"], row)
                self.assertEqual(row["output"]["data"]["roadmap_size"],
                                 good_onboard()["roadmap_size"])

    def test_offline_legis(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "legis.json")
            code = cli.main(["legis", "--industry", "Construction", "--out", out,
                             "--offline"])
            self.assertEqual(code, 0)
            payload = json.load(open(out, encoding="utf-8"))
            self.assertTrue(payload["ok"])
            self.assertEqual(payload["data"]["roadmap_size"], 84)

    def test_validate_command_accepts_a_good_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "onboard.json")
            json.dump(good_onboard(), open(path, "w", encoding="utf-8"))
            self.assertEqual(cli.main(["validate", "--agent", "onboard",
                                       "--file", path]), 0)

    def test_validate_command_rejects_a_bad_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "onboard.json")
            bad = good_onboard()
            bad["roadmap_size"] = 1
            json.dump(bad, open(path, "w", encoding="utf-8"))
            self.assertEqual(cli.main(["validate", "--agent", "onboard",
                                       "--file", path]), 1)

    def test_selftest_passes_offline(self):
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            code = cli.main(["selftest"])
        self.assertEqual(code, 0, buffer.getvalue())
        self.assertIn("self-checks passed", buffer.getvalue())


class ReviewQueueTests(unittest.TestCase):
    def _row(self, **overrides):
        data = good_onboard()
        data.update(overrides)
        return {"input": {"description": "x"}, "output": {"ok": True, "data": data}}

    def test_high_confidence_row_is_auto_accepted(self):
        auto, review = classify([self._row()])
        self.assertEqual(len(auto), 1)
        self.assertEqual(review, [])

    def test_low_confidence_row_goes_to_review(self):
        auto, review = classify([self._row(confidence="low")])
        self.assertEqual(auto, [])
        self.assertEqual(len(review), 1)
        self.assertIn("confidence is low", review[0]["review_reasons"][0])

    def test_unclassified_goes_to_review(self):
        auto, review = classify([self._row(industry="Unclassified", roadmap_size=0)])
        self.assertEqual(auto, [])
        self.assertIn("no industry matched", review[0]["review_reasons"][0])

    def test_failed_call_goes_to_review(self):
        row = {"input": {}, "output": {"ok": False, "error": "boom"}}
        auto, review = classify([row])
        self.assertEqual(auto, [])
        self.assertIn("did not produce valid output", review[0]["review_reasons"][0])

    def test_summary_counts_industries(self):
        rows = [self._row(), self._row(confidence="low")]
        summary = summarise(rows)
        self.assertEqual(summary["total"], 2)
        self.assertEqual(summary["auto"], 1)
        self.assertEqual(summary["review"], 1)
        self.assertEqual(summary["by_industry"]["Construction"], 2)

    def test_offline_batch_writes_a_review_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "results.json")
            review_path = os.path.join(tmp, "review.json")
            code = cli.main(["onboard", "--input", SAMPLES, "--out", out,
                             "--review-out", review_path, "--offline"])
            self.assertEqual(code, 0)
            self.assertEqual(json.load(open(review_path, encoding="utf-8")), [])


ONBOARD_WORKFLOW = os.path.join(ROOT, "neon_agents", "workflows", "onboard.yml")


class WorkflowActivationTests(unittest.TestCase):
    """The Onboard workflow is activated by a push as well as by hand.

    A `workflow_dispatch` supplies inputs; a `push` to the prompt/schema does
    not, so every value the run step depends on needs a fallback. Without them
    the step built `--input  --provider ` and argparse aborted the job with
    "argument --input: expected one argument" before Onboard ever ran.
    """

    def setUp(self):
        with open(ONBOARD_WORKFLOW, encoding="utf-8") as handle:
            self.text = handle.read()

    def test_push_trigger_is_present(self):
        self.assertIn("  push:", self.text)

    def test_push_run_has_input_fallbacks(self):
        for needle in (
            "github.event.inputs.provider || 'deepseek'",
            "github.event.inputs.input_file || "
            "'neon_agents/tests/samples/onboard_samples.json'",
            "github.event.inputs.offline || 'true'",
        ):
            self.assertIn(needle, self.text, f"{needle} missing")


if __name__ == "__main__":
    unittest.main(verbosity=2)
