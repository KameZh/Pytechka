from django.conf import settings
from pymongo import MongoClient

_client = None
_db = None


def get_mongo_db():
    
    global _client, _db

    if _db is not None:
        return _db
    
    if not settings.MONGO_URI:
        raise RuntimeError("MONGO_URI is missing from .env")
    
    if not settings.MONGO_DB_NAME:
        raise RuntimeError("MONOG_DB_NAME is missing from .env")
    
    _client = MongoClient(settings.MONGO_URI)
    _db = _client[settings.MONGO_DB_NAME]

    return _db