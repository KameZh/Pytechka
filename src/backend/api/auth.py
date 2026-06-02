from __future__ import annotations

import base64
import json
from datetime import datetime, timezone
from typing import Any

from rest_framework.request import Request
from rest_framework.response import Response

from .mongo import COLLECTIONS, get_mongo_db


def _decode_jwt_payload(token: str) -> dict[str, Any]:
    """Decode a JWT payload without verification for local migration testing.

    Production should verify Clerk signatures. For this school migration, this
    keeps the frontend working while the backend is being translated to Django.
    """

    try:
        payload = token.split(".")[1]
        padded = payload + "=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(padded.encode()).decode())
    except Exception:
        return {}


def get_request_user_id(request: Request) -> str | None:
    """Extract a Clerk user id from Authorization or development headers."""

    header_value = request.headers.get("Authorization", "")
    if header_value.lower().startswith("bearer "):
        payload = _decode_jwt_payload(header_value.split(" ", 1)[1].strip())
        subject = payload.get("sub") or payload.get("user_id")
        if subject:
            return str(subject)

    dev_user_id = request.headers.get("X-User-Id")
    return str(dev_user_id) if dev_user_id else None


def ensure_user_document(request: Request) -> tuple[str | None, dict[str, Any] | None, Response | None]:
    """Return the authenticated Mongo user, creating a small profile if needed."""

    user_id = get_request_user_id(request)
    if not user_id:
        return None, None, Response({"error": "Unauthenticated"}, status=401)

    db = get_mongo_db()
    users = db[COLLECTIONS.users]
    user = users.find_one({"clerkId": user_id})
    if user:
        return user_id, user, None

    now = datetime.now(timezone.utc)
    username = f"user_{user_id[-8:].lower()}" if len(user_id) >= 8 else "user"
    suffix = 1
    candidate = username
    while users.find_one({"username": candidate}):
        suffix += 1
        candidate = f"{username}_{suffix}"

    user_doc: dict[str, Any] = {
        "clerkId": user_id,
        "email": f"{user_id}@unknown.local",
        "username": candidate,
        "metadata": {},
        "badgeProgress": {
            "trailCompletions": 0,
            "createdTrails": 0,
            "campaignPoints": 0,
            "awarded": {"trailers": None, "contribution": None, "campaign": None},
        },
        "createdAt": now,
        "updatedAt": now,
    }
    result = users.insert_one(user_doc)
    user_doc["_id"] = result.inserted_id
    return user_id, user_doc, None