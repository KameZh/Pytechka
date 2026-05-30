import { create } from 'zustand'

const AUTO_PAUSE_AFTER_MS = 25000
const RECORDING_STORAGE_KEY = 'pytechka-active-recording'

let watchId = null
let timerId = null
let wakeLock = null
let stationarySince = null
let nextSplitTarget = 1000

function distanceMeters(p1, p2) {
  const R = 6371000
  const toRad = (deg) => (deg * Math.PI) / 180
  const dLat = toRad(Number(p2.latitude) - Number(p1.latitude))
  const dLon = toRad(Number(p2.longitude) - Number(p1.longitude))
  const lat1 = toRad(Number(p1.latitude))
  const lat2 = toRad(Number(p2.latitude))

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function bearingDegrees(p1, p2) {
  const toRad = (deg) => (deg * Math.PI) / 180
  const toDeg = (rad) => (rad * 180) / Math.PI
  const startLat = toRad(Number(p1.latitude))
  const endLat = toRad(Number(p2.latitude))
  const deltaLon = toRad(Number(p2.longitude) - Number(p1.longitude))
  const y = Math.sin(deltaLon) * Math.cos(endLat)
  const x =
    Math.cos(startLat) * Math.sin(endLat) -
    Math.sin(startLat) * Math.cos(endLat) * Math.cos(deltaLon)

  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

function loadStoredRecording() {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(RECORDING_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

function saveStoredRecording(state) {
  if (typeof localStorage === 'undefined') return
  const payload = {
    points: state.points,
    elapsedSeconds: state.elapsedSeconds,
    distance: state.distance,
    currentElevation: state.currentElevation,
    elevationGain: state.elevationGain,
    currentSpeedKmh: state.currentSpeedKmh,
    movementHeading: state.movementHeading,
    splits: state.splits,
    updatedAt: new Date().toISOString(),
  }
  localStorage.setItem(RECORDING_STORAGE_KEY, JSON.stringify(payload))
}

function clearStoredRecording() {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(RECORDING_STORAGE_KEY)
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

const stored = loadStoredRecording()

export const useRecordingStore = create((set, get) => ({
  points: Array.isArray(stored?.points) ? stored.points : [],
  elapsedSeconds: Number(stored?.elapsedSeconds || 0),
  distance: Number(stored?.distance || 0),
  isTracking: false,
  autoPaused: false,
  splits: Array.isArray(stored?.splits) ? stored.splits : [],
  currentElevation: Number(stored?.currentElevation || 0),
  elevationGain: Number(stored?.elevationGain || 0),
  currentSpeedKmh: Number(stored?.currentSpeedKmh || 0),
  movementHeading: stored?.movementHeading ?? null,
  geoError: '',

  startTracking: () => {
    if (!navigator.geolocation) {
      set({ geoError: 'Geolocation is not supported on this device.' })
      return
    }

    if (watchId != null) {
      navigator.geolocation.clearWatch(watchId)
      watchId = null
    }

    set({ isTracking: true, autoPaused: false, geoError: '' })
    stationarySince = null
    nextSplitTarget =
      Math.floor(Number(get().distance || 0) / 1000 + 1) * 1000

    if (!timerId) {
      timerId = window.setInterval(() => {
        const state = get()
        if (!state.isTracking || state.autoPaused) return
        set({ elapsedSeconds: state.elapsedSeconds + 1 })
        saveStoredRecording(get())
      }, 1000)
    }

    requestWakeLock()

    watchId = navigator.geolocation.watchPosition(
      (position) => {
        const state = get()
        const nextElevation = Number.isFinite(position.coords.altitude)
          ? position.coords.altitude
          : null
        const nextPoint = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          elevation: nextElevation,
          recordedAt: Date.now(),
        }

        const prev = state.points[state.points.length - 1]
        let nextDistance = Number(state.distance || 0)
        let nextElevationGain = Number(state.elevationGain || 0)
        let nextSpeed = state.currentSpeedKmh
        let nextHeading = state.movementHeading
        let nextAutoPaused = false
        const nextSplits = []

        if (prev) {
          const increment = distanceMeters(prev, nextPoint)
          const elapsedSinceLast = Math.max(
            0.1,
            (nextPoint.recordedAt - prev.recordedAt) / 1000
          )
          const gpsSpeed =
            Number.isFinite(position.coords.speed) && position.coords.speed >= 0
              ? position.coords.speed
              : null
          const speedMps = gpsSpeed ?? increment / elapsedSinceLast
          nextSpeed = Math.max(0, speedMps * 3.6)

          const gpsHeading = Number(position.coords.heading)
          if (Number.isFinite(gpsHeading) && gpsHeading >= 0) {
            nextHeading = gpsHeading
          } else if (increment >= 2) {
            nextHeading = bearingDegrees(prev, nextPoint)
          }

          const moving = increment >= 1.2 && speedMps >= 0.45
          if (moving) {
            stationarySince = null
          } else if (!stationarySince) {
            stationarySince = nextPoint.recordedAt
          } else if (
            nextDistance > 25 &&
            nextPoint.recordedAt - stationarySince > AUTO_PAUSE_AFTER_MS
          ) {
            nextAutoPaused = true
          }

          if (moving && increment > 0.4) {
            nextDistance += increment
            while (nextDistance >= nextSplitTarget) {
              nextSplits.push({
                km: Math.round(nextSplitTarget / 1000),
                elapsedSeconds: state.elapsedSeconds,
                distanceMeters: Math.round(nextSplitTarget),
                recordedAt: nextPoint.recordedAt,
              })
              nextSplitTarget += 1000
            }
          }

          const prevElevation = Number(prev.elevation)
          if (
            Number.isFinite(prevElevation) &&
            Number.isFinite(nextElevation)
          ) {
            const gain = nextElevation - prevElevation
            if (gain > 0.7) nextElevationGain += gain
          }
        }

        set({
          points: [...state.points, nextPoint],
          distance: nextDistance,
          currentElevation: Number.isFinite(nextElevation)
            ? nextElevation
            : state.currentElevation,
          elevationGain: nextElevationGain,
          currentSpeedKmh: nextSpeed,
          movementHeading: nextHeading,
          autoPaused: nextAutoPaused,
          splits: nextSplits.length
            ? [...state.splits, ...nextSplits]
            : state.splits,
          geoError: '',
        })
        saveStoredRecording(get())
      },
      () => {
        set({
          geoError:
            'Could not access location. Allow GPS permissions and try again.',
        })
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 10000,
      }
    )
  },

  pauseTracking: () => {
    if (watchId != null) {
      navigator.geolocation.clearWatch(watchId)
      watchId = null
    }
    set({ isTracking: false, autoPaused: false, currentSpeedKmh: 0 })
    saveStoredRecording(get())
    releaseWakeLock()
  },

  reset: () => {
    if (watchId != null) {
      navigator.geolocation.clearWatch(watchId)
      watchId = null
    }
    if (timerId) {
      window.clearInterval(timerId)
      timerId = null
    }
    stationarySince = null
    nextSplitTarget = 1000
    set({
      points: [],
      elapsedSeconds: 0,
      distance: 0,
      isTracking: false,
      autoPaused: false,
      splits: [],
      currentElevation: 0,
      elevationGain: 0,
      currentSpeedKmh: 0,
      movementHeading: null,
      geoError: '',
    })
    clearStoredRecording()
    releaseWakeLock()
  },

  ensureWakeLock: () => {
    if (get().isTracking && !wakeLock) requestWakeLock()
  },
}))
