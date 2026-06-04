from __future__ import annotations

from typing import Any

from django.core.management.base import BaseCommand

from api.mongo import COLLECTIONS, get_mongo_db


class Command(BaseCommand):
    help = "Print Mongo collection counts used by the Pytechka map."

    def handle(self, *args: Any, **options: Any) -> None:
        db = get_mongo_db()
        collections = [
            COLLECTIONS.trails,
            COLLECTIONS.official_trails,
            COLLECTIONS.huts,
            COLLECTIONS.pings,
            COLLECTIONS.photo_pings,
            COLLECTIONS.trash_clusters,
            COLLECTIONS.users,
        ]
        for name in collections:
            count = db[name].count_documents({})
            self.stdout.write(f"{name}: {count}")
