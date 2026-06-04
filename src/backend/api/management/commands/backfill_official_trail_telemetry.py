from __future__ import annotations

from typing import Any

from django.core.management.base import BaseCommand, CommandParser

from api.mongo import COLLECTIONS, get_mongo_db
from api.services.telemetry import build_full_trail_enrichment, has_usable_telemetry


class Command(BaseCommand):
    help = "Backfill geometry/telemetry for official OSM trails without changing the source collection shape."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--dry-run", action="store_true", help="Only report what would change.")
        parser.add_argument("--limit", type=int, default=0, help="Limit how many official trails are processed.")
        parser.add_argument("--force", action="store_true", help="Recalculate already complete documents too.")

    def handle(self, *args: Any, **options: Any) -> None:
        db = get_mongo_db()
        dry_run = bool(options["dry_run"])
        force = bool(options["force"])
        cursor = db[COLLECTIONS.official_trails].find({})
        if int(options["limit"] or 0) > 0:
            cursor = cursor.limit(int(options["limit"]))

        scanned = 0
        changed = 0
        skipped = 0
        for trail in cursor:
            scanned += 1
            if not force and has_usable_telemetry(trail):
                skipped += 1
                continue
            enrichment = build_full_trail_enrichment(trail)
            if not enrichment:
                skipped += 1
                continue
            update = {key: enrichment[key] for key in ["stats", "startPoint", "endPoint", "highestPoint", "startCoordinates", "endCoordinates", "mapGeometry", "difficulty", "trailMarks", "ai"] if key in enrichment}
            if dry_run:
                self.stdout.write(f"Would update official trail {trail.get('_id')} - {trail.get('name')}")
            else:
                db[COLLECTIONS.official_trails].update_one({"_id": trail["_id"]}, {"$set": update})
            changed += 1

        mode = "planned" if dry_run else "updated"
        self.stdout.write(self.style.SUCCESS(f"Scanned {scanned}, {mode} {changed}, skipped {skipped}."))
