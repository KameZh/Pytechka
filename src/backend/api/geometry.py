from __future__ import annotations

import math
from typing import Any, Iterable

TRAIL_MARK_COLOURS = {"red", "blue", "green", "yellow", "white", "black", "unmarked"}
PHOTO_PING_CATEGORIES = {"viewpoint", "trail_condition", "marking", "water_source", "hazard", "memory"}
TRAIL_CONDITION_SURFACES = {"good", "muddy", "snow", "icy", "overgrown", "blocked", "mixed"}
TRAIL_CONDITION_WATER = {"unknown", "available", "dry", "limited"}
TRAIL_CONDITION_HAZARDS = {"fallen_trees", "landslide", "flooded", "missing_markers", "dangerous_animals", "trash"}


def normalize_string(value: Any) -> str:
    return str(value or "").strip()


def extract_coordinates(geojson: dict[str, Any] | None) -> list[list[float]]:
    """Flatten GeoJSON LineString/MultiLineString/Feature data into coordinates."""

    if not isinstance(geojson, dict):
        return []
    geo_type = geojson.get("type")
    if geo_type == "LineString":
        return [list(point) for point in geojson.get("coordinates", []) if isinstance(point, (list, tuple))]
    if geo_type == "MultiLineString":
        coords: list[list[float]] = []
        for line in geojson.get("coordinates", []) or []:
            if isinstance(line, list):
                coords.extend([list(point) for point in line if isinstance(point, (list, tuple))])
        return coords
    if geo_type == "Feature":
        return extract_coordinates(geojson.get("geometry"))
    if geo_type == "FeatureCollection":
        coords: list[list[float]] = []
        for feature in geojson.get("features", []) or []:
            coords.extend(extract_coordinates(feature.get("geometry") if isinstance(feature, dict) else None))
        return coords
    return []


