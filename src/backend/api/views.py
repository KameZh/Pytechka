from django.shortcuts import render

# Create your views here.
import re
from datetime import datetime, timezone
from typing import Any

from rest_framework.decorators import api_view
from rest_framework.response import Response

from .mongo import COLLECTIONS, get_mongo_db
from .mongo_helpers import make_object_id
from .serializers import serialize_mongo_list, serialize_mongo_document
from .services.badges import build_badge_update_document, increment_badge_progress, normalize_badge_progress
from .services.offline import OfflineArea, estimate_tile_count, normalize_resource_types, summarize_packs
from .services.pings import add_unique_vote, ping_expiration
from .validators import validate_offline_download_payload

@api_view(["GET"])
def healthz(request):
    return Response({
        "ok": True,
        "service": "pytechka",
    })

@api_view(["GET"])
def huts_list(request):
    
    db = get_mongo_db()

    huts = list(
        db.huts.find({}).sort("name", 1)
    )

    return Response(serialize_mongo_list(huts))


@api_view(["GET"])
def user_profile(request):
    db = get_mongo_db()
    created_trails_count = db["trails"].count_documents({})

    return Response(
        {
            "username": "",
            "email": "",
            "avatarUrl": "",
            "badgeProgress": {
                "trailCompletions": 0,
                "createdTrails": created_trails_count,
                "campaignPoints": 0,
            },
        }
    )


def parse_bbox(request):
    
    try:
        min_lng = float(request.query_params.get("minLng"))
        min_lat = float(request.query_params.get("minLat"))
        max_lng = float(request.query_params.get("maxLng"))
        max_lat = float(request.query_params.get("maxLat"))

    except (TypeError, ValueError):
        return None
    
    return {
        "coordinates.0": {
            "$gte": min_lng,
            "$lte": max_lng
        },
        "coordinates.1": {
            "$gte": min_lat,
            "$lte": max_lat
        }
    }

def apply_common_point_filters(request, base_filter=None):
    
    query = dict(base_filter or {})

    bbox_filter = parse_bbox(request)
    if bbox_filter:
        query.update(bbox_filter)

    trail_id = request.query_params.get("trailId")
    if trail_id:
        query["trailId"] = trail_id

    return query


def active_ping_filter():
    
    now = datetime.now(timezone.utc)

    return {
        "resolved": {"$ne": True},
        "$or": [
            {"expiresAt": None},
            {"expiresAt": {"$gt": now}},
            {"expiresAt": {"$exists": False}},
        ],
    }

from bson import ObjectId
from rest_framework import status


def build_trail_search_filter(search_text):
    
    if not search_text:
        return {}
    
    safe_search = re.escape(search_text)
    
    return {
        "$or": [
            {"name": {"$regex": safe_search, "$options": "i"}},
            {"name_bg": {"$regex": safe_search, "$options": "i"}},
            {"name_en": {"$regex": safe_search, "$options": "i"}},
            {"region": {"$regex": safe_search, "$options": "i"}},
            {"description": {"$regex": safe_search, "$options": "i"}},
            {"ref": {"$regex": safe_search, "$options": "i"}},
        ]
    }


def normalize_trail_document(trail):
    if not trail:
        return trail
    
    trail.setdefault("stats", {})
    trail.setdefault("trailMarks", [])
    trail.setdefault("source", "user")

    return trail

@api_view(["GET"])
def trails_list(request):

    db = get_mongo_db()

    search = request.query_params.get("search", "").strip()
    official_only = request.query_params.get("officialOnly") == "true"
    include_geometry = request.query_params.get("includeGeometry") == "true"

    limit_param = request.query_params.get("limit")

    try:
        limit = int(limit_param) if limit_param else None
    except ValueError:
        limit = None

    if limit is not None:
      limit = max(1, min(limit, 5000))

    search_filter = build_trail_search_filter(search)

    user_trails = []
    if not official_only:
        user_trails = list(
            db["trails"].find(search_filter).sort("createdAt", 1)
        )

        if limit is not None:
            user_trails = user_trails[:limit]

    official_trails = list(
        db["official_trails"].find(search_filter).sort("createdAt", 1)
    )
    if limit is not None:
        official_trails = official_trails[:limit]

    trails = [normalize_trail_document(t) for t in user_trails + official_trails]

    if not include_geometry:
        for trail in trails:
            trail.pop("geojson", None)
            trail.pop("geom", None)

    return Response(serialize_mongo_list(trails))


