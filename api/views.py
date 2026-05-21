from django.shortcuts import render

# Create your views here.
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .mongo import get_mongo_db
from .serializers import serialize_mongo_list

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