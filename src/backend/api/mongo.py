from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from django.conf import settings
from pymongo import MongoClient
from pymongo.database import Database

_client: MongoClient | None = None
_db: Database | None = None


@dataclass(frozen=True)
class CollectionNames:

    trails: str = "trails"
    official_trails: str = "official_trails"
    huts: str = "huts"
    pings: str = "pings"
    photo_pings: str = "photopings"
    trash_clusters: str = "trashclusters"
    users: str = "users"
    offline_downloads: str = "offline_downloads"


COLLECTIONS: Final[CollectionNames] = CollectionNames()


def get_mongo_db() -> Database:

    global _client, _db

    if _db is not None:
        return _db

    if not settings.MONGO_URI:
        raise RuntimeError("MONGO_URI is missing from .env")
    if not settings.MONGO_DB_NAME:
        raise RuntimeError("MONGO_DB_NAME is missing from .env")

    _client = MongoClient(settings.MONGO_URI, serverSelectionTimeoutMS=10000)
    _db = _client[settings.MONGO_DB_NAME]
    return _db

def is_database_ready() -> bool:
    """Check whether MongoDB answers a simple ping."""

    try:
        get_mongo_db().command("ping")
        return True
    except Exception:
        return False