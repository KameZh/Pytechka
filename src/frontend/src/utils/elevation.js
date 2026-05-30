const TERRAIN_RGB_ZOOM = 15
const TILE_SIZE = 256
const terrainTileCache = new Map()

function lngLatToTerrainTile(lng, lat, zoom = TERRAIN_RGB_ZOOM) {
  const safeLat = Math.max(-85.05112878, Math.min(85.05112878, Number(lat)))
  const safeLng = Number(lng)
  if (!Number.isFinite(safeLng) || !Number.isFinite(safeLat)) return null

  const scale = 2 ** zoom
  const xFloat = ((safeLng + 180) / 360) * scale
  const latRad = (safeLat * Math.PI) / 180
  const yFloat =
    ((1 -
      Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) /
      2) *
    scale
  const x = Math.max(0, Math.min(scale - 1, Math.floor(xFloat)))
  const y = Math.max(0, Math.min(scale - 1, Math.floor(yFloat)))

  return {
    x,
    y,
    px: Math.max(0, Math.min(TILE_SIZE - 1, Math.floor((xFloat - x) * TILE_SIZE))),
    py: Math.max(0, Math.min(TILE_SIZE - 1, Math.floor((yFloat - y) * TILE_SIZE))),
    zoom,
  }
}

function loadTerrainTile({ x, y, zoom }, mapboxToken) {
  const key = `${zoom}/${x}/${y}`
  if (terrainTileCache.has(key)) return terrainTileCache.get(key)

  const promise = new Promise((resolve, reject) => {
    if (!mapboxToken || typeof Image === 'undefined' || typeof document === 'undefined') {
      reject(new Error('Terrain RGB unavailable'))
      return
    }

    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = TILE_SIZE
        canvas.height = TILE_SIZE
        const context = canvas.getContext('2d', { willReadFrequently: true })
        context.drawImage(image, 0, 0)
        resolve(context)
      } catch (err) {
        reject(err)
      }
    }
    image.onerror = () => reject(new Error('Could not load terrain tile'))
    image.src = `https://api.mapbox.com/v4/mapbox.terrain-rgb/${zoom}/${x}/${y}.pngraw?access_token=${mapboxToken}`
  })

  terrainTileCache.set(key, promise)
  return promise
}

export async function fetchTerrainRgbElevation(lng, lat, mapboxToken) {
  const tile = lngLatToTerrainTile(lng, lat)
  if (!tile) return null

  try {
    const context = await loadTerrainTile(tile, mapboxToken)
    const [r, g, b] = context.getImageData(tile.px, tile.py, 1, 1).data
    const elevation = -10000 + (r * 256 * 256 + g * 256 + b) * 0.1
    return Number.isFinite(elevation) ? elevation : null
  } catch {
    return null
  }
}

export async function sampleTerrainRgbElevations(coordinates = [], mapboxToken) {
  const samples = []
  for (const point of coordinates) {
    const elevation = await fetchTerrainRgbElevation(point?.[0], point?.[1], mapboxToken)
    if (Number.isFinite(elevation)) {
      samples.push({ point, elevation })
    }
  }
  return samples
}
