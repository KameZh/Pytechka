from __future__ import annotations

from typing import Any

from ..analysis import analyze_route_locally
from ..geometry import calculate_enriched_stats, derive_trail_point_labels, derive_trail_start_end_center, infer_difficulty_from_stats, normalize_trail_marks, simplify_map_geometry


def build_telemetry_update(geojson: dict[str, Any], submitted_stats: dict[str, Any] | None = None) -> dict[str, Any]:

    stats = calculate_enriched_stats(geojson, submitted_stats or {})
    derived = derive_trail_start_end_center(geojson)
    labels = derive_trail_point_labels(geojson)
    return {
        "stats": stats,
        "startPoint": labels.get("startPoint", ""),
        "endPoint": labels.get("endPoint", ""),
        "highestPoint": labels.get("highestPoint") or (f"{round(float(stats['highestPoint']))} m" if stats.get("highestPoint") is not None else ""),
        "startCoordinates": stats.get("startCoordinates") or derived.get("startCoordinates"),
        "endCoordinates": stats.get("endCoordinates") or derived.get("endCoordinates"),
        "mapGeometry": simplify_map_geometry(geojson),
        "difficulty": infer_difficulty_from_stats(stats),
    }


def build_analysis_update(trail: dict[str, Any]) -> dict[str, Any]:
    analysis = analyze_route_locally(trail)
    return {"ai": {"status": "done", **analysis}}


def build_full_trail_enrichment(trail: dict[str, Any]) -> dict[str, Any]:
    geojson = trail.get("geojson")
    if not isinstance(geojson, dict):
        return {}
    telemetry = build_telemetry_update(geojson, trail.get("stats") if isinstance(trail.get("stats"), dict) else {})
    enriched = {**trail, **telemetry}
    enriched["trailMarks"] = normalize_trail_marks(trail.get("trailMarks"), geojson)
    enriched.update(build_analysis_update(enriched))
    return enriched


def has_usable_telemetry(trail: dict[str, Any]) -> bool:
    stats = trail.get("stats") if isinstance(trail.get("stats"), dict) else {}
    return bool(stats.get("distance") and trail.get("startCoordinates") and trail.get("endCoordinates") and trail.get("mapGeometry"))
