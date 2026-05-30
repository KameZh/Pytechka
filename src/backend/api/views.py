from django.shortcuts import render

# Create your views here.
import re
from datetime import datetime, timezone

from rest_framework.decorators import api_view
from rest_framework.response import Response

from .mongo import get_mongo_db
from .mongo_helpers import make_object_id
from .serializers import serialize_mongo_list, serialize_mongo_document

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


@api_view(["GET"])
def pings_list(request):
    db = get_mongo_db()

    query = apply_common_point_filters(request, active_ping_filter())

    pings = list(
        db.pings.find(query).sort("createdAt", -1).limit(1000)
    )

    return Response(serialize_mongo_list(pings))


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
