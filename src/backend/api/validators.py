from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable

from .geometry import PHOTO_PING_CATEGORIES, TRAIL_CONDITION_HAZARDS, TRAIL_CONDITION_SURFACES, TRAIL_CONDITION_WATER
from .mongo_helpers import is_object_id

TRAIL_DIFFICULTIES = {"easy", "moderate", "hard", "extreme"}
PING_TYPES = {"junk", "mud", "environmental_danger", "photo"}
TRAIL_MARK_COLOURS = {"red", "blue", "green", "yellow", "white", "black", "unmarked"}


@dataclass(frozen=True)
class ValidationResult:
    data: dict[str, Any] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


@dataclass(frozen=True)
class CoordinateValidation:
    coordinates: list[float]
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.error is None


def clean_string(value: Any, max_length: int = 500) -> str:
    return str(value or "").strip()[:max_length]


def validate_coordinates(value: Any, *, field_name: str = "coordinates") -> CoordinateValidation:
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        return CoordinateValidation([], f"{field_name} must be [longitude, latitude]")
    try:
        lng = float(value[0])
        lat = float(value[1])
    except (TypeError, ValueError):
        return CoordinateValidation([], f"{field_name} must contain numeric values")
    if abs(lng) > 180 or abs(lat) > 90:
        return CoordinateValidation([], f"{field_name} is outside valid longitude/latitude bounds")
    return CoordinateValidation([lng, lat])


def validate_geojson(value: Any) -> ValidationResult:
    errors: list[str] = []
    if not isinstance(value, dict):
        return ValidationResult(errors=["geojson is required"])
    geo_type = value.get("type")
    if geo_type not in {"LineString", "MultiLineString", "Feature", "FeatureCollection"}:
        errors.append("geojson must be a line geometry, feature, or feature collection")
    if geo_type == "LineString" and len(value.get("coordinates") or []) < 2:
        errors.append("LineString geojson must contain at least two points")
    return ValidationResult(data={"geojson": value}, errors=errors)


def validate_create_trail_payload(body: dict[str, Any]) -> ValidationResult:
    errors: list[str] = []
    name = clean_string(body.get("name"), 120)
    if not name:
        errors.append("name is required")
    geojson_result = validate_geojson(body.get("geojson"))
    errors.extend(geojson_result.errors)
    difficulty = clean_string(body.get("difficulty"), 40).lower()
    if difficulty and difficulty not in TRAIL_DIFFICULTIES:
        errors.append("difficulty must be easy, moderate, hard, or extreme")
    return ValidationResult(
        data={
            "name": name,
            "region": clean_string(body.get("region"), 120),
            "difficulty": difficulty,
            "description": clean_string(body.get("description"), 1200),
            "equipment": clean_string(body.get("equipment"), 800),
            "resources": clean_string(body.get("resources"), 800),
            "geojson": geojson_result.data.get("geojson"),
            "stats": body.get("stats") if isinstance(body.get("stats"), dict) else {},
            "trailMarks": body.get("trailMarks") if isinstance(body.get("trailMarks"), list) else [],
        },
        errors=errors,
    )


def validate_update_trail_payload(body: dict[str, Any]) -> ValidationResult:
    allowed: dict[str, Any] = {}
    errors: list[str] = []
    for key, limit in {"name": 120, "region": 120, "description": 1200, "equipment": 800, "resources": 800}.items():
        if key in body:
            value = clean_string(body.get(key), limit)
            if key == "name" and not value:
                errors.append("name cannot be empty")
            allowed[key] = value
    if "difficulty" in body:
        difficulty = clean_string(body.get("difficulty"), 40).lower()
        if difficulty not in TRAIL_DIFFICULTIES:
            errors.append("difficulty must be easy, moderate, hard, or extreme")
        else:
            allowed["difficulty"] = difficulty
    if "trailMarks" in body:
        if not isinstance(body.get("trailMarks"), list):
            errors.append("trailMarks must be a list")
        else:
            allowed["trailMarks"] = body["trailMarks"]
    return ValidationResult(data=allowed, errors=errors)


def validate_ping_payload(body: dict[str, Any]) -> ValidationResult:
    errors: list[str] = []
    ping_type = clean_string(body.get("type"), 40)
    if ping_type not in PING_TYPES:
        errors.append("type must be junk, mud, environmental_danger, or photo")
    coordinates = validate_coordinates(body.get("coordinates"))
    if not coordinates.ok:
        errors.append(coordinates.error or "invalid coordinates")
    trail_id = clean_string(body.get("trailId"), 40)
    if trail_id and not is_object_id(trail_id):
        errors.append("trailId must be a Mongo ObjectId")
    return ValidationResult(
        data={
            "type": ping_type,
            "coordinates": coordinates.coordinates,
            "trailId": trail_id,
            "description": clean_string(body.get("description"), 200),
            "photoUrl": clean_string(body.get("photoUrl"), 6_000_000),
            "photoCategory": clean_string(body.get("photoCategory"), 40),
        },
        errors=errors,
    )