@api_view(["GET"])
def my_trails(request):
    db = get_mongo_db()

    trails = list(db["trails"].find({}).sort("createdAt", -1))

    return Response(serialize_mongo_list([normalize_trail_document(trail) for trail in trails]))


def get_trail_geometry(trail):
    geometry = trail.get("mapGeometry") or trail.get("geojson") or trail.get("geom")

    if not geometry:
        return None

    if geometry.get("type") == "Feature":
        return geometry.get("geometry")
    
    return geometry


def iter_line_geometries(geometry):
    if not isinstance(geometry, dict):
        return

    geometry_type = geometry.get("type")

    if geometry_type in {"LineString", "MultiLineString"}:
        yield geometry
        return

    if geometry_type == "Feature":
        yield from iter_line_geometries(geometry.get("geometry"))
        return

    if geometry_type == "FeatureCollection":
        for feature in geometry.get("features", []) or []:
            yield from iter_line_geometries(feature)

@api_view(["GET"])
def trails_geojson(request):
    
    db = get_mongo_db()

    user_trails = list(
        db.trails.find(
            {},
            {
                "name": 1,
                "difficulty": 1,
                "source": 1,
                "mapGeometry": 1,
                "geojson": 1,
                "stats": 1,
                "trailMarks": 1,
                "colour_type": 1,
                "osm_colour": 1,
                "ref": 1,
            },
        )
    )

    official_trails = list(
        db["official_trails"].find(
            {"mapGeometry": {"$ne": None}},
            {
                "name": 1,
                "name_bg": 1,
                "name_en": 1,
                "difficulty": 1,
                "source": 1,
                "mapGeometry": 1,
                "geojson": 1,
                "stats": 1,
                "trailMarks": 1,
                "colour_type": 1,
                "osm_colour": 1,
                "ref": 1,
            }
        )
    )

    features = []

    for trail in user_trails + official_trails:
        geometry = get_trail_geometry(trail)

        if not geometry:
            continue

        for line_geometry in iter_line_geometries(geometry):
            features.append({
                "type": "Feature",
                "properties": {
                    "id": str(trail.get("_id")),
                    "name": trail.get("name"),
                    "difficulty": trail.get("difficulty", "moderate"),
                    "source": trail.get("source", "user"),
                    "ref": trail.get("ref", ""),
                    "colour_type": trail.get("colour_type", "unmarked"),
                    "osm_colour": trail.get("osm_colour", ""),
                    "stats": trail.get("stats", {}),
                    "trailMarks": trail.get("trailMarks", []),
                },
                "geometry": line_geometry,
            })

    return Response({
        "type": "FeatureCollection",
        "features": serialize_mongo_list(features),
    })
    
@api_view(["GET"])
def trail_detail(request, trail_id):
    
    db = get_mongo_db()
    object_id = make_object_id(trail_id)

    if object_id is None:
        return Response({"error": "Invalid trail ID"}, status=status.HTTP_400_BAD_REQUEST)
    
    trail = db.trails.find_one({"_id": object_id})

    if trail is None:
        trail = db["official_trails"].find_one({"_id": object_id})
    
    if trail is None:
        return Response({"error": "Trail not found"}, status=status.HTTP_404_NOT_FOUND)
    
    return Response(serialize_mongo_document(normalize_trail_document(trail)))


@api_view(["GET", "POST"])
def pings_list(request):
    db = get_mongo_db()

    if request.method == "GET":
        query = apply_common_point_filters(request, active_ping_filter())
        pings = list(db.pings.find(query).sort("createdAt", -1).limit(1000))
        return Response(serialize_mongo_list(pings))

    user_id = get_request_user_id(request)
    if not user_id:
        return Response({"error": "Authentication required"}, status=401)

    coordinates = request.data.get("coordinates")
    if not isinstance(coordinates, list) or len(coordinates) != 2:
        return Response({"error": "coordinates must be [lng, lat]"}, status=400)

    try:
        coordinates = [float(coordinates[0]), float(coordinates[1])]
    except (TypeError, ValueError):
        return Response({"error": "coordinates must be numeric"}, status=400)

    ping_type = str(request.data.get("type") or "junk").strip() or "junk"
    now = datetime.now(timezone.utc)
    document = {
        "type": ping_type,
        "coordinates": coordinates,
        "description": str(request.data.get("description") or "").strip(),
        "userId": user_id,
        "resolved": False,
        "stillThereVotes": [],
        "goneVotes": [],
        "expiresAt": ping_expiration(ping_type),
        "createdAt": now,
        "updatedAt": now,
    }
    result = db[COLLECTIONS.pings].insert_one(document)
    document["_id"] = result.inserted_id
    return Response(serialize_mongo_document(document), status=201)
