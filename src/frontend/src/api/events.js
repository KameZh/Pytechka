import { center as turfCenter } from '@turf/turf'
import { BULGARIA_CENTER_COORDINATES } from '../utils/mapDefaults'

const EVENTS_KEY = 'pytechka_cleanup_events_v1'
const FEEDBACK_COUNTS_KEY = 'pytechka_feedback_counts_v1'

function safeReadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

function safeWriteJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

function parseTrailGeojson(geojson) {
  if (!geojson) return null

  try {
    const parsed = typeof geojson === 'string' ? JSON.parse(geojson) : geojson
    if (!parsed || typeof parsed !== 'object' || !parsed.type) return null

    if (
      parsed.type === 'FeatureCollection' ||
      parsed.type === 'Feature' ||
      parsed.type === 'LineString' ||
      parsed.type === 'MultiLineString'
    ) {
      return parsed
    }

    return null
  } catch {
    return null
  }
}

function computeCenterCoordinates(geojson) {
  const parsed = parseTrailGeojson(geojson)
  if (!parsed) return [...BULGARIA_CENTER_COORDINATES]

  try {
    const centered = turfCenter(parsed)
    const coords = centered?.geometry?.coordinates
    if (!Array.isArray(coords) || coords.length < 2) {
      return [...BULGARIA_CENTER_COORDINATES]
    }

    return [Number(coords[0]), Number(coords[1])]
  } catch {
    return [...BULGARIA_CENTER_COORDINATES]
  }
}

function resolveTrailCenterCoordinates(trail) {
  const candidates = [
    trail?.stats?.centerCoordinates,
    trail?.centerCoordinates,
    trail?.startCoordinates,
    trail?.stats?.startCoordinates,
  ]

  for (const candidate of candidates) {
    if (
      Array.isArray(candidate) &&
      candidate.length >= 2 &&
      Number.isFinite(Number(candidate[0])) &&
      Number.isFinite(Number(candidate[1]))
    ) {
      return [Number(candidate[0]), Number(candidate[1])]
    }
  }

  return computeCenterCoordinates(trail?.geojson)
}

