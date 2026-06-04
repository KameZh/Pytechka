from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src" / "backend"))

from src.backend.api.validators import (
    validate_condition_payload,
    validate_coordinates,
    validate_create_trail_payload,
    validate_photo_ping_payload,
    validate_ping_payload,
    validate_review_payload,
    validate_update_trail_payload,
)


class ValidatorTests(unittest.TestCase):
    def test_coordinates_reject_invalid_bounds(self) -> None:
        result = validate_coordinates([200, 42])
        self.assertFalse(result.ok)
        self.assertIn("outside", result.error or "")

    def test_create_trail_requires_name_and_geojson(self) -> None:
        result = validate_create_trail_payload({})
        self.assertFalse(result.ok)
        self.assertIn("name is required", result.errors)
        self.assertIn("geojson is required", result.errors)

    def test_create_trail_accepts_valid_payload(self) -> None:
        result = validate_create_trail_payload({
            "name": "Demo trail",
            "difficulty": "easy",
            "geojson": {"type": "LineString", "coordinates": [[23, 42], [23.1, 42.1]]},
        })
        self.assertTrue(result.ok)
        self.assertEqual(result.data["name"], "Demo trail")

    def test_update_trail_rejects_bad_difficulty(self) -> None:
        result = validate_update_trail_payload({"difficulty": "impossible"})
        self.assertFalse(result.ok)

    def test_ping_payload_sanitizes_description(self) -> None:
        result = validate_ping_payload({"type": "junk", "coordinates": [23, 42], "description": "x" * 300})
        self.assertTrue(result.ok)
        self.assertEqual(len(result.data["description"]), 200)

    def test_photo_payload_defaults_unknown_category(self) -> None:
        result = validate_photo_ping_payload({"photoUrl": "data:image/png;base64,abc", "coordinates": [23, 42], "photoCategory": "other"})
        self.assertTrue(result.ok)
        self.assertEqual(result.data["photoCategory"], "memory")

    def test_condition_payload_filters_hazards(self) -> None:
        result = validate_condition_payload({"surface": "snow", "waterSources": "dry", "hazards": ["trash", "aliens"]})
        self.assertTrue(result.ok)
        self.assertEqual(result.data["surface"], "snow")
        self.assertEqual(result.data["hazards"], ["trash"])

    def test_review_payload_checks_rating_range(self) -> None:
        self.assertFalse(validate_review_payload({"accuracy": 9}).ok)
        self.assertTrue(validate_review_payload({"accuracy": 4, "comment": "Good"}).ok)


if __name__ == "__main__":
    unittest.main()
