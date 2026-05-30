import api from './client'
import { cachedGet, clearRequestCache } from './requestCache'

const LIVE_MAP_CACHE_TTL_MS = 45000

function clearLiveMapCache() {
  clearRequestCache('/pings')
  clearRequestCache('/photo-pings')
  clearRequestCache('/clusters')
}

export const createPing = async (data) => {
  const response = await api.post('/pings', data)
  clearLiveMapCache()
  return response
}

export const createPhotoPing = async (data) => {
  const response = await api.post('/photo-pings', {
    type: 'photo',
    ...(data.trailId ? { trailId: data.trailId } : {}),
    description: data.description || '',
    photoUrl: data.photoUrl,
    photoCategory: data.photoCategory || 'memory',
    coordinates: data.coordinates,
  })
  clearLiveMapCache()
  return response
}

export const fetchPings = async (params = {}) => {
  const [pingsResult, photosResult] = await Promise.allSettled([
    cachedGet(api, '/pings', { params }, { ttlMs: LIVE_MAP_CACHE_TTL_MS }),
    cachedGet(api, '/photo-pings', { params }, { ttlMs: LIVE_MAP_CACHE_TTL_MS }),
  ])

  const pings =
    pingsResult.status === 'fulfilled' && Array.isArray(pingsResult.value.data)
      ? pingsResult.value.data
      : []
  const photoPings =
    photosResult.status === 'fulfilled' && Array.isArray(photosResult.value.data)
      ? photosResult.value.data
      : []

  return {
    data: [...photoPings, ...pings].sort(
      (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    ),
    status: pingsResult.value?.status || photosResult.value?.status || 200,
  }
}

export const votePingGone = async (id) => {
  const response = await api.post(`/pings/${id}/vote`)
  clearLiveMapCache()
  return response
}

export const deletePing = async (id) => {
  const response = await api.delete(`/pings/${id}`)
  clearLiveMapCache()
  return response
}

export const fetchClusters = () => {
  return cachedGet(api, '/clusters', {}, { ttlMs: LIVE_MAP_CACHE_TTL_MS })
}

export const voteClusterGone = async (id) => {
  const response = await api.post(`/clusters/${id}/vote`)
  clearLiveMapCache()
  return response
}
