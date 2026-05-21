from bson import ObjectId

def make_object_id(value):

  try:
    return ObjectId(str(value))
  except Exception:
    return None