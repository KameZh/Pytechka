from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from unittest.mock import patch

from bson import ObjectId

ROOT = Path(__file__).resolve().parents[1]
BACKEND_SRC = ROOT / "src" / "backend"
if str(BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(BACKEND_SRC))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "pytechka.settings")

import django  

django.setup()

from django.test import Client, SimpleTestCase, override_settings  


class FakeInsertResult:
    def __init__(self, inserted_id: ObjectId) -> None:
        self.inserted_id = inserted_id


class FakeUpdateResult:
    def __init__(self, modified_count: int = 1) -> None:
        self.modified_count = modified_count


class FakeCursor(list):
    def sort(self, key: str, direction: int) -> "FakeCursor":
        reverse = direction < 0
        return FakeCursor(sorted(self, key=lambda item: item.get(key) or datetime.min.replace(tzinfo=timezone.utc), reverse=reverse))

    def limit(self, count: int) -> "FakeCursor":
        return FakeCursor(self[:count])


class FakeCollection:
    def __init__(self, docs: list[dict[str, Any]] | None = None) -> None:
        self.docs = docs or []

    def _matches(self, doc: dict[str, Any], query: dict[str, Any]) -> bool:
        for key, expected in (query or {}).items():
            actual = doc.get(key)
            if isinstance(expected, dict):
                if "$ne" in expected and actual == expected["$ne"]:
                    return False
                if "$gt" in expected and not (actual is not None and actual > expected["$gt"]):
                    return False
                if "$exists" in expected and ((key in doc) != bool(expected["$exists"])):
                    return False
                if "$regex" in expected:
                    if str(expected["$regex"]).lower() not in str(actual or "").lower():
                        return False
                continue
            if key == "$or":
                if not any(self._matches(doc, option) for option in expected):
                    return False
                continue
            if actual != expected:
                return False
        return True

    def find(self, query: dict[str, Any] | None = None, *args: Any, **kwargs: Any) -> FakeCursor:
        return FakeCursor([dict(doc) for doc in self.docs if self._matches(doc, query or {})])

    def find_one(self, query: dict[str, Any] | None = None, *args: Any, **kwargs: Any) -> dict[str, Any] | None:
        for doc in self.docs:
            if self._matches(doc, query or {}):
                return doc
        return None

    def insert_one(self, document: dict[str, Any]) -> FakeInsertResult:
        inserted = dict(document)
        inserted.setdefault("_id", ObjectId())
        self.docs.append(inserted)
        return FakeInsertResult(inserted["_id"])

    def update_one(self, query: dict[str, Any], update: dict[str, Any], upsert: bool = False) -> FakeUpdateResult:
        found = self.find_one(query)
        if found is None and upsert:
            found = dict(query)
            found["_id"] = ObjectId()
            self.docs.append(found)
        if found is not None:
            found.update(update.get("$set", {}))
            return FakeUpdateResult(1)
        return FakeUpdateResult(0)

    def count_documents(self, query: dict[str, Any] | None = None) -> int:
        return len([doc for doc in self.docs if self._matches(doc, query or {})])


class FakeMongoDb(dict):
    def __getitem__(self, name: str) -> FakeCollection:
        if name not in self:
            self[name] = FakeCollection()
        return dict.__getitem__(self, name)

    def __getattr__(self, name: str) -> FakeCollection:
        return self[name]


