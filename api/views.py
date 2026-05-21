from django.shortcuts import render

# Create your views here.
import re

from rest_framework.decorators import api_view
from rest_framework.response import Response

from .mongo import get_mongo_db
from .mongo_helpers import make_object_id
from .serializers import serialize_mongo_list, seriazlize_mongo_document, seriazlize_mongo_document

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

    try:
        limit = int(request.query_params.get("limit", 300))
    except ValueError:
        limit = 300

    limit = max(1, min(limit, 1000))

    search_filter = build_trail_search_filter(search)

    user_trails = []
    if not official_only:
        user_trails = list(
            db.trails.find(search_filter).sort("createdAt", 1).limit(limit)
        )

    official_trails = list(
        db.officialTrails.find(search_filter).sort("createdAt", 1).limit(limit)
    )

    trails = [normalize_trail_document(t) for t in user_trails + official_trails]

    if not include_geometry:
        for trail in trails:
            trail.pop("geojson", None)
            trail.pop("geom", None)

    return Response(serialize_mongo_list(trails))

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
        db.officialTrails.find(
            {"mapGeometry": {"$ne": None}},
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
            }
        )
    )

    features = []

    for trail in user_trails + official_trails:
        geometry = trail.get("mapGeometry") or trail.get("geojson")

        if not geometry:
            continue
        
        if isinstance(geometry, dict) and geometry.get("type") and geometry.get("coordinates"):
            geometry = geometry
      
        if not geometry:
          continue
    
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
            "geometry": geometry,
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
        trail = db.officialTrails.find_one({"_id": object_id})
    
    if trail is None:
        return Response({"error": "Trail not found"}, status=status.HTTP_404_NOT_FOUND)
    
    return Response(seriazlize_mongo_document(normalize_trail_document(trail)))
