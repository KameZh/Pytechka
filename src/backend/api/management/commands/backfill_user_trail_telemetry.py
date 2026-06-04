from __future__ import annotations

from typing import Any

from django.core.management.base import BaseCommand, CommandParser

from api.mongo import COLLECTIONS, get_mongo_db
from api.services.telemetry import build_full_trail_enrichment, has_usable_telemetry


class Command(BaseCommand):
    help = "Backfill telemetry, map geometry, and deterministic analysis for user-created trails."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--dry-run", action="store_true", help="Print planned changes without writing to MongoDB.")
        parser.add_argument("--limit", type=int, default=0, help="Limit how many trails are processed.")
        parser.add_argument("--force", action="store_true", help="Recalculate even trails that already look complete.")

    def handle(self, *args: Any, **options: Any) -> None:
        dry_run = bool(options["dry_run"])
        force = bool(options["force"])
        limit = int(options["limit"] or 0)
        db = get_mongo_db()
        cursor = db[COLLECTIONS.trails].find({})
        if limit > 0:
            cursor = cursor.limit(limit)

        scanned = 0
        updated = 0
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
                self.stdout.write(f"Would update {trail.get('_id')} - {trail.get('name')}")
            else:
                db[COLLECTIONS.trails].update_one({"_id": trail["_id"]}, {"$set": update})
            updated += 1

        mode = "planned" if dry_run else "updated"
        self.stdout.write(self.style.SUCCESS(f"Scanned {scanned}, {mode} {updated}, skipped {skipped}."))