@api_view(["GET"])
def photo_pings_list(request):
    
    db = get_mongo_db()

    query = apply_common_point_filters(request, active_ping_filter())

    photo_pings = list(
        db.photopings.find(query).sort("createdAt", -1).limit(1000)
    )

    return Response(serialize_mongo_list(photo_pings))


@api_view(["GET"])
def clusters_list(request):
    
    db = get_mongo_db()

    query = apply_common_point_filters(request, {"resolved": {"$ne": True}})

    clusters = list (
        db.trashclusters.find(query).sort("createdAt", -1).limit(1000)
    )

    return Response(serialize_mongo_list(clusters))


def get_request_user_id(request) -> str | None:

    return (
        request.headers.get("X-User-Id")
        or request.headers.get("X-Clerk-User-Id")
        or request.META.get("HTTP_X_USER_ID")
        or request.META.get("HTTP_X_CLERK_USER_ID")
    )


def count_offline_resources(resource_types: list[str]) -> dict[str, int]:

    db = get_mongo_db()
    counts: dict[str, int] = {}
    if "trails" in resource_types:
        counts["trails"] = db[COLLECTIONS.trails].count_documents({})
    if "official_trails" in resource_types:
        counts["official_trails"] = db[COLLECTIONS.official_trails].count_documents({})
    if "huts" in resource_types:
        counts["huts"] = db[COLLECTIONS.huts].count_documents({})
    if "pings" in resource_types:
        counts["pings"] = db[COLLECTIONS.pings].count_documents({"resolved": {"$ne": True}})
    if "photo_pings" in resource_types:
        counts["photo_pings"] = db[COLLECTIONS.photo_pings].count_documents({"resolved": {"$ne": True}})
    if "clusters" in resource_types:
        counts["clusters"] = db[COLLECTIONS.trash_clusters].count_documents({"resolved": {"$ne": True}})
    return counts


def build_offline_area(area_payload: dict[str, Any]) -> OfflineArea:

    mode = str(area_payload.get("mode") or "bbox")
    if mode == "radius":
        return OfflineArea(mode="radius", center=area_payload.get("center"), radius_km=float(area_payload.get("radiusKm") or 0))
    return OfflineArea(mode="bbox", bbox=area_payload.get("bbox"))


@api_view(["GET", "POST"])
def offline_downloads(request):

    user_id = get_request_user_id(request)
    if not user_id:
        return Response({"error": "Authentication required"}, status=401)

    db = get_mongo_db()
    collection = db[COLLECTIONS.offline_downloads]

    if request.method == "GET":
        query: dict[str, Any] = {"userId": user_id, "status": {"$ne": "deleted"}}
        device_id = str(request.query_params.get("deviceId") or "").strip()
        if device_id:
            query["deviceId"] = device_id
        packs = list(collection.find(query).sort("createdAt", -1))
        return Response({"packs": serialize_mongo_list(packs), "summary": summarize_packs(packs)})

    validation = validate_offline_download_payload(request.data if isinstance(request.data, dict) else {})
    if not validation.ok:
        return Response({"error": "Invalid offline download request", "details": validation.errors}, status=400)

    payload = validation.data
    resource_types = normalize_resource_types(payload.get("resourceTypes"))
    area = build_offline_area(payload["area"])
    tile_estimate = estimate_tile_count(area, int(payload["minZoom"]), int(payload["maxZoom"])) if "map_tiles" in resource_types else 0
    now = datetime.now(timezone.utc)
    document = {
        "userId": user_id,
        "name": payload["name"],
        "deviceId": payload["deviceId"],
        "resourceTypes": resource_types,
        "area": payload["area"],
        "minZoom": payload["minZoom"],
        "maxZoom": payload["maxZoom"],
        "status": "ready",
        "resources": {"counts": count_offline_resources(resource_types), "tileEstimate": tile_estimate},
        "createdAt": now,
        "updatedAt": now,
    }
    result = collection.insert_one(document)
    document["_id"] = result.inserted_id
    return Response(serialize_mongo_document(document), status=201)


