from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND_SRC = ROOT / "src" / "backend"
if str(BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(BACKEND_SRC))

from src.backend.api.services.badges import increment_badge_progress, normalize_badge_progress, pick_tier
from src.backend.api.services.offline import OfflineArea, estimate_tile_count, normalize_resource_types
from src.backend.api.services.pings import add_unique_vote, cluster_center, cluster_description, cluster_level_for_count, nearby_pings, ping_expiration, required_cluster_votes
from src.backend.api.services.telemetry import build_full_trail_enrichment, has_usable_telemetry
from src.backend.api.services.trails import build_search_filter, filter_by_radius, recalculate_average_accuracy, sort_trails


class BadgeServiceTests(unittest.TestCase):
    def test_pick_tier_returns_highest_unlocked_badge(self) -> None:
        self.assertEqual(pick_tier("trailers", 12), "Junior")
        self.assertEqual(pick_tier("contribution", 22), "Country guide")
        self.assertIsNone(pick_tier("campaign", 0))

    def test_increment_badge_progress_updates_awards(self) -> None:
        progress = increment_badge_progress({"createdTrails": 2}, {"createdTrails": 1})
        self.assertEqual(progress["createdTrails"], 3)
        self.assertEqual(progress["awarded"]["contribution"], "New guide")

    def test_normalize_badge_progress_fills_missing_values(self) -> None:
        progress = normalize_badge_progress(None)
        self.assertEqual(progress["trailCompletions"], 0)
        self.assertEqual(progress["createdTrails"], 0)
        self.assertIn("awarded", progress)


class OfflineServiceTests(unittest.TestCase):
    def test_normalize_resource_types_filters_unknown_values(self) -> None:
        self.assertEqual(normalize_resource_types(["trails", "bad", "huts"]), ["huts", "trails"])

    def test_estimate_tile_count_returns_positive_number(self) -> None:
        area = OfflineArea(mode="bbox", bbox=[23.1, 42.4, 23.5, 42.8])
        self.assertGreater(estimate_tile_count(area, 10, 12), 0)


class PingServiceTests(unittest.TestCase):
    def test_ping_expiration_for_temporary_types(self) -> None:
        self.assertIsNotNone(ping_expiration("mud"))
        self.assertIsNone(ping_expiration("junk"))

    def test_cluster_helpers_and_unique_votes(self) -> None:
        self.assertEqual(cluster_level_for_count(5), "event")
        self.assertEqual(required_cluster_votes("event"), 5)
        self.assertIn("5 reports", cluster_description("event", 5))
        votes, added = add_unique_vote(["a"], "b")
        self.assertTrue(added)
        self.assertEqual(votes, ["a", "b"])
        votes, added = add_unique_vote(votes, "b")
        self.assertFalse(added)

    def test_nearby_pings_and_center(self) -> None:
        pings = [
            {"coordinates": [23.0, 42.0]},
            {"coordinates": [23.001, 42.0]},
            {"coordinates": [24.0, 43.0]},
        ]
        close = nearby_pings([23.0, 42.0], pings, 300)
        self.assertEqual(len(close), 2)
        center = cluster_center(close)
        self.assertAlmostEqual(center[0], 23.0005, places=4)


class TrailServiceTests(unittest.TestCase):
    def test_search_filter_targets_expected_fields(self) -> None:
        search_filter = build_search_filter("Rila")
        self.assertIsNotNone(search_filter)
        self.assertGreaterEqual(len(search_filter or []), 5)

    def test_sort_and_rating_helpers(self) -> None:
        trails = [{"name": "a", "averageAccuracy": 1}, {"name": "b", "averageAccuracy": 5}]
        self.assertEqual(sort_trails(trails, "popular")[0]["name"], "b")
        self.assertEqual(recalculate_average_accuracy([{"accuracy": 5}, {"accuracy": 3}]), 4.0)

    def test_radius_filter_uses_start_point(self) -> None:
        trails = [{"startCoordinates": [23.0, 42.0]}, {"startCoordinates": [24.0, 43.0]}]
        self.assertEqual(len(filter_by_radius(trails, [23.0, 42.0], 1)), 1)


class TelemetryServiceTests(unittest.TestCase):
    def test_full_trail_enrichment_adds_map_fields(self) -> None:
        trail = {
            "geojson": {
                "type": "LineString",
                "coordinates": [[23, 42, 500], [23.01, 42, 550], [23.02, 42, 520]],
            },
            "trailMarks": [{"colourType": "red", "startIndex": 0, "endIndex": 2}],
        }
        enriched = build_full_trail_enrichment(trail)
        self.assertIn("stats", enriched)
        self.assertIn("mapGeometry", enriched)
        self.assertIn("ai", enriched)
        self.assertTrue(has_usable_telemetry(enriched))


if __name__ == "__main__":
    unittest.main()
