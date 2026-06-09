from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any

from bson import ObjectId
from rest_framework.decorators import api_view
from rest_framework.request import Request
from rest_framework.response import Response

from .analysis import analyze_route_locally
from .auth import ensure_user_document, get_request_user_id
from .cache import cached_response, invalidate_api_cache
from .geometry import (
    calculate_enriched_stats, derive_trail_point_labels, derive_trail_start_end_center,
    extract_line_geometries, haversine_meters, infer_colour_type,
    infer_difficulty_from_stats, normalize_condition_payload,
    normalize_photo_ping_payload, normalize_string, normalize_trail_marks,
    simplify_map_geometry,
)
from .mongo import COLLECTIONS, get_mongo_db, is_database_ready
from .mongo_helpers import make_object_id
from .serializers import serialize_mongo_document, serialize_mongo_list
from .trail_enrichment import is_featured_official_trail
from .services.offline import OfflineArea, build_pack_summary, estimate_tile_count, normalize_resource_types, summarize_packs
from .services.pings import add_unique_vote
from .validators import list_errors, validate_offline_download_payload

MAP_CACHE_SECONDS = 600
LIVE_CACHE_SECONDS = 45
PING_EXPIRATION_SECONDS = {"junk": None, "mud": 86400, "environmental_danger": 604800, "photo": None}
BADGE_TIERS = {
    "trailers": [(20, "Senior"), (10, "Junior"), (3, "Rookie")],
    "contribution": [(20, "Country guide"), (10, "Local guide"), (3, "New guide")],
    "campaign": [(20, "Basically organizer"), (10, "Helper"), (3, "Volunteer")],
}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def pick_tier(category: str, value: int) -> str | None:
    for minimum, name in BADGE_TIERS.get(category, []):
        if value >= minimum:
            return name
    return None


def update_badge_progress(user_id: str, increments: dict[str, int]) -> dict[str, Any] | None:
    db = get_mongo_db()
    users = db[COLLECTIONS.users]
    user = users.find_one({"clerkId": user_id})
    if not user:
        return None
    progress = user.get("badgeProgress") or {}
    progress["trailCompletions"] = int(progress.get("trailCompletions") or 0) + int(increments.get("trailCompletions") or 0)
    progress["createdTrails"] = int(progress.get("createdTrails") or 0) + int(increments.get("createdTrails") or 0)
    progress["campaignPoints"] = int(progress.get("campaignPoints") or 0) + int(increments.get("campaignPoints") or 0)
    progress["awarded"] = {
        "trailers": pick_tier("trailers", progress["trailCompletions"]),
        "contribution": pick_tier("contribution", progress["createdTrails"]),
        "campaign": pick_tier("campaign", progress["campaignPoints"]),
    }
    users.update_one({"_id": user["_id"]}, {"$set": {"badgeProgress": progress, "updatedAt": now_utc()}})
    user["badgeProgress"] = progress
    return user


def build_trail_search_filter(search: str | None) -> list[dict[str, Any]] | None:
    if not search:
        return None
    safe = re.escape(search)
    return [
        {"name": {"$regex": safe, "$options": "i"}}, {"name_bg": {"$regex": safe, "$options": "i"}},
        {"name_en": {"$regex": safe, "$options": "i"}}, {"ref": {"$regex": safe, "$options": "i"}},
        {"region": {"$regex": safe, "$options": "i"}}, {"description": {"$regex": safe, "$options": "i"}},
    ]


def normalize_trail_document(trail: dict[str, Any]) -> dict[str, Any]:
    result = dict(trail or {})
    derived = derive_trail_start_end_center(result.get("geojson"))
    if not isinstance(result.get("startCoordinates"), list) or len(result.get("startCoordinates") or []) != 2:
        result["startCoordinates"] = derived["startCoordinates"]
    if not isinstance(result.get("endCoordinates"), list) or len(result.get("endCoordinates") or []) != 2:
        result["endCoordinates"] = derived["endCoordinates"]
    result["stats"] = result.get("stats") or {}
    if not isinstance(result["stats"].get("centerCoordinates"), list):
        result["stats"]["centerCoordinates"] = derived["centerCoordinates"]
    result["source"] = normalize_string(result.get("source")) or "user"
    result["averageAccuracy"] = float(result.get("averageAccuracy") or 0)
    return result


def trail_by_id(trail_id: str, projection: dict[str, int] | None = None) -> tuple[dict[str, Any] | None, str | None]:
    object_id = make_object_id(trail_id)
    if object_id is None:
        return None, None
    db = get_mongo_db()
    trail = db[COLLECTIONS.trails].find_one({"_id": object_id}, projection)
    if trail:
        return trail, COLLECTIONS.trails
    trail = db[COLLECTIONS.official_trails].find_one({"_id": object_id}, projection)
    if trail:
        return trail, COLLECTIONS.official_trails
    return None, None