@override_settings(ALLOWED_HOSTS=["testserver", "localhost", "127.0.0.1"])
class ApiEndpointTests(SimpleTestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.db = FakeMongoDb()
        self.db["trails"] = FakeCollection([
            {"_id": ObjectId(), "name": "User trail", "createdAt": datetime.now(timezone.utc)},
            {"_id": ObjectId(), "name": "Second trail", "createdAt": datetime.now(timezone.utc)},
        ])
        self.db["official_trails"] = FakeCollection([
            {"_id": ObjectId(), "name": "E3", "mapGeometry": {"type": "LineString", "coordinates": [[23.1, 42.1], [23.2, 42.2]]}},
        ])
        self.db["huts"] = FakeCollection([
            {"_id": ObjectId(), "name": "Mountain Hut"},
        ])
        self.db["pings"] = FakeCollection([
            {"_id": ObjectId(), "type": "mud", "resolved": False, "createdAt": datetime.now(timezone.utc)},
        ])
        self.db["photopings"] = FakeCollection([
            {"_id": ObjectId(), "type": "photo", "resolved": False, "createdAt": datetime.now(timezone.utc)},
        ])
        self.db["trashclusters"] = FakeCollection([
            {"_id": ObjectId(), "resolved": False, "createdAt": datetime.now(timezone.utc)},
        ])
        self.db["offline_downloads"] = FakeCollection()
        self.db["users"] = FakeCollection([{"_id": ObjectId(), "clerkId": "test-user", "badgeProgress": {"trailCompletions": 2, "createdTrails": 0, "campaignPoints": 0}}])
        self.patch_db = patch("api.views.get_mongo_db", return_value=self.db)
        self.patch_db.start()

    def tearDown(self) -> None:
        self.patch_db.stop()

    def auth_headers(self) -> dict[str, str]:
        return {"HTTP_X_USER_ID": "test-user"}

    def test_health_endpoint_reports_service_status(self) -> None:
        response = self.client.get("/api/healthz")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])

    def test_trails_endpoint_combines_user_and_official_trails(self) -> None:
        response = self.client.get("/api/trails")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 3)

    def test_huts_endpoint_returns_huts(self) -> None:
        response = self.client.get("/api/huts")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()[0]["name"], "Mountain Hut")

    def test_ping_create_stores_active_ping(self) -> None:
        payload = {"type": "mud", "coordinates": [23.3, 42.7], "description": "Wet path"}
        response = self.client.post("/api/pings", payload, content_type="application/json", **self.auth_headers())
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual(data["type"], "mud")
        self.assertEqual(data["coordinates"], [23.3, 42.7])

    def test_ping_vote_marks_duplicate_votes_once(self) -> None:
        ping_id = ObjectId()
        self.db["pings"].insert_one({"_id": ping_id, "type": "mud", "coordinates": [23.3, 42.7], "resolved": False, "stillThereVotes": [], "goneVotes": []})
        first = self.client.post(f"/api/pings/{ping_id}/vote", {"vote": "gone"}, content_type="application/json", **self.auth_headers())
        second = self.client.post(f"/api/pings/{ping_id}/vote", {"vote": "gone"}, content_type="application/json", **self.auth_headers())
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertTrue(first.json()["added"])
        self.assertFalse(second.json()["added"])
        self.assertEqual(self.db["pings"].find_one({"_id": ping_id})["goneVotes"], ["test-user"])

    def test_badge_trailer_complete_updates_user_progress(self) -> None:
        response = self.client.post("/api/badges/trailers/complete", {"amount": 1}, content_type="application/json", **self.auth_headers())
        self.assertEqual(response.status_code, 200)
        progress = response.json()["badgeProgress"]
        self.assertEqual(progress["trailCompletions"], 3)
        self.assertEqual(progress["awarded"]["trailers"], "Rookie")

    def test_badge_campaign_participate_requires_authenticated_user(self) -> None:
        response = self.client.post("/api/badges/campaign/participate", {"amount": 1}, content_type="application/json")
        self.assertEqual(response.status_code, 401)

    def test_offline_download_requires_authenticated_user(self) -> None:
        response = self.client.post("/api/offline-downloads", {}, content_type="application/json")
        self.assertEqual(response.status_code, 401)

    def test_offline_download_create_stores_device_manifest(self) -> None:
        payload = {
            "name": "Vitosha weekend pack",
            "deviceId": "phone-001",
            "resourceTypes": ["trails", "official_trails", "huts", "pings", "photo_pings", "clusters", "map_tiles"],
            "areaMode": "bbox",
            "bbox": [23.1, 42.4, 23.5, 42.8],
            "minZoom": 10,
            "maxZoom": 12,
        }
        response = self.client.post("/api/offline-downloads", payload, content_type="application/json", **self.auth_headers())
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual(data["deviceId"], "phone-001")
        self.assertEqual(data["resources"]["counts"]["trails"], 2)
        self.assertGreater(data["resources"]["tileEstimate"], 0)

    def test_offline_download_status_summarizes_packs_by_device(self) -> None:
        self.db["offline_downloads"].insert_one({
            "userId": "test-user",
            "name": "Existing pack",
            "deviceId": "phone-001",
            "status": "ready",
            "resourceTypes": ["trails"],
            "resources": {"counts": {"trails": 3}, "tileEstimate": 40},
            "createdAt": datetime.now(timezone.utc),
        })
        response = self.client.get("/api/offline-downloads/status", **self.auth_headers())
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["totals"]["trails"], 3)
        self.assertEqual(data["totals"]["map_tiles"], 40)
        self.assertEqual(data["devices"][0]["deviceId"], "phone-001")

    def test_offline_download_delete_marks_pack_deleted(self) -> None:
        pack_id = ObjectId()
        self.db["offline_downloads"].insert_one({
            "_id": pack_id,
            "userId": "test-user",
            "name": "Old pack",
            "deviceId": "phone-001",
            "status": "ready",
            "resources": {"counts": {}, "tileEstimate": 0},
        })
        response = self.client.delete(f"/api/offline-downloads/{pack_id}", **self.auth_headers())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.db["offline_downloads"].find_one({"_id": pack_id})["status"], "deleted")

    def test_offline_download_rejects_invalid_bbox(self) -> None:
        payload = {"deviceId": "phone-001", "areaMode": "bbox", "bbox": [23.1, 42.4], "minZoom": 10, "maxZoom": 12}
        response = self.client.post("/api/offline-downloads", payload, content_type="application/json", **self.auth_headers())
        self.assertEqual(response.status_code, 400)
        self.assertIn("details", response.json())


if __name__ == "__main__":
    unittest.main()






