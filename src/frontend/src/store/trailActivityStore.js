import { create } from 'zustand'

const TRAIL_ACTIVITY_STORAGE_KEY = 'pytechka-active-map-trail'

let watchId = null
let timerId = null
let wakeLock = null
let lastPoint = null

function distanceMeters(a, b) {
  const lon1 = Number(a?.longitude ?? a?.[0])
  const lat1 = Number(a?.latitude ?? a?.[1])
  const lon2 = Number(b?.longitude ?? b?.[0])
  const lat2 = Number(b?.latitude ?? b?.[1])
  if (![lon1, lat1, lon2, lat2].every(Number.isFinite)) return 0

  const R = 6371000
  const toRad = (deg) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

function getNearestPathIndex(pathCoordinates = [], location) {
  if (!Array.isArray(pathCoordinates) || !pathCoordinates.length || !location) {
    return -1
  }

  let bestIndex = -1
  let bestDistance = Infinity
  pathCoordinates.forEach((coord, index) => {
    const distance = distanceMeters(
      [Number(coord?.[0]), Number(coord?.[1])],
      [Number(location.longitude), Number(location.latitude)]
    )
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  })
  return bestIndex
}

function resolveSectorIndex(session, location) {
  const nearestPathIndex = getNearestPathIndex(session?.pathCoordinates, location)
  if (nearestPathIndex < 0) return 0

  const segmentIndex = (Array.isArray(session?.segments) ? session.segments : [])
    .findIndex(
      (segment) =>
        nearestPathIndex >= Number(segment.startIndex || 0) &&
        nearestPathIndex <= Number(segment.endIndex || 0)
    )
  return segmentIndex >= 0 ? segmentIndex : 0
}

function loadStoredActivity() {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(TRAIL_ACTIVITY_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function saveStoredActivity(state) {
  if (typeof localStorage === 'undefined') return
  if (!state.activeTrailSession) {
    localStorage.removeItem(TRAIL_ACTIVITY_STORAGE_KEY)
    return
  }

  localStorage.setItem(
    TRAIL_ACTIVITY_STORAGE_KEY,
    JSON.stringify({
      activeTrailSession: state.activeTrailSession,
      activityDistanceMeters: state.activityDistanceMeters,
      activityDurationSeconds: state.activityDurationSeconds,
      activityCurrentElevation: state.activityCurrentElevation,
      activityElevationGain: state.activityElevationGain,
      currentSectorIndex: state.currentSectorIndex,
      lastPoint,
      updatedAt: new Date().toISOString(),
    })
  )
}

async function requestWakeLock() {
  if (!navigator?.wakeLock?.request) return
  try {
    wakeLock = await navigator.wakeLock.request('screen')
    wakeLock.addEventListener('release', () => {
      wakeLock = null
    })
  } catch {
    wakeLock = null
  }
}

async function releaseWakeLock() {
  try {
    await wakeLock?.release?.()
  } catch {
    /* Wake lock release is best-effort. */
  } finally {
    wakeLock = null
  }
}

function stopWatch() {
  if (watchId != null && navigator?.geolocation) {
    navigator.geolocation.clearWatch(watchId)
  }
  watchId = null
  if (timerId) {
    window.clearInterval(timerId)
    timerId = null
  }
}

const stored = loadStoredActivity()
lastPoint = stored?.lastPoint || null

export const useTrailActivityStore = create((set, get) => ({
  activeTrailSession: stored?.activeTrailSession || null,
  activityDistanceMeters: Number(stored?.activityDistanceMeters || 0),
  activityDurationSeconds: Number(stored?.activityDurationSeconds || 0),
  activityCurrentElevation: stored?.activityCurrentElevation ?? null,
  activityElevationGain: Number(stored?.activityElevationGain || 0),
  currentSectorIndex: Number(stored?.currentSectorIndex || 0),
  trackingError: '',

  startTrailActivity: (session, initialLocation = null) => {
    lastPoint = initialLocation
      ? {
          longitude: Number(initialLocation.longitude),
          latitude: Number(initialLocation.latitude),
          altitude: Number(initialLocation.altitude),
        }
      : null

    set({
      activeTrailSession: session,
      activityDistanceMeters: 0,
      activityDurationSeconds: 0,
      activityCurrentElevation: Number.isFinite(initialLocation?.altitude)
        ? initialLocation.altitude
        : null,
      activityElevationGain: 0,
      currentSectorIndex: 0,
      trackingError: '',
    })
    saveStoredActivity(get())
    get().ensureTrailTracking()
  },

  clearTrailActivity: () => {
    stopWatch()
    lastPoint = null
    set({
      activeTrailSession: null,
      activityDistanceMeters: 0,
      activityDurationSeconds: 0,
      activityCurrentElevation: null,
      activityElevationGain: 0,
      currentSectorIndex: 0,
      trackingError: '',
    })
    saveStoredActivity(get())
    releaseWakeLock()
  },

  ensureTrailTracking: () => {
    const state = get()
    if (!state.activeTrailSession || !navigator.geolocation) return

    if (!timerId) {
      timerId = window.setInterval(() => {
        const current = get()
        if (!current.activeTrailSession) return
        set({ activityDurationSeconds: current.activityDurationSeconds + 1 })
        saveStoredActivity(get())
      }, 1000)
    }

    if (watchId == null) {
      watchId = navigator.geolocation.watchPosition(
        ({ coords }) => {
          const current = get()
          if (!current.activeTrailSession) return

          const nextPoint = {
            longitude: coords.longitude,
            latitude: coords.latitude,
            altitude: Number.isFinite(coords.altitude) ? coords.altitude : null,
          }

          let nextDistance = Number(current.activityDistanceMeters || 0)
          let nextGain = Number(current.activityElevationGain || 0)

          if (lastPoint) {
            const increment = distanceMeters(lastPoint, nextPoint)
            if (increment > 0.6 && increment < 250) {
              nextDistance += increment
            }

            const prevAltitude = Number(lastPoint.altitude)
            const nextAltitude = Number(nextPoint.altitude)
            if (Number.isFinite(prevAltitude) && Number.isFinite(nextAltitude)) {
              const positiveGain = nextAltitude - prevAltitude
              if (positiveGain > 0) nextGain += positiveGain
            }
          }

          lastPoint = nextPoint
          set({
            activityDistanceMeters: nextDistance,
            activityCurrentElevation: nextPoint.altitude,
            activityElevationGain: nextGain,
            currentSectorIndex: resolveSectorIndex(
              current.activeTrailSession,
              nextPoint
            ),
            trackingError: '',
          })
          saveStoredActivity(get())
        },
        () => {
          set({
            trackingError:
              'Could not keep GPS running. Check location permissions.',
          })
        },
        {
          enableHighAccuracy: true,
          maximumAge: 1000,
          timeout: 10000,
        }
      )
    }

    requestWakeLock()
  },
}))