function formatDateBadge(date) {
  return new Intl.DateTimeFormat('bg-BG', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(date)
}

function toDateKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function nextWeekendCandidates(limit = 4) {
  const results = []
  const pointer = new Date()

  while (results.length < limit) {
    pointer.setDate(pointer.getDate() + 1)
    const day = pointer.getDay()

    if (day === 0 || day === 6) {
      const candidate = new Date(pointer)
      candidate.setHours(10, 0, 0, 0)
      results.push(candidate)
    }
  }

  return results
}

function summarizeForecastEntry(entry) {
  const weatherMain = entry.weather?.[0]?.main || 'Clear'
  const temp = Number(entry.main?.temp ?? 0)
  const wind = Number(entry.wind?.speed ?? 0)
  const rain = Number(entry.rain?.['3h'] ?? 0)

  return { weatherMain, temp, wind, rain }
}

function resolveTrailId(trail) {
  return String(trail?.id || trail?._id || '').trim()
}

function scoreForecast({ weatherMain, temp, wind, rain }) {
  let score = 0
  score += Math.max(0, rain) * 2
  score += Math.max(0, wind - 8) * 1.5
  score += Math.max(0, 5 - temp)
  score += Math.max(0, temp - 28)

  if (weatherMain === 'Thunderstorm') score += 8
  if (weatherMain === 'Snow') score += 6

  return score
}

async function chooseSuggestedWeekend({ latitude, longitude, weatherApiKey }) {
  const candidates = nextWeekendCandidates(4)
  const fallbackDate = candidates[0]
  const lat = Number(latitude)
  const lon = Number(longitude)
  const normalizedApiKey = String(weatherApiKey || '').trim()

  if (!normalizedApiKey || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return {
      suggestedDateISO: fallbackDate.toISOString(),
      aiBadge: `${formatDateBadge(fallbackDate)} · Weekend pick`,
      weatherSummary: 'OpenWeather key missing - using first upcoming weekend.',
    }
  }

  try {
    const query = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      units: 'metric',
      appid: normalizedApiKey,
    })

    const response = await fetch(
      `https://api.openweathermap.org/data/2.5/forecast?${query.toString()}`
    )

    if (!response.ok) {
      throw new Error(`OpenWeather request failed: ${response.status}`)
    }

    const payload = await response.json()
    const list = Array.isArray(payload.list) ? payload.list : []

    const byDate = new Map()
    for (const item of list) {
      if (!item?.dt) continue
      const date = new Date(item.dt * 1000)
      const key = toDateKey(date)
      const itemHour = date.getHours()

      const current = byDate.get(key)
      const next = summarizeForecastEntry(item)
      const distanceToNoon = Math.abs(itemHour - 12)

      if (!current || distanceToNoon < current.distanceToNoon) {
        byDate.set(key, { ...next, distanceToNoon })
      }
    }

    const scored = candidates
      .map((candidate) => {
        const key = toDateKey(candidate)
        const forecast = byDate.get(key)
        if (!forecast) return null

        return {
          candidate,
          forecast,
          score: scoreForecast(forecast),
        }
      })
      .filter(Boolean)

    if (!scored.length) {
      return {
        suggestedDateISO: fallbackDate.toISOString(),
        aiBadge: `${formatDateBadge(fallbackDate)} · Weekend pick`,
        weatherSummary: 'No weekend forecast yet - fallback to next weekend.',
      }
    }

    scored.sort((a, b) => a.score - b.score)
    const winner = scored[0]

    return {
      suggestedDateISO: winner.candidate.toISOString(),
      aiBadge: `${formatDateBadge(winner.candidate)} · Weather pick`,
      weatherSummary: `${Math.round(winner.forecast.temp)}°C, ${winner.forecast.weatherMain.toLowerCase()}, wind ${winner.forecast.wind.toFixed(1)} m/s`,
    }
  } catch {
    return {
      suggestedDateISO: fallbackDate.toISOString(),
      aiBadge: `${formatDateBadge(fallbackDate)} · Weekend pick`,
      weatherSummary: 'Weather service unavailable - fallback to next weekend.',
    }
  }
}

function cleanupPurpose(name) {
  return `Community cleanup for ${name}: remove litter, report hazards, and restore safe trail conditions.`
}

function sortEvents(events) {
  return [...events].sort((a, b) => {
    const aDate = new Date(a.suggestedDateISO).getTime()
    const bDate = new Date(b.suggestedDateISO).getTime()
    return aDate - bDate
  })
}

function normalizeParticipant(profile) {
  const name =
    profile?.name?.trim() ||
    profile?.username?.trim() ||
    profile?.email?.trim() ||
    'Anonymous volunteer'

  return {
    userId: String(profile.userId),
    name,
    imageUrl: profile.imageUrl || '',
  }
}

export function listCleanupEvents() {
  const items = safeReadJson(EVENTS_KEY, [])
  return sortEvents(Array.isArray(items) ? items : [])
}

export function getFeedbackCountSnapshot() {
  const counts = safeReadJson(FEEDBACK_COUNTS_KEY, {})
  return counts && typeof counts === 'object' ? counts : {}
}

