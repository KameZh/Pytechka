from __future__ import annotations

from bson import ObjectId


def make_object_id(value: str | ObjectId | None) -> ObjectId | None:
    try:
        return ObjectId(str(value))
    except Exception:
        return None


def is_object_id(value: str | None) -> bool:
    return make_object_id(value) is not None