def recalc_average_accuracy(reviews: list[dict[str, Any]]) -> float:
    values = [float(review.get("accuracy") or 0) for review in reviews if review.get("accuracy")]
    return round(sum(values) / len(values), 1) if values else 0.0


def active_ping_query() -> dict[str, Any]:
    return {"resolved": {"$ne": True}, "$or": [{"expiresAt": None}, {"expiresAt": {"$gt": now_utc()}}, {"expiresAt": {"$exists": False}}]}


def apply_point_filters(request: Request, base_filter: dict[str, Any]) -> dict[str, Any]:
    query = dict(base_filter)
    trail_id = request.query_params.get("trailId")
    if trail_id:
        query["trailId"] = trail_id
    return query


def ping_expiration(ping_type: str) -> datetime | None:
    seconds = PING_EXPIRATION_SECONDS.get(ping_type)
    return now_utc() + timedelta(seconds=seconds) if seconds else None


def attach_cluster_voter_profiles(clusters: list[dict[str, Any]] | dict[str, Any] | None) -> list[dict[str, Any]] | dict[str, Any] | None:
    cluster_list = clusters if isinstance(clusters, list) else [clusters] if clusters else []
    if not cluster_list:
        return [] if isinstance(clusters, list) else None
    db = get_mongo_db()
    voter_ids = sorted({str(vote) for cluster in cluster_list for vote in cluster.get("goneVotes", [])})
    users = list(db[COLLECTIONS.users].find({"clerkId": {"$in": voter_ids}}, {"clerkId": 1, "username": 1, "email": 1})) if voter_ids else []
    by_id = {str(user.get("clerkId")): user for user in users}
    for cluster in cluster_list:
        cluster["voterProfiles"] = []
        for user_id in [str(vote) for vote in cluster.get("goneVotes", [])]:
            user = by_id.get(user_id) or {}
            email_prefix = str(user.get("email") or "").split("@")[0]
            cluster["voterProfiles"].append({"userId": user_id, "name": user.get("username") or email_prefix or f"User {user_id[:6]}"})
    return cluster_list if isinstance(clusters, list) else cluster_list[0]


@api_view(["GET"])
def healthz(request: Request) -> Response:
    return Response({"ok": True, "status": "ok", "service": "pytechka-django"})


@api_view(["GET"])
def readyz(request: Request) -> Response:
    ready = is_database_ready()
    return Response({"status": "ready" if ready else "not_ready", "database": "connected" if ready else "disconnected"}, status=200 if ready else 503)


@api_view(["GET"])
def user_profile(request: Request) -> Response:
    _user_id, user, auth_error = ensure_user_document(request)
    if auth_error:
        return Response({"username": "", "email": "", "avatarUrl": "", "badgeProgress": {"trailCompletions": 0, "createdTrails": 0, "campaignPoints": 0, "awarded": {}}})
    return Response(serialize_mongo_document(user))

@api_view(["POST"])
def badge_trailer_complete(request: Request) -> Response:
    user_id, _user, auth_error = ensure_user_document(request)
    if auth_error:
        return auth_error
    updated = update_badge_progress(user_id or "", {"trailCompletions": int(request.data.get("amount") or 1)})
    return Response({"badgeProgress": (updated or {}).get("badgeProgress")})


@api_view(["POST"])
def badge_campaign_participate(request: Request) -> Response:
    user_id, _user, auth_error = ensure_user_document(request)
    if auth_error:
        return auth_error
    updated = update_badge_progress(user_id or "", {"campaignPoints": int(request.data.get("amount") or 1)})
    return Response({"badgeProgress": (updated or {}).get("badgeProgress")})


@api_view(["POST"])
def trail_telemetry(request: Request) -> Response:
    geojson = request.data.get("geojson")
    if not geojson:
        return Response({"error": "geojson is required"}, status=400)
    stats = calculate_enriched_stats(geojson, request.data.get("stats") or {})
    highest = f"{round(float(stats['highestPoint']))} m" if stats.get("highestPoint") is not None else ""
    return Response({"stats": stats, "highestPoint": highest, "difficulty": infer_difficulty_from_stats(stats)})


