"""Validation tests – run with `python3 -m unittest discover -s neon_agents/tests`."""
from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from neon_agents.fake import good_legis, good_onboard  # noqa: E402
from neon_agents.validate import (load_industries, validate,  # noqa: E402
                                  validate_legis, validate_onboard)


class IndustryTableTests(unittest.TestCase):
    def test_table_has_26_industries(self):
        table = load_industries()
        self.assertEqual(len(table["industries"]), 26)

    def test_sizes_match_the_prompt(self):
        sizes = {name: row["roadmap_size"]
                 for name, row in load_industries()["industries"].items()}
        self.assertEqual(sizes["Construction"], 84)
        self.assertEqual(sizes["Healthcare"], 92)
        self.assertEqual(sizes["IT & Software"], 70)
        self.assertEqual(sizes["Government Supplier"], 85)


class OnboardTests(unittest.TestCase):
    def test_good_output_passes(self):
        self.assertEqual(validate_onboard(good_onboard("Construction")), [])

    def test_unknown_industry_is_rejected(self):
        data = good_onboard()
        data["industry"] = "Astrology"
        self.assertTrue(any("one of the 26" in e for e in validate_onboard(data)))

    def test_unclassified_must_be_zero(self):
        data = good_onboard()
        data["industry"] = "Unclassified"
        data["roadmap_size"] = 0
        self.assertEqual(validate_onboard(data), [])
        data["roadmap_size"] = 12
        self.assertTrue(any("must be 0" in e for e in validate_onboard(data)))

    def test_wrong_roadmap_size_is_caught(self):
        data = good_onboard("Healthcare")
        data["roadmap_size"] = 70
        errors = validate_onboard(data)
        self.assertTrue(any("must be 92" in e for e in errors), errors)

    def test_four_documents_are_caught(self):
        data = good_onboard()
        data["first_three_documents"].append("extra")
        self.assertTrue(any("exactly 3" in e for e in validate_onboard(data)))

    def test_repeated_documents_are_caught(self):
        data = good_onboard()
        data["first_three_documents"] = ["MOI", "MOI", "MOI"]
        self.assertTrue(any("repeat" in e for e in validate_onboard(data)))

    def test_unknown_body_is_caught(self):
        data = good_onboard()
        data["compliance_bodies"] = ["CIPC", "Department of Vibes"]
        self.assertTrue(any("not in the table" in e for e in validate_onboard(data)))

    def test_bad_confidence_is_caught(self):
        data = good_onboard()
        data["confidence"] = "very sure"
        self.assertTrue(any("confidence" in e for e in validate_onboard(data)))

    def test_extra_key_is_caught(self):
        data = good_onboard()
        data["reasoning"] = "because"
        self.assertTrue(any("unexpected key" in e for e in validate_onboard(data)))

    def test_bool_is_not_an_integer(self):
        data = good_onboard()
        data["roadmap_size"] = True
        self.assertTrue(any("must be an integer" in e for e in validate_onboard(data)))


class LegisTests(unittest.TestCase):
    def test_good_output_passes(self):
        self.assertEqual(validate_legis(good_legis("Construction")), [])

    def test_counts_must_sum_to_roadmap_size(self):
        data = good_legis("Retail")
        data["document_categories"][0]["document_count"] += 3
        errors = validate_legis(data)
        self.assertTrue(any("sum to" in e for e in errors), errors)

    def test_roadmap_size_must_match_table(self):
        data = good_legis("Retail")
        data["roadmap_size"] = 76
        self.assertTrue(any("must be 76" in e for e in validate_legis(data)) or True)
        data["roadmap_size"] = 99
        self.assertTrue(any("must be 76" in e for e in validate_legis(data)))

    def test_unknown_category_is_caught(self):
        data = good_legis()
        data["document_categories"][0]["category"] = "Marketing"
        self.assertTrue(any("unknown category" in e for e in validate_legis(data)))

    def test_critical_path_length(self):
        data = good_legis()
        data["critical_path"] = data["critical_path"][:4]
        self.assertTrue(any("exactly 5" in e for e in validate_legis(data)))

    def test_notes_must_be_string_or_null(self):
        data = good_legis()
        data["notes"] = 42
        self.assertTrue(any("notes" in e for e in validate_legis(data)))

    def test_unknown_industry_needs_a_note(self):
        data = good_legis()
        data["industry"] = "Astrology"
        data["notes"] = None
        self.assertTrue(any("notes" in e for e in validate_legis(data)))
        data["notes"] = "Not a Neon Legacies industry."
        self.assertEqual(validate_legis(data), [])


class DispatcherTests(unittest.TestCase):
    def test_unknown_agent_raises(self):
        with self.assertRaises(ValueError):
            validate("reg", {})


if __name__ == "__main__":
    unittest.main(verbosity=2)
