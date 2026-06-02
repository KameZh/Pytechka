from __future__ import annotations

from dataclasses import dataclass
from math import asin, cos, radians, sin, sqrt
from typing import Any

DOWNLOAD_RESOURCE_TYPES = {"trails", "official_trails", "huts", "pings", "photo_pings", "clusters", "map_tiles"}
DOWNLOAD_STATUSES = {"queued", "ready", "failed", "deleted"}


@dataclass(frozen=True)
class OfflineArea:

    mode: str
    bbox: list[float] | None = None
    center: list[float] | None = None
    radius_km: float | None = None


def haversine_meters(first: list[float], second: list[float]) -> float:

    first_lng, first_lat = first
    second_lng, second_lat = second
    earth_radius_m = 6_371_000
    delta_lat = radians(second_lat - first_lat)
    delta_lng = radians(second_lng - first_lng)
    a = sin(delta_lat / 2) ** 2 + cos(radians(first_lat)) * cos(radians(second_lat)) * sin(delta_lng / 2) ** 2
    return 2 * earth_radius_m * asin(sqrt(a))


def normalize_resource_types(values: Any) -> list[str]:

    if not isinstance(values, list):
        return ["trails", "official_trails", "huts", "pings", "photo_pings", "clusters"]
    normalized = [str(value).strip() for value in values if str(value).strip() in DOWNLOAD_RESOURCE_TYPES]
    return sorted(set(normalized)) or ["trails"]


def estimate_tile_count(area: OfflineArea, min_zoom: int, max_zoom: int) -> int:

    zoom_span = max(0, max_zoom - min_zoom + 1)
    if area.mode == "radius" and area.radius_km:
        square_km = (area.radius_km * 2) ** 2
    elif area.mode == "bbox" and area.bbox:
        west, south, east, north = area.bbox
        width_km = haversine_meters([west, south], [east, south]) / 1000
        height_km = haversine_meters([west, south], [west, north]) / 1000
        square_km = max(1.0, width_km * height_km)
    else:
        square_km = 1.0
    return max(1, round(square_km * zoom_span * 0.35))


def build_pack_summary(pack: dict[str, Any]) -> dict[str, Any]:

    resources = pack.get("resources") if isinstance(pack.get("resources"), dict) else {}
    counts = resources.get("counts") if isinstance(resources.get("counts"), dict) else {}
    return {
        "id": str(pack.get("_id")),
        "name": pack.get("name") or "Offline pack",
        "deviceId": pack.get("deviceId") or "unknown-device",
        "status": pack.get("status") or "ready",
        "resourceTypes": pack.get("resourceTypes") or [],
        "counts": counts,
        "tileEstimate": resources.get("tileEstimate") or 0,
        "createdAt": pack.get("createdAt"),
        "updatedAt": pack.get("updatedAt"),
    }


def summarize_packs(packs: list[dict[str, Any]]) -> dict[str, Any]:

    total_counts = {"trails": 0, "official_trails": 0, "huts": 0, "pings": 0, "photo_pings": 0, "clusters": 0, "map_tiles": 0}
    devices: dict[str, int] = {}
    for pack in packs:
        summary = build_pack_summary(pack)
        devices[summary["deviceId"]] = devices.get(summary["deviceId"], 0) + 1
        for key, value in summary["counts"].items():
            total_counts[key] = total_counts.get(key, 0) + int(value or 0)
        total_counts["map_tiles"] += int(summary.get("tileEstimate") or 0)
    return {
        "packs": [build_pack_summary(pack) for pack in packs],
        "totals": total_counts,
        "devices": [{"deviceId": device_id, "packs": count} for device_id, count in sorted(devices.items())],
    }