def validate_photo_ping_payload(body: dict[str, Any]) -> ValidationResult:
    errors: list[str] = []
    photo_url = clean_string(body.get("photoUrl") or body.get("webPath"), 6_000_000)
    if not photo_url:
        errors.append("photoUrl is required")
    elif not (photo_url.startswith("data:image/") or photo_url.startswith("http")):
        errors.append("photoUrl must be image data or an http URL")
    coordinates = validate_coordinates(body.get("coordinates"))
    if not coordinates.ok:
        errors.append(coordinates.error or "invalid coordinates")
    category = clean_string(body.get("photoCategory") or "memory", 40)
    if category not in PHOTO_PING_CATEGORIES:
        category = "memory"
    return ValidationResult(
        data={
            "photoUrl": photo_url,
            "description": clean_string(body.get("description"), 200),
            "coordinates": coordinates.coordinates,
            "photoCategory": category,
            "trailId": clean_string(body.get("trailId"), 40),
        },
        errors=errors,
    )


def validate_condition_payload(body: dict[str, Any]) -> ValidationResult:
    surface = clean_string(body.get("surface"), 40).lower()
    water = clean_string(body.get("waterSources"), 40).lower()
    hazards_source = body.get("hazards") if isinstance(body.get("hazards"), list) else []
    hazards = sorted({clean_string(item, 60).lower() for item in hazards_source if clean_string(item, 60).lower() in TRAIL_CONDITION_HAZARDS})
    return ValidationResult(
        data={
            "surface": surface if surface in TRAIL_CONDITION_SURFACES else "mixed",
            "waterSources": water if water in TRAIL_CONDITION_WATER else "unknown",
            "hazards": hazards[:8],
            "notes": clean_string(body.get("notes"), 500),
        }
    )


def validate_review_payload(body: dict[str, Any]) -> ValidationResult:
    try:
        accuracy = float(body.get("accuracy"))
    except (TypeError, ValueError):
        return ValidationResult(errors=["accuracy must be a number between 1 and 5"])
    if accuracy < 1 or accuracy > 5:
        return ValidationResult(errors=["accuracy must be between 1 and 5"])
    return ValidationResult(data={"accuracy": accuracy, "comment": clean_string(body.get("comment"), 600)})


def list_errors(errors: Iterable[str]) -> str:
    return "; ".join(error for error in errors if error)


def validate_bbox(value: Any) -> ValidationResult:
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        return ValidationResult(errors=["bbox must be [west, south, east, north]"])
    try:
        west, south, east, north = [float(item) for item in value]
    except (TypeError, ValueError):
        return ValidationResult(errors=["bbox values must be numeric"])
    if not (-180 <= west <= 180 and -180 <= east <= 180 and -90 <= south <= 90 and -90 <= north <= 90):
        return ValidationResult(errors=["bbox is outside longitude/latitude bounds"])
    if west >= east or south >= north:
        return ValidationResult(errors=["bbox must have west < east and south < north"])
    return ValidationResult(data={"bbox": [west, south, east, north]})


def validate_zoom_range(min_zoom: Any, max_zoom: Any) -> ValidationResult:
    try:
        min_value = int(min_zoom if min_zoom is not None else 8)
        max_value = int(max_zoom if max_zoom is not None else 14)
    except (TypeError, ValueError):
        return ValidationResult(errors=["zoom values must be integers"])
    if min_value < 0 or max_value > 18 or min_value > max_value:
        return ValidationResult(errors=["zoom range must be between 0 and 18 and minZoom <= maxZoom"])
    if max_value - min_value > 8:
        return ValidationResult(errors=["zoom range is too large for a single offline pack"])
    return ValidationResult(data={"minZoom": min_value, "maxZoom": max_value})


def validate_offline_download_payload(body: dict[str, Any]) -> ValidationResult:
    errors: list[str] = []
    name = clean_string(body.get("name") or "Offline pack", 120)
    device_id = clean_string(body.get("deviceId") or body.get("deviceName") or "unknown-device", 160)
    resource_types = body.get("resourceTypes") if isinstance(body.get("resourceTypes"), list) else []
    allowed_resources = {"trails", "official_trails", "huts", "pings", "photo_pings", "clusters", "map_tiles"}
    resources = sorted({clean_string(item, 40) for item in resource_types if clean_string(item, 40) in allowed_resources}) or ["trails", "official_trails", "huts"]

    zoom_result = validate_zoom_range(body.get("minZoom"), body.get("maxZoom"))
    errors.extend(zoom_result.errors)

    area_mode = clean_string(body.get("areaMode") or "bbox", 20).lower()
    area: dict[str, Any] = {"mode": area_mode}
    if area_mode == "bbox":
        bbox_result = validate_bbox(body.get("bbox"))
        errors.extend(bbox_result.errors)
        area.update(bbox_result.data)
    elif area_mode == "radius":
        center_result = validate_coordinates(body.get("center"), field_name="center")
        if not center_result.ok:
            errors.append(center_result.error or "invalid center")
        try:
            radius_km = float(body.get("radiusKm"))
        except (TypeError, ValueError):
            radius_km = 0
            errors.append("radiusKm must be numeric")
        if radius_km <= 0 or radius_km > 100:
            errors.append("radiusKm must be between 0 and 100")
        area.update({"center": center_result.coordinates, "radiusKm": radius_km})
    else:
        errors.append("areaMode must be bbox or radius")

    return ValidationResult(
        data={
            "name": name,
            "deviceId": device_id,
            "resourceTypes": resources,
            "area": area,
            **zoom_result.data,
        },
        errors=errors,
    )
