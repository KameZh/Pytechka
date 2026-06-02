from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

PING_EXPIRATION_SECONDS: dict[str, int | None] = {
    "junk": None,
    "mud": 24 * 60 * 60,
    "environmental_danger": 7 * 24 * 60 * 60,
    "photo": None,
}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def ping_expiration(ping_type: str) -> datetime | None:

    seconds = PING_EXPIRATION_SECONDS.get(ping_type)
    return utc_now() + timedelta(seconds=seconds) if seconds else None


def active_ping_query(now: datetime | None = None) -> dict[str, Any]:

    now = now or utc_now()
    return {"resolved": {"$ne": True}, "$or": [{"expiresAt": None}, {"expiresAt": {"$gt": now}}, {"expiresAt": {"$exists": False}}]}


def cluster_level_for_count(count: int) -> str:
    return "event" if count >= 5 else "clutter"


def cluster_description(level: str, count: int) -> str:
    if level == "event":
        return f"Trash cleanup needed! {count} reports of litter in this area."
    return f"Warning: {count} trash reports nearby. This area may need cleanup soon."


def required_cluster_votes(level: str) -> int:
    return 5 if level == "event" else 3


def add_unique_vote(votes: list[Any], user_id: str) -> tuple[list[str], bool]:

    normalized = [str(vote) for vote in votes]
    if user_id in normalized:
        return normalized, False
    normalized.append(user_id)
    return normalized, True
