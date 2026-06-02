from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

BADGE_TIERS: dict[str, list[tuple[int, str]]] = {
    "trailers": [(20, "Senior"), (10, "Junior"), (3, "Rookie")],
    "contribution": [(20, "Country guide"), (10, "Local guide"), (3, "New guide")],
    "campaign": [(20, "Basically organizer"), (10, "Helper"), (3, "Volunteer")],
}


def pick_tier(category: str, value: int) -> str | None:

    for minimum, name in BADGE_TIERS.get(category, []):
        if value >= minimum:
            return name
    return None


def normalize_badge_progress(progress: dict[str, Any] | None) -> dict[str, Any]:

    progress = dict(progress or {})
    trail_completions = int(progress.get("trailCompletions") or 0)
    created_trails = int(progress.get("createdTrails") or 0)
    campaign_points = int(progress.get("campaignPoints") or 0)
    return {
        "trailCompletions": trail_completions,
        "createdTrails": created_trails,
        "campaignPoints": campaign_points,
        "awarded": {
            "trailers": pick_tier("trailers", trail_completions),
            "contribution": pick_tier("contribution", created_trails),
            "campaign": pick_tier("campaign", campaign_points),
        },
    }


def increment_badge_progress(progress: dict[str, Any] | None, increments: dict[str, int]) -> dict[str, Any]:

    normalized = normalize_badge_progress(progress)
    normalized["trailCompletions"] += int(increments.get("trailCompletions") or 0)
    normalized["createdTrails"] += int(increments.get("createdTrails") or 0)
    normalized["campaignPoints"] += int(increments.get("campaignPoints") or 0)
    return normalize_badge_progress(normalized)


def build_badge_update_document(progress: dict[str, Any]) -> dict[str, Any]:
    return {"badgeProgress": normalize_badge_progress(progress), "updatedAt": datetime.now(timezone.utc)}
