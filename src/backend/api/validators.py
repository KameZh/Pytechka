from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .services.offline import DOWNLOAD_RESOURCE_TYPES, normalize_resource_types


@dataclass(frozen=True)
class ValidationResult:

    ok: bool
    data: dict[str, Any] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)


def validate_bbox(value: Any) -> ValidationResult:

    if not isinstance(value, list) or len(value) != 4:
        return ValidationResult(False, errors=["bbox must contain west, south, east and north"])
    try:
        west, south, east, north = [float(item) for item in value]
    except (TypeError, ValueError):
        return ValidationResult(False, errors=["bbox values must be numbers"])
    if not (-180 <= west <= 180 and -180 <= east <= 180 and -90 <= south <= 90 and -90 <= north <= 90):
        return ValidationResult(False, errors=["bbox coordinates are outside valid longitude/latitude ranges"])
    if west >= east or south >= north:
        return ValidationResult(False, errors=["bbox must be ordered as west < east and south < north"])
    return ValidationResult(True, data={"bbox": [west, south, east, north]})


def validate_zoom_range(min_zoom: Any, max_zoom: Any) -> ValidationResult:

    try:
        parsed_min = int(min_zoom)
        parsed_max = int(max_zoom)
    except (TypeError, ValueError):
        return ValidationResult(False, errors=["minZoom and maxZoom must be integers"])
    if parsed_min < 0 or parsed_max > 18 or parsed_min > parsed_max:
        return ValidationResult(False, errors=["zoom range must be between 0 and 18 with minZoom <= maxZoom"])
    if parsed_max - parsed_min > 8:
        return ValidationResult(False, errors=["offline zoom range is too large for one pack"])
    return ValidationResult(True, data={"minZoom": parsed_min, "maxZoom": parsed_max})


def validate_offline_download_payload(body: dict[str, Any]) -> ValidationResult:

    errors: list[str] = []
    name = str(body.get("name") or "Offline pack").strip()[:80] or "Offline pack"
    device_id = str(body.get("deviceId") or "").strip()
    if not device_id:
        errors.append("deviceId is required")

    zoom = validate_zoom_range(body.get("minZoom", 10), body.get("maxZoom", 14))
    if not zoom.ok:
        errors.extend(zoom.errors)

    area_mode = str(body.get("areaMode") or body.get("mode") or "bbox").strip().lower()
    area: dict[str, Any] = {"mode": area_mode}
    if area_mode == "bbox":
        bbox = validate_bbox(body.get("bbox"))
        if bbox.ok:
            area["bbox"] = bbox.data["bbox"]
        else:
            errors.extend(bbox.errors)
    elif area_mode == "radius":
        center = body.get("center")
        try:
            radius_km = float(body.get("radiusKm"))
        except (TypeError, ValueError):
            radius_km = 0
        if not isinstance(center, list) or len(center) != 2:
            errors.append("center must be [lng, lat] for radius offline packs")
        if radius_km <= 0 or radius_km > 100:
            errors.append("radiusKm must be between 0 and 100")
        if isinstance(center, list) and len(center) == 2:
            area["center"] = [float(center[0]), float(center[1])]
        area["radiusKm"] = radius_km
    else:
        errors.append("areaMode must be bbox or radius")

    resource_types = normalize_resource_types(body.get("resourceTypes"))
    if any(resource not in DOWNLOAD_RESOURCE_TYPES for resource in resource_types):
        errors.append("resourceTypes contains unsupported values")

    if errors:
        return ValidationResult(False, errors=errors)
    return ValidationResult(True, data={
        "name": name,
        "deviceId": device_id,
        "resourceTypes": resource_types,
        "area": area,
        "minZoom": zoom.data["minZoom"],
        "maxZoom": zoom.data["maxZoom"],
    })
