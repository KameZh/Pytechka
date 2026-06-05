from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src" / "backend"))

from src.backend.api.geometry import calculate_stats, infer_difficulty_from_stats, normalize_trail_marks
from src.backend.api.analysis import analyze_route_locally


class GeometryTests(unittest.TestCase):
    def test_calculate_stats_reads_distance_and_elevation(self) -> None:
        geojson = {
            "type": "LineString",
            "coordinates": [[23.0, 42.0, 100], [23.01, 42.0, 150], [23.02, 42.0, 130]],
        }
        stats = calculate_stats(geojson)
        self.assertGreater(stats["distance"], 1000)
        self.assertEqual(stats["elevationGain"], 50)
        self.assertEqual(stats["elevationLoss"], 20)
        self.assertEqual(stats["highestPoint"], 150)
        self.assertGreaterEqual(len(stats["elevationProfile"]), 2)

    def test_difficulty_uses_distance_gain_and_grade(self) -> None:
        self.assertEqual(infer_difficulty_from_stats({"distance": 1200, "elevationGain": 20}), "easy")
        self.assertIn(infer_difficulty_from_stats({"distance": 20000, "elevationGain": 900}), {"hard", "extreme"})

    def test_trail_marks_are_clamped_and_sorted(self) -> None:
        geojson = {"type": "LineString", "coordinates": [[0, 0], [1, 1], [2, 2]]}
        marks = normalize_trail_marks([
            {"colourType": "blue", "startIndex": 5, "endIndex": 1},
            {"colourType": "invalid", "startIndex": 0, "endIndex": 1},
        ], geojson)
        self.assertEqual(len(marks), 1)
        self.assertEqual(marks[0]["colourType"], "blue")
        self.assertEqual(marks[0]["startIndex"], 1)
        self.assertEqual(marks[0]["endIndex"], 2)


class AnalysisTests(unittest.TestCase):
    def test_local_analysis_returns_summary_and_segments(self) -> None:
        route = {
            "difficulty": "easy",
            "geojson": {
                "type": "LineString",
                "coordinates": [[23.0, 42.0, 100], [23.01, 42.0, 140], [23.02, 42.0, 160], [23.03, 42.0, 130]],
            },
            "trailMarks": [{"colourType": "red", "startIndex": 0, "endIndex": 3}],
        }
        result = analyze_route_locally(route)
        self.assertIn("summary", result)
        self.assertGreaterEqual(len(result["segments"]), 1)
        self.assertIn("qualityScore", result)


if __name__ == "__main__":
    unittest.main()
