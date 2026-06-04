from __future__ import annotations

from typing import Any

from django.core.management.base import BaseCommand, CommandParser

from api.mongo import COLLECTIONS, get_mongo_db
from api.services.pings import cluster_center, cluster_description, cluster_level_for_count, nearby_pings


class Command(BaseCommand):
    help = "Rebuild trash clusters from active junk pings. This mirrors the old Express clustering helper."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--dry-run", action="store_true", help="Report clusters without writing them.")
        parser.add_argument("--radius", type=float, default=300.0, help="Cluster radius in meters.")

    def handle(self, *args: Any, **options: Any) -> None:
        db = get_mongo_db()
        dry_run = bool(options["dry_run"])
        radius = float(options["radius"])
        pings = list(db[COLLECTIONS.pings].find({"type": "junk", "resolved": {"$ne": True}}))
        used: set[str] = set()
        created = 0

        for ping in pings:
            ping_id = str(ping.get("_id"))
            if ping_id in used or not isinstance(ping.get("coordinates"), list):
                continue
            group = nearby_pings(ping["coordinates"], pings, radius)
            if len(group) < 3:
                continue
            for grouped_ping in group:
                used.add(str(grouped_ping.get("_id")))
            level = cluster_level_for_count(len(group))
            center = cluster_center(group)
            document = {
                "level": level,
                "coordinates": center,
                "pingIds": [item["_id"] for item in group],
                "pingCount": len(group),
                "description": cluster_description(level, len(group)),
                "goneVotes": [],
                "resolved": False,
            }
            if dry_run:
                self.stdout.write(f"Would create {level} cluster with {len(group)} pings at {center}")
            else:
                db[COLLECTIONS.trash_clusters].insert_one(document)
            created += 1

        mode = "planned" if dry_run else "created"
        self.stdout.write(self.style.SUCCESS(f"Scanned {len(pings)} junk pings, {mode} {created} clusters."))