def extract_line_geometries(geojson: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Return only line-like geometries from a GeoJSON object."""

    if not isinstance(geojson, dict):
        return []
    geo_type = geojson.get("type")
    if geo_type in {"LineString", "MultiLineString"}:
        return [geojson]
    if geo_type == "Feature":
        return extract_line_geometries(geojson.get("geometry"))
    if geo_type == "FeatureCollection":
        result: list[dict[str, Any]] = []
        for feature in geojson.get("features", []) or []:
            result.extend(extract_line_geometries(feature.get("geometry") if isinstance(feature, dict) else None))
        return result
    return []


def has_elevation(coord: list[float]) -> bool:
    return len(coord) >= 3 and math.isfinite(float(coord[2]))


def haversine_meters(first: Iterable[float], second: Iterable[float]) -> float:
    lon1, lat1 = list(first)[:2]
    lon2, lat2 = list(second)[:2]
    radius = 6371000.0
    d_lat = math.radians(float(lat2) - float(lat1))
    d_lon = math.radians(float(lon2) - float(lon1))
    a = math.sin(d_lat / 2) ** 2 + math.cos(math.radians(float(lat1))) * math.cos(math.radians(float(lat2))) * math.sin(d_lon / 2) ** 2
    return radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def calculate_stats(geojson: dict[str, Any] | None) -> dict[str, Any]:
    coords = extract_coordinates(geojson)
    if len(coords) < 2:
        return {
            "distance": 0,
            "elevationGain": 0,
            "elevationLoss": 0,
            "duration": 0,
            "pointCount": len(coords),
            "centerCoordinates": None,
            "startCoordinates": None,
            "endCoordinates": None,
        }

    distance = 0.0
    gain = 0.0
    loss = 0.0
    highest: float | None = None
    lowest: float | None = None
    max_grade = 0.0
    profile: list[dict[str, int]] = []
    cumulative = 0.0

    for index, coord in enumerate(coords):
        if has_elevation(coord):
            elevation = float(coord[2])
            highest = elevation if highest is None else max(highest, elevation)
            lowest = elevation if lowest is None else min(lowest, elevation)
            profile.append({"index": index, "distance": round(cumulative), "elevation": round(elevation)})
        if index == 0:
            continue
        step = haversine_meters(coords[index - 1], coord)
        distance += step
        cumulative += step
        if has_elevation(coords[index - 1]) and has_elevation(coord):
            diff = float(coord[2]) - float(coords[index - 1][2])
            if diff > 0:
                gain += diff
            else:
                loss += abs(diff)
            if step >= 20:
                max_grade = max(max_grade, abs(diff) / step)

    distance_km = distance / 1000
    duration = round((distance_km / 4 + gain / 600) * 3600)
    start = [float(coords[0][0]), float(coords[0][1])]
    end = [float(coords[-1][0]), float(coords[-1][1])]
    center = [round(sum(float(p[0]) for p in coords) / len(coords), 6), round(sum(float(p[1]) for p in coords) / len(coords), 6)]

    return {
        "distance": round(distance),
        "elevationGain": round(gain),
        "elevationLoss": round(loss),
        "highestPoint": None if highest is None else round(highest),
        "lowestPoint": None if lowest is None else round(lowest),
        "maxGrade": round(max_grade, 3),
        "duration": duration,
        "pointCount": len(coords),
        "centerCoordinates": center,
        "startCoordinates": start,
        "endCoordinates": end,
        "elevationProfile": sample_elevation_profile(profile),
    }


def sample_elevation_profile(profile: list[dict[str, int]], max_points: int = 160) -> list[dict[str, int]]:
    if len(profile) <= max_points:
        return profile
    last = len(profile) - 1
    return [profile[round((i / (max_points - 1)) * last)] for i in range(max_points)]


def merge_numeric_stats(base: dict[str, Any], extras: dict[str, Any] | None) -> dict[str, Any]:
    result = dict(base)
    for key in ["distance", "elevationGain", "elevationLoss", "duration", "highestPoint", "lowestPoint", "maxGrade", "directDistance", "routeRatio", "mapboxDuration", "pointCount"]:
        try:
            value = float((extras or {}).get(key))
        except (TypeError, ValueError):
            continue
        if math.isfinite(value):
            result[key] = round(value) if key != "maxGrade" else round(value, 3)
    for key in ["centerCoordinates", "startCoordinates", "endCoordinates", "elevationProfile"]:
        value = (extras or {}).get(key)
        if value:
            result[key] = value
    return result


def calculate_enriched_stats(geojson: dict[str, Any] | None, submitted_stats: dict[str, Any] | None = None) -> dict[str, Any]:
    """Calculate telemetry, trusting submitted Mapbox stats only when useful."""

    base = calculate_stats(geojson)
    merged = merge_numeric_stats(base, submitted_stats)
    elevation_gain = float(merged.get("elevationGain") or 0)
    distance = float(merged.get("distance") or base.get("distance") or 0)
    naismith = round(((distance / 1000) / 4 + elevation_gain / 600) * 3600)
    merged["duration"] = max(round(float(merged.get("duration") or 0)), naismith)
    return merged


def infer_difficulty_from_stats(stats: dict[str, Any] | None) -> str:
    distance_km = float((stats or {}).get("distance") or 0) / 1000
    gain = float((stats or {}).get("elevationGain") or 0)
    max_grade = float((stats or {}).get("maxGrade") or 0)
    score = 0
    if distance_km >= 30:
        score += 4
    elif distance_km >= 18:
        score += 3
    elif distance_km >= 9:
        score += 2
    elif distance_km >= 4:
        score += 1
    if gain >= 1800:
        score += 4
    elif gain >= 1000:
        score += 3
    elif gain >= 550:
        score += 2
    elif gain >= 250:
        score += 1
    if max_grade >= 0.35:
        score += 3
    elif max_grade >= 0.25:
        score += 2
    elif max_grade >= 0.15:
        score += 1
    if score >= 7:
        return "extreme"
    if score >= 5:
        return "hard"
    if score >= 2:
        return "moderate"
    return "easy"


def derive_trail_start_end_center(geojson: dict[str, Any] | None) -> dict[str, Any]:
    coords = extract_coordinates(geojson)
    if not coords:
        return {"startCoordinates": None, "endCoordinates": None, "centerCoordinates": None}
    return {
        "startCoordinates": [float(coords[0][0]), float(coords[0][1])],
        "endCoordinates": [float(coords[-1][0]), float(coords[-1][1])],
        "centerCoordinates": [round(sum(float(p[0]) for p in coords) / len(coords), 6), round(sum(float(p[1]) for p in coords) / len(coords), 6)],
    }


def derive_trail_point_labels(geojson: dict[str, Any] | None) -> dict[str, str]:
    coords = extract_coordinates(geojson)
    if not coords:
        return {"startPoint": "", "endPoint": "", "highestPoint": ""}

    def fmt(coord: list[float]) -> str:
        lng = float(coord[0])
        lat = float(coord[1])
        return f"{abs(lat):.5f}°{'N' if lat >= 0 else 'S'}, {abs(lng):.5f}°{'E' if lng >= 0 else 'W'}"

    elevations = [float(coord[2]) for coord in coords if has_elevation(coord)]
    return {
        "startPoint": fmt(coords[0]),
        "endPoint": fmt(coords[-1]),
        "highestPoint": f"{round(max(elevations))} m" if elevations else "",
    }


def sample_coordinates(coordinates: list[Any], max_points: int = 120) -> list[Any]:
    if len(coordinates) <= max_points:
        return coordinates
    last = len(coordinates) - 1
    return [coordinates[round((i / (max_points - 1)) * last)] for i in range(max_points)]


def simplify_map_geometry(geometry: dict[str, Any] | None, max_points: int = 120) -> dict[str, Any] | None:
    if not isinstance(geometry, dict):
        return None
    geo_type = geometry.get("type")
    if geo_type == "Feature":
        return simplify_map_geometry(geometry.get("geometry"), max_points)
    if geo_type == "FeatureCollection":
        for feature in geometry.get("features", []) or []:
            simplified = simplify_map_geometry(feature.get("geometry") if isinstance(feature, dict) else None, max_points)
            if simplified:
                return simplified
        return None
    if geo_type == "LineString":
        return {"type": "LineString", "coordinates": sample_coordinates(geometry.get("coordinates", []) or [], max_points)}
    if geo_type == "MultiLineString":
        lines = [line for line in geometry.get("coordinates", []) or [] if isinstance(line, list)]
        points_per_line = max(2, max_points // max(1, len(lines)))
        return {"type": "MultiLineString", "coordinates": [sample_coordinates(line, points_per_line) for line in lines if len(line) >= 2]}
    return None


def normalize_trail_marks(trail_marks: Any, geojson: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(trail_marks, list):
        return []
    max_index = max(0, len(extract_coordinates(geojson)) - 1)
    normalized: list[dict[str, Any]] = []
    for index, entry in enumerate(trail_marks):
        if not isinstance(entry, dict):
            continue
        colour = normalize_string(entry.get("colourType") or entry.get("colour_type")).lower()
        if colour not in TRAIL_MARK_COLOURS:
            continue
        try:
            raw_start = round(float(entry.get("startIndex")))
            raw_end = round(float(entry.get("endIndex")))
        except (TypeError, ValueError):
            continue
        start = max(0, min(max_index, min(raw_start, raw_end)))
        end = max(start, min(max_index, max(raw_start, raw_end)))
        normalized.append({
            "name": normalize_string(entry.get("name"))[:80] or f"Sector {index + 1}",
            "description": normalize_string(entry.get("description"))[:300],
            "colourType": colour,
            "startIndex": start,
            "endIndex": end,
        })
    return sorted(normalized, key=lambda mark: (mark["startIndex"], mark["endIndex"]))[:200]


def normalize_condition_payload(body: dict[str, Any] | None) -> dict[str, Any]:
    body = body or {}
    surface = normalize_string(body.get("surface")).lower()
    water = normalize_string(body.get("waterSources")).lower()
    hazards = body.get("hazards") if isinstance(body.get("hazards"), list) else []
    safe_hazards = [normalize_string(item).lower() for item in hazards]
    return {
        "surface": surface if surface in TRAIL_CONDITION_SURFACES else "mixed",
        "waterSources": water if water in TRAIL_CONDITION_WATER else "unknown",
        "hazards": sorted({item for item in safe_hazards if item in TRAIL_CONDITION_HAZARDS})[:8],
        "notes": normalize_string(body.get("notes"))[:500],
    }


def normalize_photo_ping_payload(body: dict[str, Any] | None) -> dict[str, Any]:
    body = body or {}
    category = normalize_string(body.get("photoCategory") or "memory")
    coordinates = body.get("coordinates") if isinstance(body.get("coordinates"), list) else []
    return {
        "photoUrl": normalize_string(body.get("photoUrl") or body.get("webPath")),
        "description": normalize_string(body.get("description"))[:200],
        "coordinates": [float(value) for value in coordinates[:2]] if len(coordinates) >= 2 else [],
        "photoCategory": category if category in PHOTO_PING_CATEGORIES else "memory",
        "trailId": normalize_string(body.get("trailId")),
    }


def infer_colour_type(colour_type: Any = None, osm_colour: Any = None, osm_marking: Any = None, trail_visibility: Any = None) -> str:
    current = normalize_string(colour_type).lower()
    if current in TRAIL_MARK_COLOURS:
        return current
    marking = normalize_string(osm_marking).lower()
    visibility = normalize_string(trail_visibility).lower()
    if marking in {"no", "false", "bad", "none", "unmarked"} or visibility in {"no", "bad", "horrible", "none"}:
        return "unmarked"
    colour = normalize_string(osm_colour).lower()
    for option in ["red", "blue", "green", "yellow", "white", "black"]:
        if option in colour:
            return option
    return "unmarked"
