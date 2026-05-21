from datetime import datetime
from bson import ObjectId

def serialize_mongo_value(value):

  if isinstance(value, ObjectId):
    return str(value)

  if isinstance(value, datetime):
    return value.isoformat()
  
  if isinstance(value, list):
    return [serialize_mongo_value(item) for item in value]
  
  if isinstance(value, dict):
    return {
      key: serialize_mongo_value(val)
      for key, val in value.items()
    }
  
  return value


def seriazlize_mongo_document(document):

  if document is None:
    return None
  
  return {
    key: serialize_mongo_value(value)
    for key, value in document.items()
  }

def serialize_mongo_list(documents):
    return [seriazlize_mongo_document(document) for document in documents]