export async function syncCleanupEventsFromTrails({
  trails = [],
  weatherApiKey = '',
}) {
  const existing = listCleanupEvents()
  const feedbackCounts = getFeedbackCountSnapshot()
  const routeIdsWithEvent = new Set(
    existing
      .filter((event) => !['completed', 'cancelled'].includes(event.status))
      .map((event) => String(event.routeId))
  )

  const created = []
  const updated = []
  const trailsByRouteId = new Map(
    trails
      .map((trail) => [resolveTrailId(trail), trail])
      .filter(([routeId]) => Boolean(routeId))
  )

  const shouldRefreshWeather = String(weatherApiKey || '').trim().length > 0

  if (shouldRefreshWeather) {
    for (const event of existing) {
      if (!event || !['scheduled', 'active'].includes(event.status)) continue

      const weatherSummary = String(event.weatherSummary || '').toLowerCase()
      const needsWeatherRefresh =
        weatherSummary.includes('fallback') ||
        weatherSummary.includes('missing') ||
        weatherSummary.includes('unavailable')

      if (!needsWeatherRefresh) continue

      const sourceTrail = trailsByRouteId.get(String(event.routeId || ''))
      if (!sourceTrail) continue

      const centerCoordinates = Array.isArray(event.centerCoordinates)
        ? event.centerCoordinates
        : resolveTrailCenterCoordinates(sourceTrail)

      const schedule = await chooseSuggestedWeekend({
        latitude: centerCoordinates[1],
        longitude: centerCoordinates[0],
        weatherApiKey,
      })

      updated.push({
        ...event,
        suggestedDateISO: schedule.suggestedDateISO,
        aiBadge: schedule.aiBadge,
        weatherSummary: schedule.weatherSummary,
        centerCoordinates,
        updatedAt: new Date().toISOString(),
      })
    }
  }

  for (const trail of trails) {
    const routeId = resolveTrailId(trail)
    if (!routeId) continue

    const issueCount = Number(
      feedbackCounts[routeId] ??
        trail.issueReports ??
        trail.issueCount ??
        trail.reportsCount ??
        0
    )

    if (issueCount <= 3) continue
    if (routeIdsWithEvent.has(routeId)) continue

    const centerCoordinates = resolveTrailCenterCoordinates(trail)
    const schedule = await chooseSuggestedWeekend({
      latitude: centerCoordinates[1],
      longitude: centerCoordinates[0],
      weatherApiKey,
    })

    const nowIso = new Date().toISOString()
    created.push({
      id: `evt-${routeId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      routeId,
      routeName: trail.name || `Route ${routeId}`,
      region: trail.region || 'Unknown region',
      purpose: cleanupPurpose(trail.name || `Route ${routeId}`),
      issueCount,
      status: 'scheduled',
      suggestedDateISO: schedule.suggestedDateISO,
      aiBadge: schedule.aiBadge,
      weatherSummary: schedule.weatherSummary,
      centerCoordinates,
      participants: [],
      createdAt: nowIso,
      updatedAt: nowIso,
      trailSnapshot: {
        id: routeId,
        name: trail.name,
        region: trail.region,
        difficulty: trail.difficulty,
        shortDescription: trail.shortDescription,
        distance: trail.distance,
        elevation: trail.elevation,
        duration: trail.duration,
        geojson: trail.geojson,
        image: trail.image,
      },
    })

    routeIdsWithEvent.add(routeId)
  }

  if (!created.length && !updated.length) {
    return existing
  }

  const updatedById = new Map(updated.map((event) => [event.id, event]))
  const mergedExisting = existing.map(
    (event) => updatedById.get(event.id) || event
  )

  const next = sortEvents([...mergedExisting, ...created])
  safeWriteJson(EVENTS_KEY, next)
  return next
}

export function toggleCleanupEventSignup({ eventId, userProfile }) {
  if (!userProfile?.userId) {
    throw new Error('User profile is required for signup')
  }

  const events = listCleanupEvents()
  const eventIndex = events.findIndex((event) => event.id === eventId)

  if (eventIndex === -1) {
    throw new Error('Event not found')
  }

  const participant = normalizeParticipant(userProfile)
  const target = events[eventIndex]
  const participants = Array.isArray(target.participants)
    ? [...target.participants]
    : []

  const existingParticipantIndex = participants.findIndex(
    (entry) => String(entry.userId) === String(participant.userId)
  )

  if (existingParticipantIndex >= 0) {
    participants.splice(existingParticipantIndex, 1)
  } else {
    participants.push(participant)
  }

  const updated = {
    ...target,
    participants,
    updatedAt: new Date().toISOString(),
  }

  const next = [...events]
  next[eventIndex] = updated
  safeWriteJson(EVENTS_KEY, next)

  return updated
}
