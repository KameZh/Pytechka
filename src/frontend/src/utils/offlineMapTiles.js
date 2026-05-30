import * as turf from '@turf/turf'

function lng2tile(lon, zoom) { 
  return Math.floor((lon + 180) / 360 * Math.pow(2, zoom)); 
}

function lat2tile(lat, zoom) { 
  return Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom)); 
}

const BULGARIA_BOUNDS = [22.35, 41.23, 28.78, 44.22]
const TILE_FETCH_TIMEOUT_MS = 7000

async function fetchWithTimeout(url) {
  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(
    () => controller.abort(),
    TILE_FETCH_TIMEOUT_MS
  )

  try {
    return await fetch(url, { mode: 'cors', signal: controller.signal })
  } finally {
    globalThis.clearTimeout(timeoutId)
  }
}

async function fetchTileUrls(urlsToCache, onProgress) {
  const batchSize = 10
  let cache = null
  try {
    cache =
      typeof globalThis !== 'undefined' && 'caches' in globalThis
        ? await globalThis.caches.open('offline-mapbox-tiles')
        : null
  } catch (err) {
    cache = null
  }
  let completed = 0
  let cached = 0

  for (let i = 0; i < urlsToCache.length; i += batchSize) {
    const batch = urlsToCache.slice(i, i + batchSize)
    const results = await Promise.allSettled(
      batch.map(async (url) => {
        const response = await fetchWithTimeout(url)
        if (cache && response.ok) {
          await cache.put(url, response.clone())
        }
        return response.ok
      })
    )
    cached += results.filter(
      (result) => result.status === 'fulfilled' && result.value
    ).length
    completed += batch.length
    onProgress?.({ completed, total: urlsToCache.length, cached })
  }

  return { attempted: urlsToCache.length, cached }
}

function buildTileUrlsForBounds(bounds, mapboxToken, zoomLevels) {
  if (!Array.isArray(bounds) || bounds.length !== 4 || !mapboxToken) return []
  const [minLng, minLat, maxLng, maxLat] = bounds.map(Number)
  if (![minLng, minLat, maxLng, maxLat].every(Number.isFinite)) return []

  const urlsToCache = []

  for (const z of zoomLevels) {
    const minX = lng2tile(minLng, z)
    const maxX = lng2tile(maxLng, z)
    const minY = lat2tile(maxLat, z)
    const maxY = lat2tile(minLat, z)

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        urlsToCache.push(`https://api.mapbox.com/v4/mapbox.mapbox-streets-v8,mapbox.mapbox-terrain-v2,mapbox.mapbox-bathymetry-v2/${z}/${x}/${y}.vector.pbf?access_token=${mapboxToken}`)
        urlsToCache.push(`https://api.mapbox.com/v4/mapbox.mapbox-terrain-dem-v1/${z}/${x}/${y}.webp?access_token=${mapboxToken}`)
      }
    }
  }

  return urlsToCache
}

function limitTileUrls(urls, maxTiles) {
  if (!Number.isFinite(maxTiles) || maxTiles <= 0 || urls.length <= maxTiles) {
    return urls
  }

  const step = urls.length / maxTiles
  const limited = []
  for (let i = 0; i < maxTiles; i += 1) {
    limited.push(urls[Math.floor(i * step)])
  }
  return limited
}

function getTrailGeometry(trail) {
  return trail?.geojson || trail?.geom || trail?.mapGeometry || null
}

/**
 * Proactively fetches Mapbox tiles covering the bounding box of a trail.
 * Since we have Workbox runtime caching configured for api.mapbox.com,
 * calling `fetch()` here will automatically store the tiles in the service worker cache.
 */
export async function downloadMapTilesForTrail(
  trail,
  mapboxToken,
  { maxTiles = 1200, onProgress } = {}
) {
  const geometry = getTrailGeometry(trail)
  if (!geometry || !mapboxToken) return 0

  // 1. Calculate the bounding box of the trail using Turf
  const bbox = turf.bbox(geometry)
  const [minLng, minLat, maxLng, maxLat] = bbox

  // 2. Define the zoom levels to cache
  // 11 to 14 provides a good balance of detail vs storage/network overhead for hiking trails.
  const zoomLevels = [11, 12, 13, 14]
  const urlsToCache = limitTileUrls(
    buildTileUrlsForBounds(
      [minLng, minLat, maxLng, maxLat],
      mapboxToken,
      zoomLevels
    ),
    maxTiles
  )

  // 4. Proactively fetch all tiles in batches to avoid overwhelming the network
  const result = await fetchTileUrls(urlsToCache, onProgress)
  return result.cached
}

export async function downloadBulgariaOverviewTiles(mapboxToken, onProgress) {
  const urlsToCache = buildTileUrlsForBounds(BULGARIA_BOUNDS, mapboxToken, [
    7,
    8,
    9,
    10,
  ])
  const result = await fetchTileUrls(urlsToCache, onProgress)
  return result.cached
}
