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
from src.backend.api.services.pings import add_unique_vote, cluster_description, cluster_level_for_count, ping_expiration, required_cluster_votes


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


if __name__ == "__main__":
    unittest.main()

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


