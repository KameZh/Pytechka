import { create } from 'zustand'
import localforage from 'localforage'

// Create a localforage instance for offline trails
const trailsStore = localforage.createInstance({
  name: 'PytechkaOffline',
  storeName: 'trails',
  description: 'Stores trail data for offline usage',
})

const draftsStore = localforage.createInstance({
  name: 'PytechkaOffline',
  storeName: 'recorded_trail_drafts',
  description: 'Stores recorded trails before publishing',
})

const mapDataStore = localforage.createInstance({
  name: 'PytechkaOffline',
  storeName: 'map_data',
  description: 'Stores huts, pings, photos, clusters, and map metadata offline',
})

function createDeviceInfo() {
  const hasBrowserStorage = typeof window !== 'undefined' && window.localStorage
  const storage = hasBrowserStorage ? window.localStorage : null
  const storedId = storage?.getItem('pytechka-offline-device-id')
  const id =
    storedId ||
    `device-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  if (!storedId) storage?.setItem('pytechka-offline-device-id', id)

  const nav = typeof navigator !== 'undefined' ? navigator : null
  const platform =
    nav?.userAgentData?.platform || nav?.platform || 'This device'
  const browser = nav?.userAgentData?.brands?.[0]?.brand || 'Browser'
  return {
    id,
    name: `${platform} · ${browser}`,
    lastSeenAt: new Date().toISOString(),
  }
}

function normalizeOfflineTrail(trail) {
  if (!trail || typeof trail !== 'object') return trail
  const deviceInfo = createDeviceInfo()
  return {
    ...trail,
    geojson: trail.geojson || trail.geom || trail.mapGeometry || null,
    savedOfflineAt: trail.savedOfflineAt || new Date().toISOString(),
    savedOfflineDeviceId: trail.savedOfflineDeviceId || deviceInfo.id,
    savedOfflineDeviceName: trail.savedOfflineDeviceName || deviceInfo.name,
  }
}

export const useOfflineStore = create((set, get) => ({
  offlineTrails: [],
  offlineHuts: [],
  offlinePings: [],
  offlineClusters: [],
  offlineEvents: [],
  offlineMapPacks: [],
  offlineDeviceInfo: createDeviceInfo(),
  draftTrails: [],
  isLoaded: false,
  mapDataLoaded: false,
  draftsLoaded: false,

  // Load all trails from local storage into memory
  loadOfflineTrails: async () => {
    try {
      const trails = []
      await trailsStore.iterate((value) => {
        trails.push(value)
      })
      set({ offlineTrails: trails, isLoaded: true })
    } catch (err) {
      console.error('Failed to load offline trails', err)
      set({ isLoaded: true }) // Set loaded even on fail to stop loading spinners
    }
  },

  loadOfflineMapData: async () => {
    try {
      const [
        offlineHuts,
        offlinePings,
        offlineClusters,
        offlineEvents,
        offlineMapPacks,
        offlineDeviceInfo,
      ] = await Promise.all([
        mapDataStore.getItem('huts'),
        mapDataStore.getItem('pings'),
        mapDataStore.getItem('clusters'),
        mapDataStore.getItem('events'),
        mapDataStore.getItem('mapPacks'),
        mapDataStore.getItem('deviceInfo'),
      ])
      const deviceInfo = offlineDeviceInfo || createDeviceInfo()
      await mapDataStore.setItem('deviceInfo', deviceInfo)
      set({
        offlineHuts: Array.isArray(offlineHuts) ? offlineHuts : [],
        offlinePings: Array.isArray(offlinePings) ? offlinePings : [],
        offlineClusters: Array.isArray(offlineClusters) ? offlineClusters : [],
        offlineEvents: Array.isArray(offlineEvents) ? offlineEvents : [],
        offlineMapPacks: Array.isArray(offlineMapPacks) ? offlineMapPacks : [],
        offlineDeviceInfo: deviceInfo,
        mapDataLoaded: true,
      })
    } catch (err) {
      console.error('Failed to load offline map data', err)
      set({ mapDataLoaded: true })
    }
  },

  saveOfflineMapData: async ({
    huts,
    pings,
    clusters,
    events,
    mapPack,
  } = {}) => {
    try {
      const writes = []
      if (Array.isArray(huts)) writes.push(mapDataStore.setItem('huts', huts))
      if (Array.isArray(pings)) writes.push(mapDataStore.setItem('pings', pings))
      if (Array.isArray(clusters)) {
        writes.push(mapDataStore.setItem('clusters', clusters))
      }
      if (Array.isArray(events)) writes.push(mapDataStore.setItem('events', events))
      if (mapPack) {
        const deviceInfo = createDeviceInfo()
        const current = (await mapDataStore.getItem('mapPacks')) || []
        const next = [
          ...current.filter((entry) => entry.id !== mapPack.id),
          {
            ...mapPack,
            savedAt: mapPack.savedAt || new Date().toISOString(),
            deviceId: mapPack.deviceId || deviceInfo.id,
            deviceName: mapPack.deviceName || deviceInfo.name,
          },
        ]
        writes.push(mapDataStore.setItem('mapPacks', next))
      }
      writes.push(mapDataStore.setItem('deviceInfo', createDeviceInfo()))
      await Promise.all(writes)
      await get().loadOfflineMapData()
    } catch (err) {
      console.error('Failed to save offline map data', err)
      throw err
    }
  },

  clearOfflineMapData: async () => {
    try {
      await mapDataStore.clear()
      set({
        offlineHuts: [],
        offlinePings: [],
        offlineClusters: [],
        offlineEvents: [],
        offlineMapPacks: [],
      })
    } catch (err) {
      console.error('Failed to clear offline map data', err)
      throw err
    }
  },

  loadDraftTrails: async () => {
    try {
      const drafts = []
      await draftsStore.iterate((value) => {
        drafts.push(value)
      })
      drafts.sort(
        (a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0)
      )
      set({ draftTrails: drafts, draftsLoaded: true })
    } catch (err) {
      console.error('Failed to load local trail drafts', err)
      set({ draftsLoaded: true })
    }
  },

  saveDraftTrail: async (draft) => {
    try {
      const id =
        draft?.localId ||
        `local-trail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const next = {
        ...draft,
        localId: id,
        source: 'local_draft',
        savedAt: draft?.savedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      await draftsStore.setItem(id, next)
      set((state) => {
        const existing = state.draftTrails.filter(
          (trail) => trail.localId !== id
        )
        return { draftTrails: [next, ...existing] }
      })
      return next
    } catch (err) {
      console.error('Failed to save local trail draft', err)
      throw err
    }
  },

  updateDraftTrail: async (id, updates) => {
    const current = await draftsStore.getItem(id)
    if (!current) throw new Error('Local trail draft not found')
    return get().saveDraftTrail({
      ...current,
      ...updates,
      localId: id,
      savedAt: current.savedAt,
    })
  },

  removeDraftTrail: async (id) => {
    try {
      if (!id) return
      await draftsStore.removeItem(id)
      set((state) => ({
        draftTrails: state.draftTrails.filter((trail) => trail.localId !== id),
      }))
    } catch (err) {
      console.error('Failed to remove local trail draft', err)
      throw err
    }
  },

  // Save a single trail offline
  saveTrail: async (trail) => {
    try {
      const id = trail._id || trail.id
      if (!id) return

      const offlineTrail = normalizeOfflineTrail(trail)
      await trailsStore.setItem(id, offlineTrail)
      set((state) => {
        const existing = state.offlineTrails.filter(
          (t) => (t._id || t.id) !== id
        )
        return { offlineTrails: [...existing, offlineTrail] }
      })
    } catch (err) {
      console.error('Failed to save trail', err)
      throw err
    }
  },

  // Remove a single trail from offline storage
  removeTrail: async (trailId) => {
    try {
      if (!trailId) return
      await trailsStore.removeItem(trailId)
      set((state) => ({
        offlineTrails: state.offlineTrails.filter(
          (t) => (t._id || t.id) !== trailId
        ),
      }))
    } catch (err) {
      console.error('Failed to remove trail', err)
      throw err
    }
  },

  // Save multiple trails
  saveMultipleTrails: async (trails) => {
    try {
      for (const trail of trails) {
        const id = trail._id || trail.id
        if (id) {
          await trailsStore.setItem(id, normalizeOfflineTrail(trail))
        }
      }
      await get().loadOfflineTrails()
    } catch (err) {
      console.error('Failed to save multiple trails', err)
      throw err
    }
  },

  // Remove multiple trails
  removeMultipleTrails: async (trailIds) => {
    try {
      for (const id of trailIds) {
        if (id) {
          await trailsStore.removeItem(id)
        }
      }
      await get().loadOfflineTrails()
    } catch (err) {
      console.error('Failed to remove multiple trails', err)
      throw err
    }
  },

  // Clear all offline trails
  clearAll: async () => {
    try {
      await trailsStore.clear()
      set({ offlineTrails: [] })
    } catch (err) {
      console.error('Failed to clear offline trails', err)
      throw err
    }
  },
}))
