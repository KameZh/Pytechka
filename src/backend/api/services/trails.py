from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from ..geometry import derive_trail_start_end_center, haversine_meters, normalize_string

TRAIL_SEARCH_FIELDS = ["name", "name_bg", "name_en", "ref", "region", "description"]


def build_search_filter(search: str | None) -> list[dict[str, Any]] | None:
    if not search:
        return None
    safe = re.escape(search)
    return [{field: {"$regex": safe, "$options": "i"}} for field in TRAIL_SEARCH_FIELDS]


def build_trail_filters(query_params: Any) -> tuple[dict[str, Any], dict[str, Any]]:
    
    user_filter: dict[str, Any] = {}
    official_filter: dict[str, Any] = {}
    difficulty = query_params.get("difficulty")
    if difficulty and difficulty != "all":
        user_filter["difficulty"] = difficulty
        official_filter["difficulty"] = difficulty
    if str(query_params.get("unmarkedOnly") or "").lower() == "true":
        user_filter["colour_type"] = "unmarked"
        official_filter["colour_type"] = "unmarked"
    search_filter = build_search_filter(normalize_string(query_params.get("search")))
    if search_filter:
        user_filter["$or"] = search_filter
        official_filter["$or"] = search_filter
    return user_filter, official_filter


def compact_projection(compact: bool) -> dict[str, int]:
    projection = {"reviews": 0}
    if compact:
        projection.update({"geojson": 0, "geom": 0, "mapGeometry": 0})
    return projection


def normalize_trail_document(trail: dict[str, Any]) -> dict[str, Any]:
    result = dict(trail or {})
    derived = derive_trail_start_end_center(result.get("geojson"))
    if not isinstance(result.get("startCoordinates"), list) or len(result.get("startCoordinates") or []) != 2:
        result["startCoordinates"] = derived["startCoordinates"]
    if not isinstance(result.get("endCoordinates"), list) or len(result.get("endCoordinates") or []) != 2:
        result["endCoordinates"] = derived["endCoordinates"]
    result["stats"] = result.get("stats") or {}
    if not isinstance(result["stats"].get("centerCoordinates"), list):
        result["stats"]["centerCoordinates"] = derived["centerCoordinates"]
    result["source"] = normalize_string(result.get("source")) or "user"
    result["averageAccuracy"] = float(result.get("averageAccuracy") or 0)
    return result


def sort_trails(trails: list[dict[str, Any]], sort: str | None) -> list[dict[str, Any]]:
    if sort == "popular":
        return sorted(trails, key=lambda trail: float(trail.get("averageAccuracy") or 0), reverse=True)
    return sorted(trails, key=lambda trail: trail.get("createdAt") or datetime.min.replace(tzinfo=timezone.utc), reverse=True)


def filter_by_radius(trails: list[dict[str, Any]], center: list[float], radius_km: float, mode: str = "start") -> list[dict[str, Any]]:
    radius_m = min(max(float(radius_km), 0.1), 100) * 1000
    filtered: list[dict[str, Any]] = []
    for trail in trails:
        anchor = (trail.get("stats") or {}).get("centerCoordinates") if mode == "center" else trail.get("startCoordinates")
        if isinstance(anchor, list) and len(anchor) == 2 and haversine_meters(center, anchor) <= radius_m:
            filtered.append(trail)
    return filtered


def recalculate_average_accuracy(reviews: list[dict[str, Any]]) -> float:
    values = [float(review.get("accuracy") or 0) for review in reviews if review.get("accuracy")]
    return round(sum(values) / len(values), 1) if values else 0.0
