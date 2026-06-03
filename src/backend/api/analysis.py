from __future__ import annotations

import math
from typing import Any

from .geometry import calculate_stats, extract_coordinates, has_elevation, haversine_meters, infer_difficulty_from_stats


def format_minutes(seconds: float | int | None) -> str:
    minutes = max(1, round(float(seconds or 0) / 60))
    if minutes < 60:
        return f"{minutes} min"
    hours = minutes // 60
    rest = minutes % 60
    return f"{hours} h {rest} min" if rest else f"{hours} h"


def bearing_degrees(first: list[float], second: list[float]) -> float:
    lon1, lat1 = map(float, first[:2])
    lon2, lat2 = map(float, second[:2])
    start_lat = math.radians(lat1)
    end_lat = math.radians(lat2)
    delta_lon = math.radians(lon2 - lon1)
    y = math.sin(delta_lon) * math.cos(end_lat)
    x = math.cos(start_lat) * math.sin(end_lat) - math.sin(start_lat) * math.cos(end_lat) * math.cos(delta_lon)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def summarize_segment(coords: list[list[float]], start_index: int, end_index: int) -> dict[str, Any]:
    distance = 0.0
    gain = 0.0
    loss = 0.0
    max_grade = 0.0
    for index in range(start_index + 1, end_index + 1):
        prev = coords[index - 1]
        nxt = coords[index]
        step = haversine_meters(prev, nxt)
        distance += step
        if has_elevation(prev) and has_elevation(nxt):
            diff = float(nxt[2]) - float(prev[2])
            if diff > 0:
                gain += diff
            else:
                loss += abs(diff)
            if step >= 20:
                max_grade = max(max_grade, abs(diff) / step)
    duration = (distance / 1000 / 4 + gain / 600) * 3600
    difficulty = infer_difficulty_from_stats({"distance": distance, "elevationGain": gain, "maxGrade": max_grade})
    return {
        "distanceMeters": round(distance),
        "elevationGain": round(gain),
        "elevationLoss": round(loss),
        "maxGrade": round(max_grade, 3),
        "duration": round(duration),
        "difficulty": difficulty,
    }


def build_segment_orientation(coords: list[list[float]], start_index: int, end_index: int, trail_marks: list[dict[str, Any]]) -> str:
    related = next((mark for mark in trail_marks if int(mark.get("endIndex", 0)) >= start_index and int(mark.get("startIndex", 0)) <= end_index), None)
    notes: list[str] = []
    colour = str((related or {}).get("colourType") or "unmarked")
    if colour != "unmarked":
        notes.append(f"Follow {colour} trail marks in this sector")
    else:
        notes.append("No reliable colour marking is stored for this sector")
    turns = 0
    for index in range(start_index + 2, end_index + 1):
        first = bearing_degrees(coords[index - 2], coords[index - 1])
        second = bearing_degrees(coords[index - 1], coords[index])
        delta = abs(((second - first + 540) % 360) - 180)
        if delta >= 55:
            turns += 1
    if turns >= 3:
        notes.append("Several sharp turns or junction-like bends need attention")
    elif turns >= 1:
        notes.append("Watch for at least one clear turn in this sector")
    else:
        notes.append("Mostly direct sector with no major stored turn")
    return ". ".join(notes) + "."


