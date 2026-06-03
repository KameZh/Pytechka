from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass
from typing import Any, Callable

from rest_framework.request import Request
from rest_framework.response import Response


@dataclass
class CacheEntry:
    payload: Any
    etag: str
    tags: list[str]
    expires_at: float


_API_CACHE: dict[str, CacheEntry] = {}
STALE_SECONDS = 300


def stable_query_string(query: Any) -> str:
    pairs: list[str] = []
    for key in sorted(query.keys()):
        if key == "ngrok-skip-browser-warning":
            continue
        value = query.getlist(key) if hasattr(query, "getlist") else query[key]
        rendered = ",".join(map(str, value)) if isinstance(value, list) else str(value)
        pairs.append(f"{key}={rendered}")
    return "&".join(pairs)


def request_cache_key(request: Request) -> str:
    query = stable_query_string(request.query_params)
    return f"{request.path}?{query}" if query else request.path


def build_etag(payload: Any) -> str:
    data = json.dumps(payload, sort_keys=True, default=str).encode()
    return '"' + hashlib.sha1(data).hexdigest() + '"'


def invalidate_api_cache(tags: list[str] | None = None) -> None:
    """Drop cache entries by tag after writes."""

    if not tags:
        _API_CACHE.clear()
        return
    for key, entry in list(_API_CACHE.items()):
        if any(tag in entry.tags for tag in tags):
            _API_CACHE.pop(key, None)


def cached_response(
    request: Request,
    ttl_seconds: int,
    tags: list[str],
    loader: Callable[[], Any],
) -> Response:
    key = request_cache_key(request)
    now = time.time()
    cached = _API_CACHE.get(key)
    if cached and cached.expires_at > now:
        response = Response(cached.payload)
        response["X-Pytechka-Cache"] = "HIT"
        response["ETag"] = cached.etag
        response["Cache-Control"] = f"public, max-age={ttl_seconds}, stale-while-revalidate={STALE_SECONDS}"
        return response

    payload = loader()
    etag = build_etag(payload)
    _API_CACHE[key] = CacheEntry(payload=payload, etag=etag, tags=tags, expires_at=now + ttl_seconds)
    response = Response(payload)
    response["X-Pytechka-Cache"] = "MISS"
    response["ETag"] = etag
    response["Cache-Control"] = f"public, max-age={ttl_seconds}, stale-while-revalidate={STALE_SECONDS}"
    return response