@api_view(["GET", "POST"])
def trails_list(request: Request) -> Response:
    if request.method == "POST":
        return create_trail(request)

    def load() -> list[dict[str, Any]]:
        db = get_mongo_db()
        search = normalize_string(request.query_params.get("search"))
        official_only = str(request.query_params.get("officialOnly") or "").lower() == "true"
        unmarked_only = str(request.query_params.get("unmarkedOnly") or "").lower() == "true"
        compact = str(request.query_params.get("compact") or "").lower() == "true" or str(request.query_params.get("includeGeometry") or "").lower() == "false"
        difficulty = request.query_params.get("difficulty")
        sort = request.query_params.get("sort")
        user_filter: dict[str, Any] = {}
        official_filter: dict[str, Any] = {}
        if difficulty and difficulty != "all":
            user_filter["difficulty"] = difficulty
            official_filter["difficulty"] = difficulty
        if unmarked_only:
            user_filter["colour_type"] = "unmarked"
            official_filter["colour_type"] = "unmarked"
        search_filter = build_trail_search_filter(search)
        if search_filter:
            user_filter["$or"] = search_filter
            official_filter["$or"] = search_filter
        projection = {"reviews": 0}
        if compact:
            projection.update({"geojson": 0, "geom": 0, "mapGeometry": 0})
        user_trails = [] if official_only else list(db[COLLECTIONS.trails].find(user_filter, projection))
        official_projection = {key: value for key, value in projection.items() if key != "reviews"}
        official_trails = list(db[COLLECTIONS.official_trails].find(official_filter, official_projection))
        trails = [normalize_trail_document(trail) for trail in user_trails + official_trails]
        if sort == "popular":
            trails.sort(key=lambda trail: float(trail.get("averageAccuracy") or 0), reverse=True)
        else:
            trails.sort(key=lambda trail: trail.get("createdAt") or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        center_lng = request.query_params.get("centerLng")
        center_lat = request.query_params.get("centerLat")
        radius_km = request.query_params.get("radiusKm")
        if center_lng and center_lat and radius_km:
            center = [float(center_lng), float(center_lat)]
            radius_m = min(max(float(radius_km), 0.1), 100) * 1000
            mode = str(request.query_params.get("proximityMode") or "start")
            filtered: list[dict[str, Any]] = []
            for trail in trails:
                anchor = (trail.get("stats") or {}).get("centerCoordinates") if mode == "center" else trail.get("startCoordinates")
                if isinstance(anchor, list) and len(anchor) == 2 and haversine_meters(center, anchor) <= radius_m:
                    filtered.append(trail)
            trails = filtered
        return serialize_mongo_list(trails)

    return cached_response(request, MAP_CACHE_SECONDS, ["trails"], load)


def create_trail(request: Request) -> Response:
    user_id, user, auth_error = ensure_user_document(request)
    if auth_error:
        return auth_error
    body = request.data if isinstance(request.data, dict) else {}
    geojson = body.get("geojson")
    name = normalize_string(body.get("name"))
    if not geojson:
        return Response({"error": "geojson is required"}, status=400)
    if not name:
        return Response({"error": "name is required"}, status=400)
    stats = calculate_enriched_stats(geojson, body.get("stats") or {})
    derived = derive_trail_start_end_center(geojson)
    labels = derive_trail_point_labels(geojson)
    document: dict[str, Any] = {
        "source": "user", "userId": user_id, "username": (user or {}).get("username", ""),
        "name": name, "region": normalize_string(body.get("region")),
        "difficulty": normalize_string(body.get("difficulty")) or infer_difficulty_from_stats(stats),
        "description": normalize_string(body.get("description")),
        "equipment": normalize_string(body.get("equipment")), "resources": normalize_string(body.get("resources")),
        **labels,
        "highestPoint": labels.get("highestPoint") or (f"{round(float(stats['highestPoint']))} m" if stats.get("highestPoint") is not None else ""),
        "startCoordinates": stats.get("startCoordinates") or derived.get("startCoordinates"),
        "endCoordinates": stats.get("endCoordinates") or derived.get("endCoordinates"),
        "geojson": geojson, "mapGeometry": simplify_map_geometry(geojson), "stats": stats,
        "trailMarks": normalize_trail_marks(body.get("trailMarks"), geojson),
        "reviews": [], "conditionReports": [], "averageAccuracy": 0,
        "createdAt": now_utc(), "updatedAt": now_utc(),
    }
    analysis = analyze_route_locally(document)
    document["ai"] = {"status": "done", **analysis}
    result = get_mongo_db()[COLLECTIONS.trails].insert_one(document)
    document["_id"] = result.inserted_id
    update_badge_progress(user_id or "", {"createdTrails": 1})
    invalidate_api_cache(["trails"])
    return Response(serialize_mongo_document(document), status=201)


@api_view(["GET"])
def my_trails(request: Request) -> Response:
    user_id = get_request_user_id(request)
    if not user_id:
        return Response([], status=200)
    trails = list(get_mongo_db()[COLLECTIONS.trails].find({"userId": user_id}, {"reviews": 0}).sort("createdAt", -1))
    return Response(serialize_mongo_list([normalize_trail_document(trail) for trail in trails]))


@api_view(["GET"])
def trails_geojson(request: Request) -> Response:
    def load() -> dict[str, Any]:
        db = get_mongo_db()
        fields = {"name": 1, "name_bg": 1, "name_en": 1, "ref": 1, "source": 1, "difficulty": 1, "osm_colour": 1, "osm_marking": 1, "colour_type": 1, "network": 1, "stats": 1, "geojson": 1, "geom": 1, "mapGeometry": 1}
        trails = list(db[COLLECTIONS.trails].find({}, fields)) + list(db[COLLECTIONS.official_trails].find({"mapGeometry": {"$ne": None}}, fields))
        features: list[dict[str, Any]] = []
        for trail in trails:
            candidates = [trail["mapGeometry"]] if isinstance(trail.get("mapGeometry"), dict) else extract_line_geometries(trail.get("geojson"))
            source = normalize_string(trail.get("source")) or "user"
            if source != "user" and is_featured_official_trail(trail):
                source = "osm_featured"
            for geometry in candidates:
                features.append({"type": "Feature", "geometry": geometry, "properties": {
                    "id": str(trail.get("_id")),
                    "name": normalize_string(trail.get("name")) or normalize_string(trail.get("name_bg")) or normalize_string(trail.get("name_en")) or normalize_string(trail.get("ref")) or "Unnamed trail",
                    "name_bg": normalize_string(trail.get("name_bg")), "name_en": normalize_string(trail.get("name_en")), "ref": normalize_string(trail.get("ref")),
                    "source": source, "difficulty": normalize_string(trail.get("difficulty")) or "moderate",
                    "colour_type": infer_colour_type(trail.get("colour_type"), trail.get("osm_colour"), trail.get("osm_marking")),
                    "osm_colour": normalize_string(trail.get("osm_colour")), "osm_marking": normalize_string(trail.get("osm_marking")), "network": normalize_string(trail.get("network")),
                    "distance": round(float((trail.get("stats") or {}).get("distance") or 0) / 1000, 2),
                    "elevation_gain": float((trail.get("stats") or {}).get("elevationGain") or 0),
                }})
        return {"type": "FeatureCollection", "features": features}
    return cached_response(request, MAP_CACHE_SECONDS, ["trails"], load)

@api_view(["GET", "PUT", "DELETE"])
def trail_detail(request: Request, trail_id: str) -> Response:
    trail, collection = trail_by_id(trail_id)
    if not trail:
        return Response({"error": "Trail not found"}, status=404)
    if request.method == "GET":
        return Response(serialize_mongo_document(normalize_trail_document(trail)))
    if collection != COLLECTIONS.trails:
        return Response({"error": "Official trails cannot be edited here"}, status=403)
    user_id = get_request_user_id(request)
    if not user_id or trail.get("userId") != user_id:
        return Response({"error": "Not authorized"}, status=403)
    if request.method == "DELETE":
        get_mongo_db()[COLLECTIONS.trails].delete_one({"_id": trail["_id"]})
        invalidate_api_cache(["trails"])
        return Response({"success": True})
    updates: dict[str, Any] = {}
    for key in ["name", "region", "difficulty", "description", "equipment", "resources"]:
        if key in request.data:
            updates[key] = request.data[key]
    if "trailMarks" in request.data:
        updates["trailMarks"] = normalize_trail_marks(request.data.get("trailMarks"), trail.get("geojson"))
    updates["updatedAt"] = now_utc()
    get_mongo_db()[COLLECTIONS.trails].update_one({"_id": trail["_id"]}, {"$set": updates})
    invalidate_api_cache(["trails"])
    trail.update(updates)
    return Response(serialize_mongo_document(trail))


@api_view(["GET"])
def trail_start_readiness(request: Request, trail_id: str) -> Response:
    trail, _collection = trail_by_id(trail_id, {"name": 1, "startCoordinates": 1, "geojson": 1, "stats": 1, "ai": 1, "difficulty": 1, "region": 1})
    if not trail:
        return Response({"error": "Trail not found"}, status=404)
    derived = derive_trail_start_end_center(trail.get("geojson"))
    start = trail.get("startCoordinates") if isinstance(trail.get("startCoordinates"), list) else derived.get("startCoordinates")
    if not isinstance(start, list) or len(start) != 2:
        return Response({"error": "Trail has no valid start coordinates"}, status=400)
    user_lng = request.query_params.get("userLng")
    user_lat = request.query_params.get("userLat")
    has_user_location = user_lng is not None and user_lat is not None
    max_distance = float(request.query_params.get("maxDistanceMeters") or 1000)
    distance = round(haversine_meters([float(user_lng), float(user_lat)], start)) if has_user_location else None
    return Response({"trailId": str(trail.get("_id")), "trailName": trail.get("name"), "startCoordinates": start, "maxDistanceMeters": max_distance, "hasUserLocation": has_user_location, "distanceToStartMeters": distance, "withinRange": distance is not None and distance <= max_distance, "ai": trail.get("ai"), "difficulty": trail.get("difficulty"), "region": trail.get("region"), "centerCoordinates": (trail.get("stats") or {}).get("centerCoordinates") or derived.get("centerCoordinates")})


@api_view(["GET", "POST"])
def trail_conditions(request: Request, trail_id: str) -> Response:
    trail, collection = trail_by_id(trail_id)
    if not trail:
        return Response({"error": "Trail not found"}, status=404)
    if request.method == "GET":
        reports = sorted(trail.get("conditionReports") or [], key=lambda entry: entry.get("createdAt") or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        return Response({"reports": serialize_mongo_list(reports)})
    user_id, user, auth_error = ensure_user_document(request)
    if auth_error:
        return auth_error
    report = {"_id": ObjectId(), "userId": user_id, "username": (user or {}).get("username", "Anonymous"), **normalize_condition_payload(request.data), "createdAt": now_utc(), "updatedAt": now_utc()}
    reports = list(trail.get("conditionReports") or []) + [report]
    if len(reports) > 80:
        reports = reports[-80:]
    get_mongo_db()[collection or COLLECTIONS.trails].update_one({"_id": trail["_id"]}, {"$set": {"conditionReports": reports, "updatedAt": now_utc()}})
    invalidate_api_cache(["trails"])
    return Response(serialize_mongo_document(report), status=201)


@api_view(["POST"])
def trail_complete(request: Request, trail_id: str) -> Response:
    user_id, user, auth_error = ensure_user_document(request)
    if auth_error:
        return auth_error
    trail, collection = trail_by_id(trail_id)
    if not trail:
        return Response({"error": "Trail not found"}, status=404)
    if collection == COLLECTIONS.official_trails:
        update_badge_progress(user_id or "", {"trailCompletions": 1})
        return Response({"success": True, "reviewAdded": False, "alreadyReviewed": False, "averageAccuracy": 0, "reviewsCount": 0, "officialTrail": True})
    reviews = list(trail.get("reviews") or [])
    accuracy = request.data.get("accuracy")
    has_rating = isinstance(accuracy, (int, float)) and 1 <= float(accuracy) <= 5
    existing = any(review.get("userId") == user_id for review in reviews)
    review_added = False
    if has_rating and not existing:
        reviews.append({"_id": ObjectId(), "userId": user_id, "username": (user or {}).get("username", "Anonymous"), "accuracy": float(accuracy), "comment": normalize_string(request.data.get("comment")), "createdAt": now_utc(), "updatedAt": now_utc()})
        review_added = True
    average = recalc_average_accuracy(reviews)
    get_mongo_db()[COLLECTIONS.trails].update_one({"_id": trail["_id"]}, {"$set": {"reviews": reviews, "averageAccuracy": average, "updatedAt": now_utc()}})
    update_badge_progress(user_id or "", {"trailCompletions": 1})
    invalidate_api_cache(["trails"])
    return Response({"success": True, "reviewAdded": review_added, "alreadyReviewed": existing, "averageAccuracy": average, "reviewsCount": len(reviews)})


@api_view(["GET", "POST"])
def trail_reviews(request: Request, trail_id: str) -> Response:
    trail, collection = trail_by_id(trail_id)
    if not trail:
        return Response({"error": "Trail not found"}, status=404)
    if request.method == "GET":
        if collection == COLLECTIONS.official_trails:
            return Response({"reviews": [], "averageAccuracy": 0})
        return Response({"reviews": serialize_mongo_list(trail.get("reviews") or []), "averageAccuracy": trail.get("averageAccuracy") or 0})
    if collection == COLLECTIONS.official_trails:
        return Response({"error": "Official routes do not support user reviews"}, status=400)
    user_id, user, auth_error = ensure_user_document(request)
    if auth_error:
        return auth_error
    accuracy = float(request.data.get("accuracy") or 0)
    if accuracy < 1 or accuracy > 5:
        return Response({"error": "Accuracy must be between 1 and 5"}, status=400)
    reviews = list(trail.get("reviews") or [])
    if any(review.get("userId") == user_id for review in reviews):
        return Response({"error": "You have already reviewed this trail"}, status=400)
    reviews.append({"_id": ObjectId(), "userId": user_id, "username": (user or {}).get("username", "Anonymous"), "accuracy": accuracy, "comment": normalize_string(request.data.get("comment")), "createdAt": now_utc(), "updatedAt": now_utc()})
    average = recalc_average_accuracy(reviews)
    get_mongo_db()[COLLECTIONS.trails].update_one({"_id": trail["_id"]}, {"$set": {"reviews": reviews, "averageAccuracy": average, "updatedAt": now_utc()}})
    invalidate_api_cache(["trails"])
    trail["reviews"] = reviews
    trail["averageAccuracy"] = average
    return Response(serialize_mongo_document(trail), status=201)


@api_view(["GET"])
def huts_list(request: Request) -> Response:
    return cached_response(request, MAP_CACHE_SECONDS, ["huts"], lambda: serialize_mongo_list(list(get_mongo_db()[COLLECTIONS.huts].find({}).sort("name", 1))))

def detect_trash_clusters(new_ping: dict[str, Any]) -> None:
    if new_ping.get("type") != "junk":
        return
    db = get_mongo_db()
    junk_pings = list(db[COLLECTIONS.pings].find({**active_ping_query(), "type": "junk"}))
    nearby = [ping for ping in junk_pings if haversine_meters(new_ping["coordinates"], ping.get("coordinates", [])) <= 300]
    if len(nearby) < 3:
        return
    nearby_ids = [ping["_id"] for ping in nearby]
    existing = db[COLLECTIONS.trash_clusters].find_one({"resolved": {"$ne": True}, "pingIds": {"$in": nearby_ids}})
    avg_lng = sum(float(ping["coordinates"][0]) for ping in nearby) / len(nearby)
    avg_lat = sum(float(ping["coordinates"][1]) for ping in nearby) / len(nearby)
    level = "event" if len(nearby) >= 5 else "clutter"
    description = f"Trash cleanup needed! {len(nearby)} reports of litter in this area." if level == "event" else f"Warning: {len(nearby)} trash reports nearby. This area may need cleanup soon."
    if existing:
        db[COLLECTIONS.trash_clusters].update_one({"_id": existing["_id"]}, {"$set": {"pingIds": nearby_ids, "pingCount": len(nearby), "coordinates": [avg_lng, avg_lat], "level": level, "description": description, "updatedAt": now_utc()}})
    else:
        db[COLLECTIONS.trash_clusters].insert_one({"level": level, "coordinates": [avg_lng, avg_lat], "pingIds": nearby_ids, "pingCount": len(nearby), "description": description, "goneVotes": [], "resolved": False, "createdAt": now_utc(), "updatedAt": now_utc()})
    invalidate_api_cache(["clusters"])


@api_view(["GET", "POST"])
def photo_pings(request: Request) -> Response:
    if request.method == "POST":
        return create_photo_ping(request)
    query = apply_point_filters(request, {"resolved": {"$ne": True}})
    return cached_response(request, LIVE_CACHE_SECONDS, ["pings"], lambda: serialize_mongo_list(list(get_mongo_db()[COLLECTIONS.photo_pings].find(query).sort("createdAt", -1))))


@api_view(["POST"])
def photo_ping_create(request: Request) -> Response:
    return create_photo_ping(request)


def create_photo_ping(request: Request) -> Response:
    user_id, user, auth_error = ensure_user_document(request)
    if auth_error:
        return auth_error
    payload = normalize_photo_ping_payload(request.data)
    if not payload["photoUrl"]:
        return Response({"error": "photoUrl is required"}, status=400)
    if not (payload["photoUrl"].startswith("data:image/") or payload["photoUrl"].startswith("http")):
        return Response({"error": "Invalid photo data"}, status=400)
    coords = payload["coordinates"]
    if len(coords) != 2 or abs(coords[0]) > 180 or abs(coords[1]) > 90:
        return Response({"error": "coordinates must be [longitude, latitude]"}, status=400)
    doc = {"trailId": payload["trailId"] or None, "userId": user_id, "username": (user or {}).get("username", "Anonymous"), "type": "photo", "description": payload["description"], "photoUrl": payload["photoUrl"], "photoCategory": payload["photoCategory"], "coordinates": coords, "resolved": False, "createdAt": now_utc(), "updatedAt": now_utc()}
    result = get_mongo_db()[COLLECTIONS.photo_pings].insert_one(doc)
    doc["_id"] = result.inserted_id
    invalidate_api_cache(["pings"])
    return Response(serialize_mongo_document(doc), status=201)


@api_view(["GET", "POST"])
def pings(request: Request) -> Response:
    if request.method == "GET":
        query = apply_point_filters(request, active_ping_query())
        return cached_response(request, LIVE_CACHE_SECONDS, ["pings"], lambda: serialize_mongo_list(list(get_mongo_db()[COLLECTIONS.pings].find(query).sort("createdAt", -1).limit(1000))))
    if request.data.get("type") == "photo":
        return create_photo_ping(request)
    user_id, user, auth_error = ensure_user_document(request)
    if auth_error:
        return auth_error
    body = request.data
    ping_type = normalize_string(body.get("type"))
    coords = body.get("coordinates") if isinstance(body.get("coordinates"), list) else []
    if ping_type not in PING_EXPIRATION_SECONDS:
        return Response({"error": "type is required"}, status=400)
    if len(coords) != 2:
        return Response({"error": "coordinates must be [longitude, latitude]"}, status=400)
    trail_id = normalize_string(body.get("trailId"))
    if trail_id and not trail_by_id(trail_id)[0]:
        return Response({"error": "Trail not found"}, status=404)
    doc = {"trailId": make_object_id(trail_id) if trail_id else None, "userId": user_id, "username": (user or {}).get("username", "Anonymous"), "type": ping_type, "description": normalize_string(body.get("description")), "photoUrl": body.get("photoUrl") or None, "photoCategory": body.get("photoCategory") if ping_type == "photo" else None, "coordinates": [float(coords[0]), float(coords[1])], "expiresAt": ping_expiration(ping_type), "goneVotes": [], "resolved": False, "createdAt": now_utc(), "updatedAt": now_utc()}
    result = get_mongo_db()[COLLECTIONS.pings].insert_one(doc)
    doc["_id"] = result.inserted_id
    detect_trash_clusters(doc)
    invalidate_api_cache(["pings", "clusters"])
    return Response(serialize_mongo_document(doc), status=201)


@api_view(["POST", "DELETE"])
def ping_detail(request: Request, ping_id: str) -> Response:
    object_id = make_object_id(ping_id)
    if object_id is None:
        return Response({"error": "Invalid ping id"}, status=400)
    user_id = get_request_user_id(request)
    if not user_id:
        return Response({"error": "Unauthenticated"}, status=401)
    ping = get_mongo_db()[COLLECTIONS.pings].find_one({"_id": object_id})
    if not ping:
        return Response({"error": "Ping not found"}, status=404)
    if request.method == "DELETE":
        if ping.get("userId") != user_id:
            return Response({"error": "Not authorized to delete this ping"}, status=403)
        get_mongo_db()[COLLECTIONS.pings].delete_one({"_id": object_id})
        invalidate_api_cache(["pings", "clusters"])
        return Response({"success": True})
    return Response({"error": "Unsupported method"}, status=405)


@api_view(["POST"])
def ping_vote(request: Request, ping_id: str) -> Response:
    object_id = make_object_id(ping_id)
    if object_id is None:
        return Response({"error": "Invalid ping id"}, status=400)
    user_id = get_request_user_id(request)
    if not user_id:
        return Response({"error": "Unauthenticated"}, status=401)
    db = get_mongo_db()
    ping = db[COLLECTIONS.pings].find_one({"_id": object_id})
    if not ping:
        return Response({"error": "Ping not found"}, status=404)
    if ping.get("resolved"):
        return Response({"error": "Already resolved"}, status=400)
    vote_type = str(request.data.get("vote") or request.data.get("voteType") or "gone")
    update: dict[str, Any] = {"updatedAt": now_utc()}
    if vote_type in {"gone", "not_there", "resolved"}:
        votes, added = add_unique_vote(ping.get("goneVotes") or [], user_id)
        update["goneVotes"] = votes
        if len(votes) >= 3:
            update["resolved"] = True
    else:
        votes, added = add_unique_vote(ping.get("stillThereVotes") or [], user_id)
        update["stillThereVotes"] = votes
    db[COLLECTIONS.pings].update_one({"_id": object_id}, {"$set": update})
    invalidate_api_cache(["pings", "clusters"])
    ping.update(update)
    return Response({"success": True, "added": added, "ping": serialize_mongo_document(ping)})


@api_view(["GET"])
def clusters_list(request: Request) -> Response:
    def load() -> list[dict[str, Any]]:
        clusters = list(get_mongo_db()[COLLECTIONS.trash_clusters].find({"resolved": {"$ne": True}}).sort("createdAt", -1).limit(1000))
        return serialize_mongo_list(attach_cluster_voter_profiles(clusters) or [])
    return cached_response(request, LIVE_CACHE_SECONDS, ["clusters"], load)


@api_view(["POST"])
def cluster_vote(request: Request, cluster_id: str) -> Response:
    object_id = make_object_id(cluster_id)
    if object_id is None:
        return Response({"error": "Invalid cluster id"}, status=400)
    user_id, _user, auth_error = ensure_user_document(request)
    if auth_error:
        return auth_error
    db = get_mongo_db()
    cluster = db[COLLECTIONS.trash_clusters].find_one({"_id": object_id})
    if not cluster:
        return Response({"error": "Cluster not found"}, status=404)
    if cluster.get("resolved"):
        return Response({"error": "Already resolved"}, status=400)
    votes = [str(vote) for vote in cluster.get("goneVotes", [])]
    if user_id in votes:
        return Response({"error": "You already voted"}, status=400)
    votes.append(user_id or "")
    needed = 5 if cluster.get("level") == "event" else 3
    resolved = len(votes) >= needed
    db[COLLECTIONS.trash_clusters].update_one({"_id": object_id}, {"$set": {"goneVotes": votes, "resolved": resolved, "updatedAt": now_utc()}})
    if resolved:
        db[COLLECTIONS.pings].update_many({"_id": {"$in": cluster.get("pingIds", [])}}, {"$set": {"resolved": True, "updatedAt": now_utc()}})
    invalidate_api_cache(["pings", "clusters"])
    fresh = db[COLLECTIONS.trash_clusters].find_one({"_id": object_id})
    return Response(serialize_mongo_document(attach_cluster_voter_profiles(fresh)))



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
    mode = normalize_string(area_payload.get("mode") or "bbox")
    if mode == "radius":
        return OfflineArea(mode="radius", center=area_payload.get("center"), radius_km=float(area_payload.get("radiusKm") or 0))
    return OfflineArea(mode="bbox", bbox=area_payload.get("bbox"))


@api_view(["GET", "POST"])
def offline_downloads(request: Request) -> Response:
    user_id, _user, auth_error = ensure_user_document(request)
    if auth_error:
        return auth_error
    db = get_mongo_db()
    collection = db[COLLECTIONS.offline_downloads]

    if request.method == "GET":
        query: dict[str, Any] = {"userId": user_id, "status": {"$ne": "deleted"}}
        device_id = normalize_string(request.query_params.get("deviceId"))
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
    counts = count_offline_resources(resource_types)
    tile_estimate = estimate_tile_count(area, int(payload["minZoom"]), int(payload["maxZoom"])) if "map_tiles" in resource_types else 0
    document = {
        "userId": user_id,
        "name": payload["name"],
        "deviceId": payload["deviceId"],
        "resourceTypes": resource_types,
        "area": payload["area"],
        "minZoom": payload["minZoom"],
        "maxZoom": payload["maxZoom"],
        "status": "ready",
        "resources": {"counts": counts, "tileEstimate": tile_estimate},
        "createdAt": now_utc(),
        "updatedAt": now_utc(),
    }
    result = collection.insert_one(document)
    document["_id"] = result.inserted_id
    return Response(serialize_mongo_document(document), status=201)


@api_view(["GET"])
def offline_download_status(request: Request) -> Response:
    user_id, _user, auth_error = ensure_user_document(request)
    if auth_error:
        return auth_error
    query: dict[str, Any] = {"userId": user_id, "status": {"$ne": "deleted"}}
    device_id = normalize_string(request.query_params.get("deviceId"))
    if device_id:
        query["deviceId"] = device_id
    packs = list(get_mongo_db()[COLLECTIONS.offline_downloads].find(query).sort("createdAt", -1))
    return Response(summarize_packs(packs))


@api_view(["GET", "DELETE"])
def offline_download_detail(request: Request, download_id: str) -> Response:
    object_id = make_object_id(download_id)
    if object_id is None:
        return Response({"error": "Invalid offline download id"}, status=400)
    user_id, _user, auth_error = ensure_user_document(request)
    if auth_error:
        return auth_error
    collection = get_mongo_db()[COLLECTIONS.offline_downloads]
    pack = collection.find_one({"_id": object_id, "userId": user_id})
    if not pack or pack.get("status") == "deleted":
        return Response({"error": "Offline download not found"}, status=404)
    if request.method == "GET":
        return Response(serialize_mongo_document(pack))
    collection.update_one({"_id": object_id}, {"$set": {"status": "deleted", "updatedAt": now_utc()}})
    return Response({"success": True, "deletedId": str(object_id)})