def split_route_into_segments(coords: list[list[float]], trail_marks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    point_count = len(coords)
    if point_count < 2:
        return []
    stats = calculate_stats({"type": "LineString", "coordinates": coords})
    distance_km = float(stats.get("distance") or 0) / 1000
    target = min(6, max(2, math.ceil(distance_km / 4) or 2))
    segment_count = min(target, point_count - 1)
    segments: list[dict[str, Any]] = []
    for segment_index in range(segment_count):
        start = 0 if segment_index == 0 else round((segment_index / segment_count) * (point_count - 1))
        end = point_count - 1 if segment_index == segment_count - 1 else max(start + 1, round(((segment_index + 1) / segment_count) * (point_count - 1)))
        summary = summarize_segment(coords, start, end)
        grade_percent = round(float(summary["maxGrade"]) * 100)
        pieces = [f"{summary['distanceMeters'] / 1000:.1f} km"]
        if summary["elevationGain"]:
            pieces.append(f"{summary['elevationGain']} m climb")
        if summary["elevationLoss"]:
            pieces.append(f"{summary['elevationLoss']} m descent")
        if grade_percent >= 12:
            pieces.append(f"steepest grade about {grade_percent}%")
        climb_rate = float(summary["elevationGain"]) / max(1, float(summary["distanceMeters"]))
        exposure = "high" if float(summary["maxGrade"]) >= 0.35 or climb_rate >= 0.18 else "medium" if float(summary["maxGrade"]) >= 0.22 or climb_rate >= 0.11 else "low"
        segments.append({
            "name": f"Segment {segment_index + 1}",
            "difficulty": summary["difficulty"],
            "description": ", ".join(pieces),
            "estimatedTime": format_minutes(summary["duration"]),
            "startIndex": start,
            "endIndex": end,
            "distanceMeters": summary["distanceMeters"],
            "elevationGain": summary["elevationGain"],
            "elevationLoss": summary["elevationLoss"],
            "maxGrade": summary["maxGrade"],
            "exposure": exposure,
            "orientationNote": build_segment_orientation(coords, start, end, trail_marks),
        })
    return segments


def build_warnings(stats: dict[str, Any], segments: list[dict[str, Any]], has_elevation_data: bool) -> list[dict[str, Any]]:
    warnings: list[dict[str, Any]] = []
    distance_km = float(stats.get("distance") or 0) / 1000
    gain = float(stats.get("elevationGain") or 0)
    if distance_km >= 25 or gain >= 1500:
        warnings.append({"type_": "terrain", "severity": "high", "description": "Long and demanding route. Start early, carry extra water, and plan bailout points."})
    elif distance_km >= 14 or gain >= 800:
        warnings.append({"type_": "terrain", "severity": "medium", "description": "Moderate endurance required. Check weather and keep enough daylight for the return."})
    if any(float(segment.get("maxGrade") or 0) >= 0.25 for segment in segments):
        warnings.append({"type_": "steep_descent", "severity": "medium", "description": "One or more sectors contain steep ground. Slow down on wet, icy, or loose terrain."})
    if not has_elevation_data:
        warnings.append({"type_": "other", "severity": "low", "description": "No elevation samples are stored for this route, so climbing difficulty is estimated from distance only."})
    return warnings


def build_weather_risk(coords: list[list[float]], segments: list[dict[str, Any]]) -> dict[str, Any]:
    elevations = [float(coord[2]) for coord in coords if has_elevation(coord)]
    if not elevations:
        return {"score": 0, "level": "unknown", "elevationBands": [{"min": 0, "max": 0, "risk": "unknown", "notes": ["No elevation samples are stored for weather band analysis"]}]}
    min_band = math.floor(min(elevations) / 250) * 250
    max_band = max(min_band + 250, math.ceil(max(elevations) / 250) * 250)
    bands: list[dict[str, Any]] = []
    for floor in range(int(min_band), int(max_band), 250):
        ceiling = floor + 250
        if ceiling >= 2200:
            risk = "high"
            notes = ["High mountain band: wind, fog, snow, and lightning risk rises quickly"]
        elif ceiling >= 1500:
            risk = "medium"
            notes = ["Mountain weather can change fast above this elevation"]
        else:
            risk = "low"
            notes = ["Lower elevation band, usually less exposed"]
        if any(segment.get("exposure") != "low" for segment in segments):
            risk = "high" if risk == "high" else "medium"
            notes.append("Steep exposed sectors increase risk in poor weather")
        bands.append({"min": floor, "max": ceiling, "risk": risk, "notes": notes})
    score = min(100, round(sum(35 if b["risk"] == "high" else 18 if b["risk"] == "medium" else 7 for b in bands) / len(bands)))
    return {"score": score, "level": "high" if score >= 55 else "medium" if score >= 28 else "low", "elevationBands": bands}


def analyze_route_locally(route: dict[str, Any]) -> dict[str, Any]:
    coords = extract_coordinates(route.get("geojson"))
    stats = route.get("stats") if route.get("stats", {}).get("distance") else calculate_stats(route.get("geojson"))
    if len(coords) < 2:
        return {"segments": [], "warnings": [{"type_": "other", "severity": "medium", "description": "Route geometry is too short to analyze reliably."}], "summary": "Route analysis is limited because the saved geometry is incomplete.", "overallDifficulty": route.get("difficulty") or "moderate"}
    trail_marks = route.get("trailMarks") if isinstance(route.get("trailMarks"), list) else []
    segments = split_route_into_segments(coords, trail_marks)
    overall = infer_difficulty_from_stats(stats)
    warnings = build_warnings(stats, segments, any(has_elevation(coord) for coord in coords))
    weather = build_weather_risk(coords, segments)
    season_labels = []
    if weather["level"] == "high" or float(stats.get("elevationGain") or 0) >= 1100:
        season_labels.append("best in stable summer or early autumn weather")
    else:
        season_labels.append("usable in most dry seasons")
    if any(float(segment.get("maxGrade") or 0) >= 0.22 for segment in segments):
        season_labels.append("avoid after heavy rain")
    if float(stats.get("elevationGain") or 0) >= 700 or float(stats.get("distance") or 0) / 1000 >= 14:
        season_labels.append("winter risk without snow equipment")
    orientation_notes = list(dict.fromkeys([segment.get("orientationNote") for segment in segments if segment.get("orientationNote")]))[:10]
    quality = 62
    reasons: list[str] = []
    if len(coords) >= 250:
        quality += 10
        reasons.append("dense route geometry")
    elif len(coords) < 30:
        quality -= 12
        reasons.append("sparse route geometry")
    if trail_marks:
        quality += 8
        reasons.append("trail mark sectors are stored")
    else:
        quality -= 8
        reasons.append("no trail mark sectors stored")
    if any(w["severity"] == "high" for w in warnings):
        quality -= 8
        reasons.append("high-severity terrain warning")
    quality = max(0, min(100, quality))
    summary = f"{float(stats.get('distance') or 0) / 1000:.1f} km route with {round(float(stats.get('elevationGain') or 0))} m climb. Estimated hiking time {format_minutes(stats.get('duration'))}. Overall difficulty {overall}. Weather risk {weather['level']}. Quality score {quality}/100."
    return {
        "segments": segments,
        "warnings": warnings,
        "summary": summary,
        "overallDifficulty": overall,
        "hikingTimeSeconds": round(float(stats.get("duration") or 0)),
        "weatherRisk": weather,
        "seasonLabels": season_labels,
        "orientationNotes": orientation_notes,
        "qualityScore": quality,
        "qualityReasons": reasons[:6],
    }
