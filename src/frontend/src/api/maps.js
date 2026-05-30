import api from './client'
import { cachedGet, clearRequestCache } from './requestCache'

const TRAILS_CACHE_TTL_MS = 10 * 60 * 1000
const HUTS_CACHE_TTL_MS = 10 * 60 * 1000

export const fetchMapTrails = (params = {}) => {
  return cachedGet(
    api,
    '/trails',
    { params, timeout: 60000, skipAuth: true },
    { ttlMs: TRAILS_CACHE_TTL_MS }
  )
}

export const fetchMapTrailsGeojson = () => {
  return cachedGet(
    api,
    '/trails/geojson',
    { timeout: 60000, skipAuth: true },
    { ttlMs: TRAILS_CACHE_TTL_MS }
  )
}

export const fetchMapTrailsByArea = ({
  search = '',
  center = null,
  radiusKm = 8,
  proximityMode = 'start',
} = {}) => {
  const params = {
    ...(search ? { search } : {}),
    ...(Array.isArray(center) && center.length === 2
      ? {
          centerLng: center[0],
          centerLat: center[1],
          radiusKm,
          proximityMode,
        }
      : {}),
  }

  return cachedGet(
    api,
    '/trails',
    { params, skipAuth: true },
    { ttlMs: TRAILS_CACHE_TTL_MS }
  )
}

export const fetchTrailStartReadiness = (trailId, params = {}) => {
  return api.get(`/trails/${trailId}/start-readiness`, { params })
}

export const completeTrailFromMap = (trailId, payload = {}) => {
  return api.post(`/trails/${trailId}/complete`, payload)
}

export const fetchHuts = () => {
  return cachedGet(api, '/huts', {}, { ttlMs: HUTS_CACHE_TTL_MS })
}

export const clearMapDataCache = () => {
  clearRequestCache('/trails')
  clearRequestCache('/huts')
}
