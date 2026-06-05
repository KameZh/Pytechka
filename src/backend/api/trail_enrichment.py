from __future__ import annotations

import re
from typing import Any

FEATURED_REFS = {"E3", "E4", "E8"}


def normalize_ref_tokens(value: Any) -> list[str]:
    return [token for token in re.split(r"[^A-Z0-9]+", str(value or "").upper()) if token]


def is_featured_official_trail(trail: dict[str, Any] | None = None) -> bool:
    trail = trail or {}
    tokens = normalize_ref_tokens(trail.get("ref"))
    if any(token in FEATURED_REFS for token in tokens):
        return True
    joined = " ".join(str(trail.get(key) or "").lower() for key in ["name", "name_bg", "name_en"])
    return (("ком" in joined and "емине" in joined) or ("kom" in joined and "emine" in joined)) and "KE" in tokens


def infer_official_trail_difficulty(trail: dict[str, Any] | None = None) -> str:
    trail = trail or {}
    stats = trail.get("stats") or {}
    distance_km = float(stats.get("distance") or 0) / 1000
    gain = float(stats.get("elevationGain") or 0)
    if distance_km >= 80 or (distance_km >= 50 and is_featured_official_trail(trail)):
        return "extreme"
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
    if str(trail.get("network") or "").lower() in {"iwn", "nwn"} and distance_km >= 12:
        score += 1
    if score >= 6:
        return "extreme"
    if score >= 4:
        return "hard"
    if score >= 2:
        return "moderate"
    return "easy"