@api_view(["GET"])
def offline_download_status(request):

    user_id = get_request_user_id(request)
    if not user_id:
        return Response({"error": "Authentication required"}, status=401)

    query: dict[str, Any] = {"userId": user_id, "status": {"$ne": "deleted"}}
    device_id = str(request.query_params.get("deviceId") or "").strip()
    if device_id:
        query["deviceId"] = device_id
    packs = list(get_mongo_db()[COLLECTIONS.offline_downloads].find(query).sort("createdAt", -1))
    return Response(summarize_packs(packs))


@api_view(["GET", "DELETE"])
def offline_download_detail(request, download_id):

    user_id = get_request_user_id(request)
    if not user_id:
        return Response({"error": "Authentication required"}, status=401)

    object_id = make_object_id(download_id)
    if object_id is None:
        return Response({"error": "Invalid offline download id"}, status=400)

    collection = get_mongo_db()[COLLECTIONS.offline_downloads]
    pack = collection.find_one({"_id": object_id, "userId": user_id})
    if not pack or pack.get("status") == "deleted":
        return Response({"error": "Offline download not found"}, status=404)

    if request.method == "GET":
        return Response(serialize_mongo_document(pack))

    collection.update_one({"_id": object_id}, {"$set": {"status": "deleted", "updatedAt": datetime.now(timezone.utc)}})
    return Response({"success": True, "deletedId": str(object_id)})



def parse_positive_amount(value, default: int = 1) -> int:

    try:
        amount = int(value)
    except (TypeError, ValueError):
        amount = default
    return max(1, min(amount, 100))


def update_badge_progress(user_id: str, increments: dict[str, int]) -> dict[str, Any]:

    users = get_mongo_db()[COLLECTIONS.users]
    user = users.find_one({"clerkId": user_id}) or {"clerkId": user_id, "badgeProgress": {}}
    progress = increment_badge_progress(user.get("badgeProgress"), increments)
    update_document = build_badge_update_document(progress)

    if user.get("_id"):
        users.update_one({"_id": user["_id"]}, {"$set": update_document})
        user.update(update_document)
        return user

    user.update(update_document)
    result = users.insert_one(user)
    user["_id"] = result.inserted_id
    return user


@api_view(["POST"])
def badge_trailer_complete(request):

    user_id = get_request_user_id(request)
    if not user_id:
        return Response({"error": "Authentication required"}, status=401)

    amount = parse_positive_amount(request.data.get("amount"), 1)
    updated = update_badge_progress(user_id, {"trailCompletions": amount})
    return Response({"badgeProgress": normalize_badge_progress(updated.get("badgeProgress"))})


@api_view(["POST"])
def badge_campaign_participate(request):

    user_id = get_request_user_id(request)
    if not user_id:
        return Response({"error": "Authentication required"}, status=401)

    amount = parse_positive_amount(request.data.get("amount"), 1)
    updated = update_badge_progress(user_id, {"campaignPoints": amount})
    return Response({"badgeProgress": normalize_badge_progress(updated.get("badgeProgress"))})



@api_view(["POST"])
def ping_vote(request, ping_id):

    object_id = make_object_id(ping_id)
    if object_id is None:
        return Response({"error": "Invalid ping id"}, status=400)

    user_id = get_request_user_id(request)
    if not user_id:
        return Response({"error": "Authentication required"}, status=401)

    db = get_mongo_db()
    ping = db[COLLECTIONS.pings].find_one({"_id": object_id})
    if not ping:
        return Response({"error": "Ping not found"}, status=404)

    vote_type = str(request.data.get("vote") or request.data.get("voteType") or "still_there")
    update: dict[str, Any] = {"updatedAt": datetime.now(timezone.utc)}
    if vote_type in {"gone", "not_there", "resolved"}:
        votes, added = add_unique_vote(ping.get("goneVotes") or [], user_id)
        update["goneVotes"] = votes
        if len(votes) >= 3:
            update["resolved"] = True
    else:
        votes, added = add_unique_vote(ping.get("stillThereVotes") or [], user_id)
        update["stillThereVotes"] = votes

    db[COLLECTIONS.pings].update_one({"_id": object_id}, {"$set": update})
    ping.update(update)
    return Response({"success": True, "added": added, "ping": serialize_mongo_document(ping)})


