import { useRef, useCallback, useEffect, useMemo, useState } from 'react'
import 'mapbox-gl/dist/mapbox-gl.css'
import Map, { Source, Layer, Marker } from 'react-map-gl/mapbox'
import {
  bbox as turfBbox,
  circle as turfCircle,
  nearestPointOnLine,
  point as turfPoint,
} from '@turf/turf'
import { useAuth } from '@clerk/clerk-react'
import { useNavigate } from 'react-router-dom'

import { useMapStore } from '../../store/mapStore'
import {
  fetchMapTrails,
  fetchMapTrailsGeojson,
  fetchTrailStartReadiness,
  completeTrailFromMap,
  fetchHuts,
} from '../../api/maps'
import {
  fetchPings,
  createPing,
  createPhotoPing,
  votePingGone,
  fetchClusters,
  voteClusterGone,
} from '../../api/pings'
import {
  fetchCurrentWeather,
  fetchWeatherForecast,
  hasWeatherApiKey,
} from '../../api/weather'
import { fetchTrailById } from '../../api/trails'
import { buildCenteredView } from '../../utils/mapDefaults'
import MapControls from './MapControls'
import LiveCompass from './LiveCompass'
import EmergencyButton from './EmergencyButton'
import HutMarkerButton from './HutMarkerButton'
import RoutePreviewCard from '../layout/RoutePreviewCard'
import HutPreviewCard from '../layout/HutPreviewCard'
import OfficialTrailCard from '../layout/OfficialTrailCard'
import CameraButton from '../camera/CameraButton'
import PhotoCaptureModal from '../camera/PhotoCaptureModal'
import RouteBuilderForm from '../route/RouteBuilderForm'
import { useOfflineStore } from '../../store/offlineStore'
import { useTrailActivityStore } from '../../store/trailActivityStore'
import {
  fetchTerrainRgbElevation,
} from '../../utils/elevation'
const INITIAL_VIEW = buildCenteredView(7)

const DIFFICULTY_COLOR = {
  easy: '#22c55e',
  moderate: '#f97316',
  hard: '#ef4444',
  extreme: '#7f1d1d',
}

const DIFFICULTY_LABEL = {
  easy: 'Easy',
  moderate: 'Moderate',
  hard: 'Hard',
  extreme: 'Extreme',
}

const TRAIL_MARK_COLOR = {
  red: '#ef4444',
  blue: '#3b82f6',
  green: '#22c55e',
  yellow: '#eab308',
  white: '#e2e8f0',
  black: '#0f172a',
  unmarked: '#6b7280',
}

const TRAIL_MARK_LABEL = {
  red: 'Red Mark',
  blue: 'Blue Mark',
  green: 'Green Mark',
  yellow: 'Yellow Mark',
  white: 'White Mark',
  black: 'Black Mark',
  unmarked: 'Unmarked',
}

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN
const MAPBOX_STYLE_URL = import.meta.env.VITE_MAPBOX_STYLE_URL
const MAPBOX_TILESET_URL = import.meta.env.VITE_MAPBOX_TILESET_URL
const MAPBOX_TILESET_TYPE = (
  import.meta.env.VITE_MAPBOX_TILESET_TYPE || 'vector'
).toLowerCase()
const MAPBOX_TILESET_SOURCE_LAYER = import.meta.env
  .VITE_MAPBOX_TILESET_SOURCE_LAYER
const MAPBOX_TILESET_LINE_COLOR =
  import.meta.env.VITE_MAPBOX_TILESET_LINE_COLOR || '#0ea5e9'
const MAPBOX_TILESET_LINE_WIDTH = Number(
  import.meta.env.VITE_MAPBOX_TILESET_LINE_WIDTH || 3
)

const MAPS_BOTTOM_CARD_OFFSET =
  'max(7.25rem, calc(env(safe-area-inset-bottom, 0px) + 112px))'
const MAP_DRAWER_BOTTOM_GAP =
  'calc(var(--app-bottom-nav-space, 86px) + 10px)'
const USER_FOLLOW_BASE_ZOOM = 14.2
const USER_FOLLOW_TRAIL_ZOOM = 17.8
const TRAIL_VISIBILITY_MIN_ZOOM = 0
const MAPBOX_GEOCODING_ENDPOINT =
  'https://api.mapbox.com/geocoding/v5/mapbox.places'
const MAPBOX_DIRECTIONS_ENDPOINT =
  'https://api.mapbox.com/directions/v5/mapbox/walking'
const MAPBOX_REVERSE_GEOCODING_TYPES =
  'poi,address,place,locality,neighborhood,region'
const DEM_SOURCE_ID = 'mapbox-dem'
const RELIEF_DEM_SOURCE_ID = 'pytechka-relief-dem'
const MONGO_OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i
const PLANNER_ROUTE_SOURCE_ID = 'pytechka-planner-routes'
const PLANNER_AUTH_STORAGE_KEY = 'pytechka.pendingPlannerRoute'
const PLANNER_STATE_STORAGE_KEY = 'pytechka.plannerState'

const asMongoObjectId = (value) => {
  const id = String(value || '').trim()
  return MONGO_OBJECT_ID_PATTERN.test(id) ? id : null
}

const SEGMENT_COLOR_EXPRESSION = [
  'match',
  ['coalesce', ['get', 'colour_type'], ['get', 'difficulty']],
  'red',
  TRAIL_MARK_COLOR.red,
  'blue',
  TRAIL_MARK_COLOR.blue,
  'green',
  TRAIL_MARK_COLOR.green,
  'yellow',
  TRAIL_MARK_COLOR.yellow,
  'white',
  TRAIL_MARK_COLOR.white,
  'black',
  TRAIL_MARK_COLOR.black,
  'unmarked',
  TRAIL_MARK_COLOR.unmarked,
  'easy',
  DIFFICULTY_COLOR.easy,
  'moderate',
  DIFFICULTY_COLOR.moderate,
  'hard',
  DIFFICULTY_COLOR.hard,
  'extreme',
  DIFFICULTY_COLOR.extreme,
  '#64748b',
]

function resolveSegmentColor(segment) {
  const colourType = String(segment?.colourType || '').toLowerCase()
  if (TRAIL_MARK_COLOR[colourType]) return TRAIL_MARK_COLOR[colourType]

  const difficulty = String(segment?.difficulty || '').toLowerCase()
  if (DIFFICULTY_COLOR[difficulty]) return DIFFICULTY_COLOR[difficulty]

  return '#64748b'
}

function resolveSegmentLabel(segment) {
  const colourType = String(segment?.colourType || '').toLowerCase()
  if (TRAIL_MARK_LABEL[colourType]) return TRAIL_MARK_LABEL[colourType]

  const difficulty = String(segment?.difficulty || '').toLowerCase()
  if (DIFFICULTY_LABEL[difficulty]) return DIFFICULTY_LABEL[difficulty]

  return 'Moderate'
}

const TRAIL_SOURCE_ID = 'pytechka-trails'
const TRAIL_LAYER_IDS = {
  unmarked: 'pytechka-trails-unmarked',
  yellow: 'pytechka-trails-yellow',
  green: 'pytechka-trails-green',
  blue: 'pytechka-trails-blue',
  whiteCasing: 'pytechka-trails-white-casing',
  whiteMain: 'pytechka-trails-white-main',
  black: 'pytechka-trails-black',
  red: 'pytechka-trails-red',
  featuredCasing: 'pytechka-trails-featured-casing',
  featuredMain: 'pytechka-trails-featured-main',
  user: 'pytechka-trails-user',
}

const INTERACTIVE_TRAIL_LAYER_IDS = [
  TRAIL_LAYER_IDS.unmarked,
  TRAIL_LAYER_IDS.yellow,
  TRAIL_LAYER_IDS.green,
  TRAIL_LAYER_IDS.blue,
  TRAIL_LAYER_IDS.whiteMain,
  TRAIL_LAYER_IDS.black,
  TRAIL_LAYER_IDS.red,
  TRAIL_LAYER_IDS.featuredMain,
  TRAIL_LAYER_IDS.user,
]

const EMPTY_TRAIL_FEATURE_COLLECTION = {
  type: 'FeatureCollection',
  features: [],
}

const styles = {
  container: {
    position: 'relative',
    width: '100%',
    height: '100%',
    minHeight: 320,
  },
  fallback: {
    position: 'absolute',
    inset: 0,
    display: 'grid',
    placeItems: 'center',
    background: 'linear-gradient(180deg, #0b1220 0%, #0f172a 100%)',
    color: '#fff',
    padding: 16,
    textAlign: 'center',
  },
  fallbackCard: {
    maxWidth: 520,
    background: 'rgba(2, 6, 23, 0.7)',
    border: '1px solid rgba(148,163,184,0.3)',
    borderRadius: 14,
    padding: 16,
  },
  radiusWrap: {
    position: 'absolute',
    left: '50%',
    transform: 'translateX(-50%)',
    bottom: 'calc(env(safe-area-inset-bottom, 0px) + 84px)',
    width: 'min(92vw, 360px)',
    zIndex: 17,
    border: '1px solid rgba(66, 129, 164, 0.36)',
    borderRadius: 14,
    background: 'rgba(12, 20, 32, 0.9)',
    boxShadow: '0 10px 22px rgba(0,1,0,0.3)',
    backdropFilter: 'blur(8px)',
    padding: '9px 10px',
    display: 'grid',
    gap: 6,
  },
  radiusRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  radiusLabel: {
    fontSize: 12,
    color: '#c8dfec',
    fontWeight: 700,
    minWidth: 74,
  },
  radiusValue: {
    fontSize: 12,
    color: '#8de0dc',
    fontWeight: 700,
    minWidth: 54,
    textAlign: 'right',
  },
  radiusInput: {
    flex: 1,
    accentColor: '#48a9a6',
  },
  infoBox: {
    background: 'rgba(2, 6, 23, 0.7)',
    border: '1px solid rgba(148,163,184,0.3)',
    color: '#e2e8f0',
    borderRadius: 10,
    padding: '8px 10px',
    fontSize: 12,
    backdropFilter: 'blur(6px)',
  },
}

const PING_TYPES = {
  junk: { label: 'Junk / Rubbish', marker: 'J', color: '#f59e0b' },
  mud: { label: 'Mud', marker: 'M', color: '#92400e' },
  environmental_danger: {
    label: 'Environmental Danger',
    marker: 'D',
    color: '#dc2626',
  },
  photo: {
    label: 'Photo',
    marker: '📷',
    color: '#8b5cf6',
  },
}

const REPORT_PING_TYPES = Object.fromEntries(
  Object.entries(PING_TYPES).filter(([key]) => key !== 'photo')
)

const PHOTO_CATEGORY_META = {
  viewpoint: { label: 'Viewpoint', color: '#38bdf8' },
  trail_condition: { label: 'Trail condition', color: '#f59e0b' },
  marking: { label: 'Trail mark', color: '#ef4444' },
  water_source: { label: 'Water source', color: '#22c55e' },
  hazard: { label: 'Hazard', color: '#dc2626' },
  memory: { label: 'Memory', color: '#8b5cf6' },
}

const CLUSTER_CONFIG = {
  clutter: {
    label: 'Trash Clutter',
    marker: 'C',
    color: '#f97316',
    votesNeeded: 3,
  },
  event: {
    label: 'Cleanup Event',
    marker: 'E',
    color: '#dc2626',
    votesNeeded: 5,
  },
}

const clusterMarkerStyle = {
  width: 34,
  height: 34,
  borderRadius: '50%',
  display: 'grid',
  placeItems: 'center',
  color: '#ffffff',
  fontSize: 16,
  fontWeight: 900,
  lineHeight: 1,
  cursor: 'pointer',
  border: '2px solid rgba(255, 255, 255, 0.9)',
  boxShadow: '0 4px 12px rgba(0,0,0,0.42)',
  textShadow: '0 1px 2px rgba(0,0,0,0.45)',
}

const pingMarkerStyle = {
  width: 32,
  height: 32,
  borderRadius: '50%',
  display: 'grid',
  placeItems: 'center',
  fontSize: 18,
  cursor: 'pointer',
  border: '2px solid #fff',
  boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
}

const photoMarkerStyle = {
  width: 34,
  height: 34,
  borderRadius: '50%',
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
  border: '2px solid #fff',
  boxShadow: '0 3px 10px rgba(0,0,0,0.4)',
  overflow: 'hidden',
  background: '#8b5cf6',
}

const overlayCard = {
  width: 'min(92vw, 420px)',
  zIndex: 31,
  border: '1px solid rgba(66, 129, 164, 0.5)',
  borderRadius: 14,
  background: 'rgba(17, 26, 40, 0.96)',
  boxShadow: '0 12px 28px rgba(0,1,0,0.45)',
  backdropFilter: 'blur(8px)',
  color: '#e2e8f0',
}

const pingPopupStyle = {
  ...overlayCard,
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: MAP_DRAWER_BOTTOM_GAP,
  width: 'auto',
  transform: 'none',
  margin: '0 10px',
  padding: '16px 18px 18px',
  borderRadius: 22,
  maxHeight:
    'min(68dvh, calc(100dvh - env(safe-area-inset-top, 0px) - var(--app-bottom-nav-space, 86px) - 132px))',
  overflowY: 'auto',
  animation: 'map-drawer-in 180ms ease-out both',
}

const pingBtnBase = {
  padding: '8px 14px',
  borderRadius: 10,
  border: 'none',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
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

function inferColourType({ colourType, osmColour, osmMarking }) {
  const normalized = String(colourType || '')
    .trim()
    .toLowerCase()
  if (
    ['red', 'blue', 'green', 'yellow', 'white', 'black', 'unmarked'].includes(
      normalized
    )
  ) {
    return normalized
  }

  const marking = String(osmMarking || '')
    .trim()
    .toLowerCase()
  if (['no', 'false', 'bad', 'none', 'unmarked'].includes(marking)) {
    return 'unmarked'
  }

  const colour = String(osmColour || '')
    .trim()
    .toLowerCase()
  if (!colour) return 'unmarked'

  if (
    colour.includes('red') ||
    /#(?:e00|d00|dc2626|ff0000|c00)\b/i.test(colour)
  ) {
    return 'red'
  }
  if (colour.includes('blue') || /#(?:00f|2563eb|1d4ed8)\b/i.test(colour)) {
    return 'blue'
  }
  if (
    colour.includes('green') ||
    /#(?:0f0|22c55e|16a34a|008000)\b/i.test(colour)
  ) {
    return 'green'
  }
  if (
    colour.includes('yellow') ||
    /#(?:ff0|ffd700|facc15|eab308)\b/i.test(colour)
  ) {
    return 'yellow'
  }
  if (colour.includes('white') || /#(?:fff|ffffff|f8fafc)\b/i.test(colour)) {
    return 'white'
  }
  if (colour.includes('black') || /#(?:000|000000|111827)\b/i.test(colour)) {
    return 'black'
  }

  return 'unmarked'
}

function extractLineGeometries(geojson) {
  const parsed = parseTrailGeojson(geojson)
  if (!parsed) return []

  if (parsed.type === 'LineString' || parsed.type === 'MultiLineString') {
    return [parsed]
  }

  if (parsed.type === 'Feature') {
    return extractLineGeometries(parsed.geometry)
  }

  if (parsed.type === 'FeatureCollection') {
    return Array.isArray(parsed.features)
      ? parsed.features.flatMap((feature) => extractLineGeometries(feature))
      : []
  }

  return []
}

function normalizeTrailFeatureProperties(properties = {}) {
  const source = String(properties.source || 'user').toLowerCase()
  const ref = String(properties.ref || '').trim()

  return {
    id: String(properties.id || properties.trailId || ''),
    name: String(properties.name || '').trim(),
    name_bg: String(properties.name_bg || '').trim(),
    name_en: String(properties.name_en || '').trim(),
    ref,
    source: ['user', 'osm', 'osm_featured'].includes(source) ? source : 'user',
    difficulty: String(properties.difficulty || 'moderate').toLowerCase(),
    colour_type: inferColourType({
      colourType: properties.colour_type,
      osmColour: properties.osm_colour,
      osmMarking: properties.osm_marking,
    }),
    osm_colour: String(properties.osm_colour || '').trim(),
    osm_marking: String(properties.osm_marking || '').trim(),
    network: String(properties.network || '')
      .trim()
      .toLowerCase(),
    distance: Number(properties.distance || 0),
    elevation_gain: Number(properties.elevation_gain || 0),
    description: String(properties.description || '').trim(),
  }
}

function normalizeTrailGeojsonCollection(collection) {
  if (!collection || collection.type !== 'FeatureCollection') {
    return { type: 'FeatureCollection', features: [] }
  }

  const features = (
    Array.isArray(collection.features) ? collection.features : []
  )
    .map((feature) => {
      if (!feature || feature.type !== 'Feature') return null
      const geometry = feature.geometry
      if (!geometry) return null
      if (
        geometry.type !== 'LineString' &&
        geometry.type !== 'MultiLineString'
      ) {
        return null
      }

      return {
        type: 'Feature',
        geometry,
        properties: normalizeTrailFeatureProperties(feature.properties || {}),
      }
    })
    .filter(Boolean)

  return { type: 'FeatureCollection', features }
}

function buildTrailGeojsonFromTrails(trails = []) {
  const features = trails.flatMap((trail) => {
    const geometries = [trail.geojson, trail.geom, trail.mapGeometry]
      .filter(Boolean)
      .flatMap((geometry) => extractLineGeometries(geometry))
    if (!geometries.length) return []

    const source = String(trail.source || 'user').toLowerCase()
    const trailRef = String(trail.ref || '').trim()

    return geometries.map((geometry) => ({
      type: 'Feature',
      geometry,
      properties: normalizeTrailFeatureProperties({
        id: String(trail._id || trail.id || ''),
        name: trail.name,
        name_bg: trail.name_bg,
        name_en: trail.name_en,
        ref: trailRef,
        source,
        difficulty: trail.difficulty,
        colour_type: trail.colour_type,
        osm_colour: trail.osm_colour,
        osm_marking: trail.osm_marking,
        network: trail.network,
        distance: Number(trail.stats?.distance || 0) / 1000,
        elevation_gain: Number(trail.stats?.elevationGain || 0),
        description: trail.description,
      }),
    }))
  })

  return {
    type: 'FeatureCollection',
    features,
  }
}

function extractLineCoordinates(geojson) {
  const parsed = parseTrailGeojson(geojson)
  if (!parsed) return []

  if (parsed.type === 'LineString') {
    return Array.isArray(parsed.coordinates) ? parsed.coordinates : []
  }

  if (parsed.type === 'MultiLineString') {
    return Array.isArray(parsed.coordinates)
      ? parsed.coordinates.flatMap((line) => (Array.isArray(line) ? line : []))
      : []
  }

  if (parsed.type === 'Feature') {
    return extractLineCoordinates(parsed.geometry)
  }

  if (parsed.type === 'FeatureCollection') {
    return Array.isArray(parsed.features)
      ? parsed.features.flatMap((feature) =>
        extractLineCoordinates(feature?.geometry)
      )
      : []
  }

  return []
}

function getTrailGeometry(trail) {
  if (!trail || typeof trail !== 'object') return null
  return trail.geojson || trail.geom || trail.mapGeometry || null
}

function deriveTrailStartCoordinates(trail) {
  const fromTrail = Array.isArray(trail?.startCoordinates)
    ? trail.startCoordinates
    : Array.isArray(trail?.stats?.startCoordinates)
      ? trail.stats.startCoordinates
      : null

  if (fromTrail && fromTrail.length === 2) {
    return [Number(fromTrail[0]), Number(fromTrail[1])]
  }

  const coords = extractLineCoordinates(trail?.geojson)
  if (!coords.length) return null

  return [Number(coords[0][0]), Number(coords[0][1])]
}

function haversineMeters([lon1, lat1], [lon2, lat2]) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function bearingDegrees([lon1, lat1], [lon2, lat2]) {
  const toRad = (d) => (d * Math.PI) / 180
  const toDeg = (r) => (r * 180) / Math.PI
  const startLat = toRad(lat1)
  const endLat = toRad(lat2)
  const deltaLon = toRad(lon2 - lon1)
  const y = Math.sin(deltaLon) * Math.cos(endLat)
  const x =
    Math.cos(startLat) * Math.sin(endLat) -
    Math.sin(startLat) * Math.cos(endLat) * Math.cos(deltaLon)

  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

function pathLengthMeters(pathCoordinates) {
  if (!Array.isArray(pathCoordinates) || pathCoordinates.length < 2) return 0

  let total = 0
  for (let i = 1; i < pathCoordinates.length; i += 1) {
    const prev = pathCoordinates[i - 1]
    const current = pathCoordinates[i]
    total += haversineMeters(
      [Number(prev[0]), Number(prev[1])],
      [Number(current[0]), Number(current[1])]
    )
  }
  return total
}

function resolveTrailTotalDistanceMeters(trail, pathCoordinates) {
  const statsDistance = Number(trail?.stats?.distance)
  if (Number.isFinite(statsDistance) && statsDistance > 0) {
    return statsDistance
  }

  const statsDistanceMeters = Number(trail?.stats?.distanceMeters)
  if (Number.isFinite(statsDistanceMeters) && statsDistanceMeters > 0) {
    return statsDistanceMeters
  }

  const directDistanceMeters = Number(trail?.distanceMeters)
  if (Number.isFinite(directDistanceMeters) && directDistanceMeters > 0) {
    return directDistanceMeters
  }

  const directDistanceKm = Number(trail?.distance)
  if (Number.isFinite(directDistanceKm) && directDistanceKm > 0) {
    return directDistanceKm * 1000
  }

  return pathLengthMeters(pathCoordinates)
}

function resolveTrailElevationMeters(trail) {
  const statsElevation = Number(trail?.stats?.elevationGain)
  if (Number.isFinite(statsElevation)) return statsElevation

  const directElevation = Number(trail?.elevation)
  if (Number.isFinite(directElevation)) return directElevation

  return null
}

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds) || 0)
  const hh = Math.floor(total / 3600)
  const mm = Math.floor((total % 3600) / 60)
  const ss = total % 60

  if (hh > 0) {
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(
      ss
    ).padStart(2, '0')}`
  }

  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

function formatPlannerDuration(seconds) {
  const totalMinutes = Math.max(1, Math.round((Number(seconds) || 0) / 60))
  if (totalMinutes < 60) return `${totalMinutes} min`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`
}

function inferPlannerDifficulty(distanceMeters, elevationGain = 0, maxGrade = 0) {
  const km = Number(distanceMeters || 0) / 1000
  const gain = Number(elevationGain || 0)
  const grade = Number(maxGrade || 0)
  let score = 0

  if (km >= 28) score += 4
  else if (km >= 16) score += 3
  else if (km >= 7) score += 2
  else if (km >= 3) score += 1

  if (gain >= 1600) score += 4
  else if (gain >= 900) score += 3
  else if (gain >= 450) score += 2
  else if (gain >= 180) score += 1

  if (grade >= 0.35) score += 3
  else if (grade >= 0.25) score += 2
  else if (grade >= 0.15) score += 1

  if (score >= 7) return 'extreme'
  if (score >= 5) return 'hard'
  if (score >= 2) return 'moderate'
  return 'easy'
}

function formatPlannerMeters(value, fallback = '--') {
  const meters = Number(value)
  if (!Number.isFinite(meters)) return fallback
  return `${Math.round(meters)} m`
}

function formatPlannerDistance(value, fallback = '--') {
  const meters = Number(value)
  if (!Number.isFinite(meters) || meters <= 0) return fallback
  return `${(meters / 1000).toFixed(meters >= 10000 ? 1 : 2)} km`
}

function formatPlannerGrade(value) {
  const grade = Number(value)
  if (!Number.isFinite(grade) || grade <= 0) return '--'
  return `${Math.round(grade * 100)}%`
}

function offsetCoordinate([lng, lat], eastMeters, northMeters) {
  const safeLat = Number(lat)
  const latRad = (safeLat * Math.PI) / 180
  const lngMeters = Math.max(1, 111320 * Math.cos(latRad))
  return [
    Number(lng) + eastMeters / lngMeters,
    safeLat + northMeters / 110540,
  ]
}

function buildAlternativeWaypointSets(routePoints) {
  if (!Array.isArray(routePoints) || routePoints.length < 2) return []
  const start = routePoints[0]
  const destination = routePoints[routePoints.length - 1]
  const fixedStops = routePoints.slice(1, -1)
  const directDistance = haversineMeters(start, destination)
  if (!Number.isFinite(directDistance) || directDistance < 800) return []

  const mid = [
    (Number(start[0]) + Number(destination[0])) / 2,
    (Number(start[1]) + Number(destination[1])) / 2,
  ]
  const eastMeters =
    (Number(destination[0]) - Number(start[0])) *
    111320 *
    Math.cos((((Number(start[1]) + Number(destination[1])) / 2) * Math.PI) / 180)
  const northMeters = (Number(destination[1]) - Number(start[1])) * 110540
  const length = Math.hypot(eastMeters, northMeters)
  if (!Number.isFinite(length) || length <= 0) return []

  const normalEast = -northMeters / length
  const normalNorth = eastMeters / length
  const offset = Math.min(4500, Math.max(500, directDistance * 0.2))

  return [
    [start, ...fixedStops, offsetCoordinate(mid, normalEast * offset, normalNorth * offset), destination],
    [start, offsetCoordinate(mid, normalEast * offset * 0.72, normalNorth * offset * 0.72), ...fixedStops, destination],
    [start, ...fixedStops, offsetCoordinate(mid, -normalEast * offset, -normalNorth * offset), destination],
    [start, offsetCoordinate(mid, -normalEast * offset * 0.72, -normalNorth * offset * 0.72), ...fixedStops, destination],
  ]
}

function samplePlannerCoordinates(coordinates = [], limit = 120) {
  if (!Array.isArray(coordinates) || coordinates.length <= limit) {
    return (coordinates || []).map((point, index) => ({ point, index }))
  }
  const lastIndex = coordinates.length - 1
  const samples = []
  for (let i = 0; i < limit; i += 1) {
    const index = Math.round((i / (limit - 1)) * lastIndex)
    samples.push({ point: coordinates[index], index })
  }
  return samples
}

async function fetchPlannerContourElevation([lng, lat]) {
  const terrainRgbElevation = await fetchTerrainRgbElevation(lng, lat, MAPBOX_TOKEN)
  if (Number.isFinite(terrainRgbElevation)) return terrainRgbElevation

  if (!MAPBOX_TOKEN) return null
  const url =
    `https://api.mapbox.com/v4/mapbox.mapbox-terrain-v2/tilequery/` +
    `${Number(lng)},${Number(lat)}.json?layers=contour&limit=1&radius=250&access_token=${MAPBOX_TOKEN}`
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const payload = await response.json()
    const feature = Array.isArray(payload?.features) ? payload.features[0] : null
    const elevation = Number(feature?.properties?.ele ?? feature?.properties?.elevation)
    return Number.isFinite(elevation) ? elevation : null
  } catch {
    return null
  }
}

function summarizePlannerElevationSamples(samples = []) {
  if (!Array.isArray(samples) || samples.length < 2) return null
  let elevationGain = 0
  let elevationLoss = 0
  let highestPoint = samples[0].elevation
  let lowestPoint = samples[0].elevation
  let maxGrade = 0
  let distance = 0
  const elevationProfile = [
    {
      index: Number.isFinite(Number(samples[0].index)) ? Number(samples[0].index) : 0,
      distance: 0,
      elevation: Math.round(samples[0].elevation),
    },
  ]

  for (let i = 1; i < samples.length; i += 1) {
    const previous = samples[i - 1]
    const current = samples[i]
    const diff = current.elevation - previous.elevation
    const stepDistance = haversineMeters(previous.point, current.point)
    distance += stepDistance
    if (diff > 0) elevationGain += diff
    if (diff < 0) elevationLoss += Math.abs(diff)
    highestPoint = Math.max(highestPoint, current.elevation)
    lowestPoint = Math.min(lowestPoint, current.elevation)
    if (stepDistance >= 20) {
      maxGrade = Math.max(maxGrade, Math.abs(diff) / stepDistance)
    }
    elevationProfile.push({
      index: Number.isFinite(Number(current.index)) ? Number(current.index) : i,
      distance: Math.round(distance),
      elevation: Math.round(current.elevation),
    })
  }

  return {
    elevationGain,
    elevationLoss,
    highestPoint,
    lowestPoint,
    maxGrade,
    elevationProfile,
  }
}

function summarizePlannerRoute(route, routePoints = [], map = null) {
  const coordinates = route?.geometry?.coordinates || []
  const distance = Number(route?.distance || pathLengthMeters(coordinates))
  const duration = Number(route?.duration || 0)
  const directDistance =
    routePoints.length >= 2
      ? routePoints.slice(1).reduce((total, point, index) => {
          return total + haversineMeters(routePoints[index], point)
        }, 0)
      : 0

  let elevationGain = null
  let elevationLoss = null
  let highestPoint = null
  let lowestPoint = null
  let maxGrade = null

  if (map && coordinates.length >= 2 && typeof map.queryTerrainElevation === 'function') {
    const step = Math.max(1, Math.ceil(coordinates.length / 90))
    const samples = []
    for (let i = 0; i < coordinates.length; i += step) {
      const point = coordinates[i]
      const elevation = map.queryTerrainElevation(point, { exaggerated: false })
      if (Number.isFinite(elevation)) {
        samples.push({ point, elevation: Number(elevation), index: i })
      }
    }
    const last = coordinates[coordinates.length - 1]
    if (samples[samples.length - 1]?.index !== coordinates.length - 1) {
      const elevation = map.queryTerrainElevation(last, { exaggerated: false })
      if (Number.isFinite(elevation)) {
        samples.push({ point: last, elevation: Number(elevation), index: coordinates.length - 1 })
      }
    }

    if (samples.length >= 2) {
      elevationGain = 0
      elevationLoss = 0
      highestPoint = samples[0].elevation
      lowestPoint = samples[0].elevation
      maxGrade = 0

      for (let i = 1; i < samples.length; i += 1) {
        const previous = samples[i - 1]
        const current = samples[i]
        const diff = current.elevation - previous.elevation
        const stepDistance = haversineMeters(previous.point, current.point)
        if (diff > 0) elevationGain += diff
        if (diff < 0) elevationLoss += Math.abs(diff)
        highestPoint = Math.max(highestPoint, current.elevation)
        lowestPoint = Math.min(lowestPoint, current.elevation)
        if (stepDistance >= 20) {
          maxGrade = Math.max(maxGrade, Math.abs(diff) / stepDistance)
        }
      }
    }
  }

  const naismithDuration =
    Number.isFinite(elevationGain) && elevationGain !== null
      ? Math.round((distance / 1000 / 4 + elevationGain / 600) * 3600)
      : duration

  const difficulty = inferPlannerDifficulty(distance, elevationGain || 0, maxGrade || 0)
  const routeRatio =
    directDistance > 0 && Number.isFinite(distance) ? distance / directDistance : null

  return {
    distance,
    duration,
    directDistance,
    routeRatio,
    elevationGain,
    elevationLoss,
    highestPoint,
    lowestPoint,
    maxGrade,
    naismithDuration,
    difficulty,
    pointCount: coordinates.length,
  }
}

async function enrichPlannerRouteTelemetry(route, routePoints = [], map = null) {
  const base = summarizePlannerRoute(route, routePoints, null)

  const coordinates = route?.geometry?.coordinates || []
  const sampled = samplePlannerCoordinates(coordinates)
  let samples = (
    await Promise.all(
      sampled.map(async ({ point, index }) => ({
        point,
        index,
        elevation: await fetchTerrainRgbElevation(point?.[0], point?.[1], MAPBOX_TOKEN),
      }))
    )
  ).filter((sample) => Number.isFinite(sample.elevation))
  if (samples.length < 2) {
    samples = (
      await Promise.all(
        sampled.map(async ({ point, index }) => ({
          point,
          index,
          elevation: await fetchPlannerContourElevation(point),
        }))
      )
    ).filter((sample) => Number.isFinite(sample.elevation))
  }

  const elevation = summarizePlannerElevationSamples(samples)
  if (!elevation) return base

  const naismithDuration = Math.round(
    (Number(base.distance || 0) / 1000 / 4 + elevation.elevationGain / 600) *
      3600
  )
  const difficulty = inferPlannerDifficulty(
    base.distance,
    elevation.elevationGain,
    elevation.maxGrade
  )

  return {
    ...base,
    ...elevation,
    naismithDuration,
    difficulty,
  }
}

function makePointLabel(point, fallback = 'Selected point') {
  const label = String(point?.label || point?.placeName || '').trim()
  if (label) return label
  const lng = Number(point?.coordinates?.[0])
  const lat = Number(point?.coordinates?.[1])
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return fallback
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
}

function makePlannerPoint(coordinates, label = '') {
  const lng = Number(coordinates?.[0])
  const lat = Number(coordinates?.[1])
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
  return {
    id: `planner-point-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    coordinates: [lng, lat],
    label,
  }
}

function buildPlannerRouteFeatures(routes, selectedIndex) {
  if (!Array.isArray(routes) || !routes.length) return null
  const features = routes
    .map((route, index) => {
      const geometry = route?.geometry
      if (!geometry?.coordinates?.length) return null
      return {
        type: 'Feature',
        properties: {
          index,
          selected: index === selectedIndex,
          distance: Number(route.distance || 0),
          duration: Number(route.duration || 0),
        },
        geometry,
      }
    })
    .filter(Boolean)

  if (!features.length) return null
  return { type: 'FeatureCollection', features }
}

function buildPlannerTrail(route, { start, destination, waypoints = [] } = {}) {
  const coordinates = route?.geometry?.coordinates
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null

  const telemetry = route.telemetry || summarizePlannerRoute(route, [
    start?.coordinates,
    ...waypoints.map((point) => point?.coordinates),
    destination?.coordinates,
  ].filter(Boolean))
  const distance = Math.round(Number(telemetry.distance || route.distance || pathLengthMeters(coordinates)))
  const duration = Math.round(Number(telemetry.naismithDuration || telemetry.duration || route.duration || 0))
  const difficulty = telemetry.difficulty || inferPlannerDifficulty(
    distance,
    telemetry.elevationGain || 0,
    telemetry.maxGrade || 0
  )
  const name = `Custom route to ${makePointLabel(destination, 'destination')}`
  const highestPoint = Number.isFinite(telemetry.highestPoint)
    ? `${Math.round(telemetry.highestPoint)} m`
    : ''

  return {
    localId: `planner-route-${Date.now()}`,
    source: 'local_draft',
    name,
    region: 'Custom map route',
    difficulty,
    description:
      `Generated from Mapbox walking directions. ${formatPlannerDistance(
        distance
      )}, estimated hiking time ${formatPlannerDuration(duration)}.`,
    equipment: 'Normal hiking equipment, charged phone, offline map recommended.',
    resources: 'Carry water and verify trail conditions before leaving.',
    geojson: {
      type: 'Feature',
      geometry: route.geometry,
      properties: {
        source: 'planner',
        name,
      },
    },
    stats: {
      distance,
      duration,
      elevationGain: Number.isFinite(telemetry.elevationGain)
        ? Math.round(telemetry.elevationGain)
        : undefined,
      elevationLoss: Number.isFinite(telemetry.elevationLoss)
        ? Math.round(telemetry.elevationLoss)
        : undefined,
      highestPoint: Number.isFinite(telemetry.highestPoint)
        ? Math.round(telemetry.highestPoint)
        : undefined,
      lowestPoint: Number.isFinite(telemetry.lowestPoint)
        ? Math.round(telemetry.lowestPoint)
        : undefined,
      maxGrade: Number.isFinite(telemetry.maxGrade) ? telemetry.maxGrade : undefined,
      elevationProfile: Array.isArray(telemetry.elevationProfile)
        ? telemetry.elevationProfile
        : undefined,
      directDistance: Number.isFinite(telemetry.directDistance)
        ? Math.round(telemetry.directDistance)
        : undefined,
      routeRatio: Number.isFinite(telemetry.routeRatio) ? telemetry.routeRatio : undefined,
      mapboxDuration: Math.round(Number(telemetry.duration || route.duration || 0)),
      pointCount: telemetry.pointCount || coordinates.length,
      startCoordinates: coordinates[0],
      endCoordinates: coordinates[coordinates.length - 1],
      centerCoordinates: coordinates[Math.floor(coordinates.length / 2)],
    },
    startCoordinates: coordinates[0],
    endCoordinates: coordinates[coordinates.length - 1],
    startPoint: makePointLabel(start, 'Start point'),
    endPoint: makePointLabel(destination, 'Destination'),
    highestPoint,
    trailMarks: [
      {
        name: 'Generated walking route',
        description:
          waypoints.length > 0
            ? `Route passes through ${waypoints.length} selected waypoint${waypoints.length === 1 ? '' : 's'}.`
            : 'Generated point-to-point walking route.',
        colourType: 'unmarked',
        startIndex: 0,
        endIndex: coordinates.length - 1,
      },
    ],
  }
}

function sanitizeTrailMarkSegment(segment, maxIndex) {
  const startIndex = Math.max(
    0,
    Math.min(maxIndex, Number(segment?.startIndex || 0))
  )
  const endIndex = Math.max(
    startIndex,
    Math.min(maxIndex, Number(segment?.endIndex || maxIndex))
  )

  const colourType = String(segment?.colourType || segment?.colour_type || '')
    .toLowerCase()
    .trim()
  if (!TRAIL_MARK_COLOR[colourType]) return null

  return {
    name: String(segment?.name || 'Marked sector'),
    difficulty: 'moderate',
    colourType,
    description:
      String(segment?.description || '').trim() ||
      `Creator mark: ${TRAIL_MARK_LABEL[colourType] || colourType}`,
    estimatedTime: String(segment?.estimatedTime || ''),
    startIndex,
    endIndex,
  }
}

function sanitizeAiSegment(segment, maxIndex) {
  const startIndex = Math.max(
    0,
    Math.min(maxIndex, Number(segment?.startIndex || 0))
  )
  const endIndex = Math.max(
    startIndex,
    Math.min(maxIndex, Number(segment?.endIndex || maxIndex))
  )

  return {
    name: String(segment?.name || 'Sector'),
    difficulty: String(segment?.difficulty || 'moderate').toLowerCase(),
    colourType: null,
    description: String(segment?.description || ''),
    estimatedTime: String(segment?.estimatedTime || ''),
    startIndex,
    endIndex,
  }
}

function buildSegmentModel(trail, pointCount) {
  const maxIndex = Math.max(0, Number(pointCount) - 1)
  if (maxIndex === 0) {
    return [
      {
        name: 'Sector 1',
        difficulty: String(trail?.difficulty || 'moderate').toLowerCase(),
        colourType: null,
        description: 'Start segment',
        estimatedTime: '',
        startIndex: 0,
        endIndex: 0,
      },
    ]
  }

  const creatorMarks = Array.isArray(trail?.trailMarks) ? trail.trailMarks : []
  if (creatorMarks.length) {
    const normalizedMarks = creatorMarks
      .map((segment) => sanitizeTrailMarkSegment(segment, maxIndex))
      .filter((segment) => segment && segment.endIndex >= segment.startIndex)

    if (normalizedMarks.length) return normalizedMarks
  }

  const aiSegments = Array.isArray(trail?.ai?.segments) ? trail.ai.segments : []
  if (aiSegments.length) {
    const normalized = aiSegments
      .map((segment) => sanitizeAiSegment(segment, maxIndex))
      .filter((segment) => segment.endIndex >= segment.startIndex)

    if (normalized.length) return normalized
  }

  const a = Math.floor(maxIndex * 0.33)
  const b = Math.floor(maxIndex * 0.66)
  const difficulty = String(trail?.difficulty || 'moderate').toLowerCase()

  return [
    {
      name: 'Sector 1',
      difficulty: difficulty === 'extreme' ? 'hard' : 'easy',
      colourType: null,
      description: 'Warm up and establish your pace.',
      estimatedTime: '',
      startIndex: 0,
      endIndex: Math.max(1, a),
    },
    {
      name: 'Sector 2',
      difficulty,
      colourType: null,
      description: 'Main climbing and technical section.',
      estimatedTime: '',
      startIndex: Math.max(1, a + 1),
      endIndex: Math.max(a + 1, b),
    },
    {
      name: 'Sector 3',
      difficulty: difficulty === 'easy' ? 'moderate' : difficulty,
      colourType: null,
      description: 'Final section and descent to finish.',
      estimatedTime: '',
      startIndex: Math.max(b + 1, 0),
      endIndex: maxIndex,
    },
  ]
}

function buildSegmentFeatureCollection(pathCoordinates, segments) {
  if (!Array.isArray(pathCoordinates) || pathCoordinates.length < 2) return null
  if (!Array.isArray(segments) || !segments.length) return null

  const maxIndex = pathCoordinates.length - 1
  const features = segments
    .map((segment, index) => {
      const startIndex = Math.max(
        0,
        Math.min(maxIndex, Number(segment?.startIndex || 0))
      )
      const endIndex = Math.max(
        startIndex,
        Math.min(maxIndex, Number(segment?.endIndex || maxIndex))
      )

      const coords = pathCoordinates
        .slice(startIndex, endIndex + 1)
        .map((point) => [Number(point[0]), Number(point[1])])
        .filter(
          (point) => Number.isFinite(point[0]) && Number.isFinite(point[1])
        )

      if (coords.length < 2) return null

      return {
        type: 'Feature',
        properties: {
          segmentIndex: index,
          name: String(segment?.name || `Segment ${index + 1}`),
          difficulty: String(segment?.difficulty || 'moderate').toLowerCase(),
          colour_type: String(segment?.colourType || '').toLowerCase(),
          estimatedTime: String(segment?.estimatedTime || ''),
          description: String(segment?.description || ''),
          pointCount: endIndex - startIndex + 1,
        },
        geometry: {
          type: 'LineString',
          coordinates: coords,
        },
      }
    })
    .filter(Boolean)

  if (!features.length) return null
  return {
    type: 'FeatureCollection',
    features,
  }
}

function getNearestPathIndex(pathCoordinates, userLocation) {
  if (
    !Array.isArray(pathCoordinates) ||
    !pathCoordinates.length ||
    !userLocation
  ) {
    return -1
  }

  let nearestIndex = -1
  let minDistance = Infinity

  for (let i = 0; i < pathCoordinates.length; i += 1) {
    const point = pathCoordinates[i]
    const d = haversineMeters(
      [Number(point[0]), Number(point[1])],
      [Number(userLocation.longitude), Number(userLocation.latitude)]
    )
    if (d < minDistance) {
      minDistance = d
      nearestIndex = i
    }
  }

  return nearestIndex
}

function getSafetyDecision({ trail, forecast, readiness }) {
  const warnings = Array.isArray(trail?.ai?.warnings) ? trail.ai.warnings : []
  const highWarnings = warnings.filter(
    (entry) => String(entry?.severity || '').toLowerCase() === 'high'
  )
  const mediumWarnings = warnings.filter(
    (entry) => String(entry?.severity || '').toLowerCase() === 'medium'
  )

  const firstForecast =
    Array.isArray(forecast) && forecast.length ? forecast[0] : null
  const weatherMain = String(firstForecast?.condition || '').toLowerCase()
  const wind = Number(firstForecast?.windSpeed || 0)
  const rain = Number(firstForecast?.rainVolume || 0)

  const severeWeather =
    weatherMain.includes('thunder') ||
    weatherMain.includes('snow') ||
    wind >= 12 ||
    rain >= 2.5

  const cautionWeather =
    wind >= 8 || rain >= 0.8 || weatherMain.includes('rain')

  const tooFar = Number(readiness?.distanceToStartMeters || 0) > 1000

  if (tooFar || severeWeather || highWarnings.length > 0) {
    return {
      level: 'high',
      unsafe: true,
      title: 'High Risk',
      summary:
        'Start is not recommended right now. Weather, route warnings, or distance-to-start is outside the safe threshold.',
    }
  }

  if (cautionWeather || mediumWarnings.length > 0) {
    return {
      level: 'medium',
      unsafe: false,
      title: 'Caution',
      summary:
        'Trail can be started, but keep an eye on conditions and follow sector guidance.',
    }
  }

  return {
    level: 'low',
    unsafe: false,
    title: 'Good To Start',
    summary: 'Weather and route signals look stable for starting this trail.',
  }
}

function weatherIconUrl(icon) {
  if (!icon) return ''
  return `https://openweathermap.org/img/wn/${icon}@2x.png`
}

function buildBoundsFromCoordinates(coordinates = []) {
  const valid = coordinates
    .map((coord) => [Number(coord?.[0]), Number(coord?.[1])])
    .filter(
      ([longitude, latitude]) =>
        Number.isFinite(longitude) && Number.isFinite(latitude)
    )

  if (!valid.length) return null

  return valid.reduce(
    (bounds, [longitude, latitude]) => [
      [
        Math.min(bounds[0][0], longitude),
        Math.min(bounds[0][1], latitude),
      ],
      [
        Math.max(bounds[1][0], longitude),
        Math.max(bounds[1][1], latitude),
      ],
    ],
    [
      [valid[0][0], valid[0][1]],
      [valid[0][0], valid[0][1]],
    ]
  )
}
export default function MapView({
  searchQuery = '',
  searchRequest = null,
  initialStartFocus = null,
  onTrailFlowVisibilityChange = null,
  injectedPing = null,
  children,
}) {
  const navigate = useNavigate()
  const { isSignedIn, userId } = useAuth()
  const mapRef = useRef(null)
  const locationWatchRef = useRef(null)
  const hasAutoCenteredOnUserRef = useRef(false)
  const hasAutoFittedTrailsRef = useRef(false)
  const lastCenteredLocationRef = useRef(null)
  const lastCompassLocationRef = useRef(null)
  const compassSyncEnabledRef = useRef(false)
  const trailFollowModeRef = useRef(false)
  const lastActivityPointRef = useRef(null)
  const lastStartReadinessLocationRef = useRef(null)
  const promptedReportsRef = useRef(new Set())
  const initialStartFocusAppliedRef = useRef('')
  const initialTrailSelectionRef = useRef('')
  const skipNextMapClickSelectionRef = useRef(false)
  const processedSearchRequestRef = useRef('')
  const plannerStateRestoredRef = useRef(false)

  const {
    mapStyle,
    terrain3D,
    hillshadeRelief,
    selectedTrail,
    setSelectedTrail,
    trailsVersion,
    huts,
    setHuts,
    selectedHut,
    setSelectedHut,
  } = useMapStore()

  const [trails, setTrails] = useState([])
  const [trailsGeojson, setTrailsGeojson] = useState({
    type: 'FeatureCollection',
    features: [],
  })
  const [loadingTrails, setLoadingTrails] = useState(true)
  const [trailsError, setTrailsError] = useState('')
  const [geoError, setGeoError] = useState('')
  const [mapError, setMapError] = useState('')
  const [styleFailed, setStyleFailed] = useState(false)
  const [mapReady, setMapReady] = useState(false)
  const [selectedOfficialTrail, setSelectedOfficialTrail] = useState(null)
  const [unmarkedWarning, setUnmarkedWarning] = useState('')
  const [isLegendVisible, setIsLegendVisible] = useState(false)
  const [viewState, setViewState] = useState(INITIAL_VIEW)
  const [selectedAreaCenter, setSelectedAreaCenter] = useState(null)
  const [selectedAreaRadiusKm, setSelectedAreaRadiusKm] = useState(8)
  const [areaInsightsEnabled, setAreaInsightsEnabled] = useState(false)
  const [areaInsightsMinimized, setAreaInsightsMinimized] = useState(false)
  const [compassSyncEnabled, setCompassSyncEnabled] = useState(false)
  const [selectedHutPanel, setSelectedHutPanel] = useState('info')
  const [movementHeading, setMovementHeading] = useState(null)

  const [areaWeatherLoading, setAreaWeatherLoading] = useState(false)
  const [areaWeatherError, setAreaWeatherError] = useState('')
  const [areaWeather, setAreaWeather] = useState(null)

  const [startPanelTrail, setStartPanelTrail] = useState(null)
  const [startPanelLoading, setStartPanelLoading] = useState(false)
  const [startPanelError, setStartPanelError] = useState('')
  const [startReadiness, setStartReadiness] = useState(null)
  const [startForecast, setStartForecast] = useState([])
  const [startWeatherNow, setStartWeatherNow] = useState(null)
  const [startHoveredSegment, setStartHoveredSegment] = useState(0)
  const [startUnsafeAcknowledged, setStartUnsafeAcknowledged] = useState(false)
  const [approachRoute, setApproachRoute] = useState(null)
  const [approachSummary, setApproachSummary] = useState(null)
  const [approachLoading, setApproachLoading] = useState(false)
  const [approachError, setApproachError] = useState('')

  const {
    activeTrailSession,
    activityDistanceMeters,
    activityDurationSeconds,
    activityCurrentElevation,
    activityElevationGain,
    currentSectorIndex,
    trackingError: trailTrackingError,
    startTrailActivity,
    clearTrailActivity,
    ensureTrailTracking,
  } = useTrailActivityStore()
  const [showSectorSummary, setShowSectorSummary] = useState(false)

  const [finishModalTrail, setFinishModalTrail] = useState(null)
  const [finishStats, setFinishStats] = useState(null)
  const [finishRating, setFinishRating] = useState(0)
  const [finishComment, setFinishComment] = useState('')
  const [finishSubmitting, setFinishSubmitting] = useState(false)
  const [finishError, setFinishError] = useState('')
  const [finishSuccess, setFinishSuccess] = useState('')

  const [stillTherePrompt, setStillTherePrompt] = useState(null)
  const [stillThereSubmitting, setStillThereSubmitting] = useState(false)

  const [userLocation, setUserLocation] = useState(null)

  const [pings, setPings] = useState([])
  const [pingMode, setPingMode] = useState(false)
  const [pendingPing, setPendingPing] = useState(null)
  const [pingType, setPingType] = useState('junk')
  const [pingDesc, setPingDesc] = useState('')
  const [pingSubmitting, setPingSubmitting] = useState(false)
  const [selectedPing, setSelectedPing] = useState(null)
  const [capturedPhoto, setCapturedPhoto] = useState(null)
  const [showPhotoModal, setShowPhotoModal] = useState(false)

  const {
    offlineTrails,
    offlineHuts,
    offlinePings,
    offlineClusters,
    draftTrails,
    loadOfflineTrails,
    loadOfflineMapData,
    loadDraftTrails,
    saveDraftTrail,
  } = useOfflineStore()

  useEffect(() => {
    loadOfflineTrails()
    loadOfflineMapData()
    loadDraftTrails()
  }, [loadDraftTrails, loadOfflineMapData, loadOfflineTrails])

  useEffect(() => {
    let active = true
    if (offlineHuts.length) setHuts(offlineHuts)
    fetchHuts()
      .then((res) => {
        if (active && Array.isArray(res.data)) {
          setHuts(res.data)
        }
      })
      .catch((err) => {
        if (!offlineHuts.length) console.error('Failed to fetch huts', err)
      })
    return () => {
      active = false
    }
  }, [offlineHuts, setHuts])

  const [clusters, setClusters] = useState([])
  const [selectedCluster, setSelectedCluster] = useState(null)
  const [voteSubmitting, setVoteSubmitting] = useState(false)
  const [searchResultMarker, setSearchResultMarker] = useState(null)
  const [searchMapError, setSearchMapError] = useState('')
  const [plannerOpen, setPlannerOpen] = useState(false)
  const [plannerPickMode, setPlannerPickMode] = useState('inspect')
  const [plannerPointInfo, setPlannerPointInfo] = useState(null)
  const [plannerStart, setPlannerStart] = useState(null)
  const [plannerDestination, setPlannerDestination] = useState(null)
  const [plannerWaypoints, setPlannerWaypoints] = useState([])
  const [plannerRoutes, setPlannerRoutes] = useState([])
  const [selectedPlannerRouteIndex, setSelectedPlannerRouteIndex] = useState(0)
  const [plannerLoading, setPlannerLoading] = useState(false)
  const [plannerSaving, setPlannerSaving] = useState(false)
  const [plannerError, setPlannerError] = useState('')
  const [plannerMessage, setPlannerMessage] = useState('')
  const [plannerRouteMode, setPlannerRouteMode] = useState(false)
  const [plannerOptionsMinimized, setPlannerOptionsMinimized] = useState(false)
  const [markedMapPoint, setMarkedMapPoint] = useState(null)
  const [plannerDraftFormTrail, setPlannerDraftFormTrail] = useState(null)

  useEffect(() => {
    if (!injectedPing?._id) return undefined

    let active = true
    queueMicrotask(() => {
      if (!active) return
      setPings((current) => {
        if (current.some((ping) => ping._id === injectedPing._id)) return current
        return [injectedPing, ...current]
      })
    })

    return () => {
      active = false
    }
  }, [injectedPing])

  const isTrailFlowOverlayOpen = Boolean(
    activeTrailSession || (finishModalTrail && finishStats)
  )

  const showRadiusPanel =
    areaInsightsEnabled && !startPanelTrail && !isTrailFlowOverlayOpen

  const closeMapOverlays = useCallback(
    (keep = '') => {
      if (keep !== 'trail') setSelectedTrail(null)
      if (keep !== 'officialTrail') setSelectedOfficialTrail(null)
      if (keep !== 'startPanel') setStartPanelTrail(null)
      if (keep !== 'markedPoint') setMarkedMapPoint(null)
      if (keep !== 'planner') setPlannerOpen(false)
      if (keep !== 'plannerForm') setPlannerDraftFormTrail(null)
      if (keep !== 'pendingPing') setPendingPing(null)
      if (keep !== 'selectedPing') setSelectedPing(null)
      if (keep !== 'selectedCluster') setSelectedCluster(null)
      if (keep !== 'selectedHut') setSelectedHut(null)
      if (keep !== 'stillThere') setStillTherePrompt(null)
      setUnmarkedWarning('')
    },
    [setSelectedTrail]
  )

  useEffect(() => {
    if (typeof onTrailFlowVisibilityChange === 'function') {
      onTrailFlowVisibilityChange(isTrailFlowOverlayOpen)
    }
  }, [isTrailFlowOverlayOpen, onTrailFlowVisibilityChange])

  const defaultMapStyle = useMemo(
    () => `mapbox://styles/mapbox/${mapStyle}`,
    [mapStyle]
  )

  const resolvedMapStyle = useMemo(() => {
    if (styleFailed) return defaultMapStyle
    return MAPBOX_STYLE_URL || defaultMapStyle
  }, [styleFailed, defaultMapStyle])

  const hasVectorTileset =
    Boolean(MAPBOX_TILESET_URL) &&
    MAPBOX_TILESET_TYPE === 'vector' &&
    Boolean(MAPBOX_TILESET_SOURCE_LAYER)

  const hasRasterTileset =
    Boolean(MAPBOX_TILESET_URL) && MAPBOX_TILESET_TYPE === 'raster'

  const tilesetConfigWarning =
    Boolean(MAPBOX_TILESET_URL) &&
      MAPBOX_TILESET_TYPE === 'vector' &&
      !MAPBOX_TILESET_SOURCE_LAYER
      ? 'Tileset source-layer is missing. Set VITE_MAPBOX_TILESET_SOURCE_LAYER.'
      : ''

  const trailSourceCollection = useMemo(
    () => normalizeTrailGeojsonCollection(trailsGeojson),
    [trailsGeojson]
  )

  const trailsVisibleByZoom = viewState.zoom >= TRAIL_VISIBILITY_MIN_ZOOM

  const visibleTrailSourceCollection = useMemo(
    () =>
      trailsVisibleByZoom
        ? trailSourceCollection
        : EMPTY_TRAIL_FEATURE_COLLECTION,
    [trailsVisibleByZoom, trailSourceCollection]
  )

  useEffect(() => {
    if (hasAutoFittedTrailsRef.current) return
    if (!mapReady) return

    const features = Array.isArray(visibleTrailSourceCollection.features)
      ? visibleTrailSourceCollection.features
      : []
    if (!features.length) return

    const map = mapRef.current?.getMap()
    if (!map || !map.loaded()) return

    try {
      const bounds = turfBbox(visibleTrailSourceCollection)
      if (!bounds || bounds.some((value) => !Number.isFinite(value))) return

      const doFit = () => {
        try {
          map.fitBounds(
            [
              [bounds[0], bounds[1]],
              [bounds[2], bounds[3]],
            ],
            { padding: 72, maxZoom: 14, duration: 1200 }
          )
          hasAutoFittedTrailsRef.current = true
        } catch {}
      }

      // attempt immediate fit, then retry once after a short delay
      doFit()
      window.setTimeout(doFit, 600)
    } catch {}
  }, [mapReady, visibleTrailSourceCollection])

  const trailsById = useMemo(() => {
    const map = new globalThis.Map()
    trails.forEach((trail) => {
      const id = String(trail._id || trail.id || '')
      if (id) map.set(id, trail)
    })
    return map
  }, [trails])

  const selectedAreaFeature = useMemo(() => {
    if (!selectedAreaCenter) return null

    return turfCircle(selectedAreaCenter, selectedAreaRadiusKm, {
      units: 'kilometers',
      steps: 60,
    })
  }, [selectedAreaCenter, selectedAreaRadiusKm])

  const selectedAreaTrails = useMemo(() => {
    if (!selectedAreaCenter) return []

    const radiusMeters = selectedAreaRadiusKm * 1000

    return trails
      .map((trail) => {
        const startCoordinates = deriveTrailStartCoordinates(trail)
        if (!startCoordinates) return null

        const distanceMeters = haversineMeters(
          selectedAreaCenter,
          startCoordinates
        )
        return {
          trail,
          startCoordinates,
          distanceMeters,
          withinRadius: distanceMeters <= radiusMeters,
        }
      })
      .filter((entry) => entry && entry.withinRadius)
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
  }, [trails, selectedAreaCenter, selectedAreaRadiusKm])

  const startPanelCoordinates = useMemo(() => {
    if (!startPanelTrail) return null
    return deriveTrailStartCoordinates(startPanelTrail)
  }, [startPanelTrail])

  const startPanelPathCoordinates = useMemo(() => {
    return extractLineCoordinates(getTrailGeometry(startPanelTrail))
  }, [startPanelTrail])

  const startPanelSegments = useMemo(() => {
    return buildSegmentModel(startPanelTrail, startPanelPathCoordinates.length)
  }, [startPanelTrail, startPanelPathCoordinates])

  const startSafety = useMemo(() => {
    return getSafetyDecision({
      trail: startPanelTrail,
      forecast: startForecast,
      readiness: startReadiness,
    })
  }, [startPanelTrail, startForecast, startReadiness])

  const activeSector = useMemo(() => {
    if (!activeTrailSession?.segments?.length) return null
    const safeIndex = Math.max(
      0,
      Math.min(currentSectorIndex, activeTrailSession.segments.length - 1)
    )
    return activeTrailSession.segments[safeIndex]
  }, [activeTrailSession, currentSectorIndex])

  const activitySteps = useMemo(
    () => Math.max(0, Math.round(activityDistanceMeters / 0.78)),
    [activityDistanceMeters]
  )

  const activityDistanceProgressText = useMemo(() => {
    const coveredKm = (activityDistanceMeters / 1000).toFixed(2)
    const totalMeters = Number(activeTrailSession?.totalDistanceMeters || 0)
    const totalKm = totalMeters > 0 ? (totalMeters / 1000).toFixed(2) : '--'
    return `${coveredKm} / ${totalKm} km`
  }, [activityDistanceMeters, activeTrailSession])

  const activityProgressPercent = useMemo(() => {
    const total = Number(activeTrailSession?.totalDistanceMeters || 0)
    if (total <= 0) return 0
    return Math.max(0, Math.min(100, (activityDistanceMeters / total) * 100))
  }, [activityDistanceMeters, activeTrailSession])

  const activityPaceText = useMemo(() => {
    if (activityDistanceMeters <= 0.1) return '--'
    const km = activityDistanceMeters / 1000
    const minPerKm = activityDurationSeconds / 60 / km
    if (!Number.isFinite(minPerKm) || minPerKm <= 0) return '--'
    const minutes = Math.floor(minPerKm)
    const seconds = Math.round((minPerKm - minutes) * 60)
    return `${minutes}:${String(seconds).padStart(2, '0')} min/km`
  }, [activityDistanceMeters, activityDurationSeconds])

  const startPanelSegmentFeatures = useMemo(
    () =>
      buildSegmentFeatureCollection(
        startPanelPathCoordinates,
        startPanelSegments
      ),
    [startPanelPathCoordinates, startPanelSegments]
  )

  const plannerRouteFeatures = useMemo(
    () => buildPlannerRouteFeatures(plannerRoutes, selectedPlannerRouteIndex),
    [plannerRoutes, selectedPlannerRouteIndex]
  )

  const selectedPlannerRoute = plannerRoutes[selectedPlannerRouteIndex] || null

  const plannerRouteDraft = useMemo(
    () =>
      selectedPlannerRoute
        ? buildPlannerTrail(selectedPlannerRoute, {
            start: plannerStart,
            destination: plannerDestination,
            waypoints: plannerWaypoints,
          })
        : null,
    [selectedPlannerRoute, plannerStart, plannerDestination, plannerWaypoints]
  )

  const plannerDirectDistanceMeters = useMemo(() => {
    const routePoints = [plannerStart, ...plannerWaypoints, plannerDestination]
      .map((point) => point?.coordinates)
      .filter((coords) => Array.isArray(coords) && coords.length === 2)

    if (routePoints.length < 2) return 0

    return routePoints.slice(1).reduce((total, point, index) => {
      return total + haversineMeters(routePoints[index], point)
    }, 0)
  }, [plannerStart, plannerWaypoints, plannerDestination])

  useEffect(() => {
    if (plannerStateRestoredRef.current || typeof window === 'undefined') return
    plannerStateRestoredRef.current = true
    try {
      const raw = window.sessionStorage.getItem(PLANNER_STATE_STORAGE_KEY)
      const saved = raw ? JSON.parse(raw) : null
      if (!saved || typeof saved !== 'object') return
      setPlannerStart(saved.plannerStart || null)
      setPlannerDestination(saved.plannerDestination || null)
      setPlannerWaypoints(Array.isArray(saved.plannerWaypoints) ? saved.plannerWaypoints : [])
      setPlannerRoutes(Array.isArray(saved.plannerRoutes) ? saved.plannerRoutes : [])
      setSelectedPlannerRouteIndex(Number(saved.selectedPlannerRouteIndex || 0))
      setPlannerRouteMode(Boolean(saved.plannerRouteMode))
      setPlannerOptionsMinimized(Boolean(saved.plannerOptionsMinimized))
      setPlannerPickMode(saved.plannerPickMode || 'inspect')
      setPlannerMessage(saved.plannerMessage || '')
    } catch {
      /* Planner restore is best-effort. */
    }
  }, [])

  useEffect(() => {
    if (!plannerStateRestoredRef.current || typeof window === 'undefined') return
    try {
      window.sessionStorage.setItem(
        PLANNER_STATE_STORAGE_KEY,
        JSON.stringify({
          plannerStart,
          plannerDestination,
          plannerWaypoints,
          plannerRoutes,
          selectedPlannerRouteIndex,
          plannerRouteMode,
          plannerOptionsMinimized,
          plannerPickMode,
          plannerMessage,
        })
      )
    } catch {
      /* Planner persistence is best-effort. */
    }
  }, [
    plannerDestination,
    plannerMessage,
    plannerOptionsMinimized,
    plannerPickMode,
    plannerRouteMode,
    plannerRoutes,
    plannerStart,
    plannerWaypoints,
    selectedPlannerRouteIndex,
  ])

  const loadedRouteCoordinates = useMemo(() => {
    if (Array.isArray(activeTrailSession?.pathCoordinates)) {
      return activeTrailSession.pathCoordinates
    }

    if (
      Array.isArray(startPanelPathCoordinates) &&
      startPanelPathCoordinates.length
    ) {
      return startPanelPathCoordinates
    }

    return extractLineCoordinates(selectedTrail?.geojson)
  }, [activeTrailSession, startPanelPathCoordinates, selectedTrail])

  const loadedRouteEndpoints = useMemo(() => {
    if (
      !Array.isArray(loadedRouteCoordinates) ||
      loadedRouteCoordinates.length < 2
    ) {
      return null
    }

    const start = loadedRouteCoordinates[0]
    const finish = loadedRouteCoordinates[loadedRouteCoordinates.length - 1]
    const startCoordinates = [Number(start[0]), Number(start[1])]
    const endCoordinates = [Number(finish[0]), Number(finish[1])]

    if (
      !Number.isFinite(startCoordinates[0]) ||
      !Number.isFinite(startCoordinates[1]) ||
      !Number.isFinite(endCoordinates[0]) ||
      !Number.isFinite(endCoordinates[1])
    ) {
      return null
    }

    return { startCoordinates, endCoordinates }
  }, [loadedRouteCoordinates])

  const activeTrailSegmentFeatures = useMemo(
    () =>
      buildSegmentFeatureCollection(
        activeTrailSession?.pathCoordinates,
        activeTrailSession?.segments
      ),
    [activeTrailSession]
  )

  useEffect(() => {
    trailFollowModeRef.current = Boolean(activeTrailSession)
  }, [activeTrailSession])

  useEffect(() => {
    if (trailTrackingError) {
      setGeoError(trailTrackingError)
    }
  }, [trailTrackingError])

  const applyLiveUserLocation = useCallback((coords, options = {}) => {
    const longitude = Number(coords?.longitude)
    const latitude = Number(coords?.latitude)
    const altitude = Number.isFinite(coords?.altitude) ? coords.altitude : null

    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return

    setGeoError('')
    setUserLocation({ longitude, latitude, altitude })

    if (compassSyncEnabledRef.current || options.enableCompass === true) {
      const gpsHeading = Number(coords?.heading)
      if (Number.isFinite(gpsHeading) && gpsHeading >= 0) {
        setMovementHeading(gpsHeading)
      } else {
        const previousCompassLocation = lastCompassLocationRef.current
        if (previousCompassLocation) {
          const movementMeters = haversineMeters(
            [
              previousCompassLocation.longitude,
              previousCompassLocation.latitude,
            ],
            [longitude, latitude]
          )
          if (movementMeters >= 2) {
            setMovementHeading(
              bearingDegrees(
                [
                  previousCompassLocation.longitude,
                  previousCompassLocation.latitude,
                ],
                [longitude, latitude]
              )
            )
          }
        }
      }
      lastCompassLocationRef.current = { longitude, latitude }
    }

    // In Maps page we only recenter when user explicitly asks for it.
    if (options.forceZoom !== true && options.recenter !== true) {
      return
    }

    const forceZoom = options.forceZoom === true
    const isTrailFollowMode =
      options.trailMode === true || trailFollowModeRef.current
    const previousCenter = lastCenteredLocationRef.current
    const movementThresholdMeters = isTrailFollowMode ? 0.6 : 4
    const movedEnough =
      !previousCenter ||
      haversineMeters(
        [previousCenter.longitude, previousCenter.latitude],
        [longitude, latitude]
      ) >= movementThresholdMeters

    const map = mapRef.current?.getMap()
    const mapCenter = map?.getCenter?.() || null
    const mapCenterDistanceMeters = mapCenter
      ? haversineMeters([mapCenter.lng, mapCenter.lat], [longitude, latitude])
      : 0
    const mapDriftThresholdMeters = isTrailFollowMode ? 1.5 : 12
    const mapIsOffUser = mapCenterDistanceMeters > mapDriftThresholdMeters
    const shouldRecenter =
      forceZoom ||
      !hasAutoCenteredOnUserRef.current ||
      movedEnough ||
      mapIsOffUser ||
      isTrailFollowMode

    if (!shouldRecenter) {
      return
    }

    const minFollowZoom = isTrailFollowMode
      ? USER_FOLLOW_TRAIL_ZOOM
      : USER_FOLLOW_BASE_ZOOM
    const nextMinZoom =
      forceZoom || !hasAutoCenteredOnUserRef.current || isTrailFollowMode
        ? minFollowZoom
        : null

    setViewState((prev) => ({
      ...prev,
      longitude,
      latitude,
      zoom: nextMinZoom ? Math.max(prev.zoom, nextMinZoom) : prev.zoom,
    }))

    if (map) {
      const targetZoom = nextMinZoom
        ? Math.max(map.getZoom(), nextMinZoom)
        : map.getZoom()
      map.easeTo({
        center: [longitude, latitude],
        zoom: targetZoom,
        duration:
          forceZoom || !hasAutoCenteredOnUserRef.current
            ? 700
            : isTrailFollowMode
              ? 180
              : 350,
        essential: true,
      })
    }

    hasAutoCenteredOnUserRef.current = true
    lastCenteredLocationRef.current = { longitude, latitude }
  }, [])

  const refreshPingsAndClusters = useCallback(() => {
    if (offlinePings.length) setPings(offlinePings)
    if (offlineClusters.length) setClusters(offlineClusters)
    fetchPings()
      .then((res) => setPings(Array.isArray(res.data) ? res.data : []))
      .catch(() => setPings(offlinePings))

    fetchClusters()
      .then((res) => setClusters(Array.isArray(res.data) ? res.data : []))
      .catch(() => setClusters(offlineClusters))
  }, [offlineClusters, offlinePings])

  useEffect(() => {
    let active = true
    const normalizedSearch = searchQuery.trim()

    setLoadingTrails(true)
    setTrailsError('')
    setSelectedTrail(null)
    setSelectedOfficialTrail(null)
    setUnmarkedWarning('')

    const fetchTimeout = setTimeout(() => {
      const trailParams = {
        compact: true,
        ...(normalizedSearch ? { search: normalizedSearch } : {}),
      }
      const request = Promise.allSettled([
        fetchMapTrails(trailParams),
        fetchMapTrailsGeojson(),
      ])

      request
        .then(([trailsResult, geojsonResult]) => {
          if (!active) return

          const trailsOk = trailsResult.status === 'fulfilled'
          let apiTrails = trailsOk
            ? Array.isArray(trailsResult.value?.data)
              ? trailsResult.value.data
              : []
            : []

          const mergedMap = new globalThis.Map()
          offlineTrails.forEach(t => mergedMap.set(t._id || t.id, t))
          apiTrails.forEach(t => mergedMap.set(t._id || t.id, t))
          const mergedTrails = Array.from(mergedMap.values())

          setTrails(mergedTrails)

          const geojsonOk = geojsonResult.status === 'fulfilled'
          if (geojsonOk && trailsOk) {
             const apiGeojson = normalizeTrailGeojsonCollection(geojsonResult.value?.data)
             const offlineGeojson = buildTrailGeojsonFromTrails(offlineTrails)
             const mergedFeatures = new globalThis.Map()
             
             apiGeojson.features.forEach(f => {
               if (f.properties?.id) mergedFeatures.set(f.properties.id, f)
             })
             offlineGeojson.features.forEach(f => {
               if (f.properties?.id && !mergedFeatures.has(f.properties.id)) {
                 mergedFeatures.set(f.properties.id, f)
               }
             })

             setTrailsGeojson({ type: 'FeatureCollection', features: Array.from(mergedFeatures.values()) })
          } else {
            setTrailsGeojson(buildTrailGeojsonFromTrails(mergedTrails))
          }

          if (!trailsOk) {
            if (offlineTrails.length > 0) {
              setTrailsError('Offline mode. Displaying downloaded trails.')
            } else {
              setTrailsError(
                'Could not load trails from the API. The base map is still available.'
              )
            }
          }
        })
        .catch(() => {
          if (!active) return
          if (offlineTrails.length > 0) {
             setTrails([...offlineTrails])
             setTrailsGeojson(buildTrailGeojsonFromTrails(offlineTrails))
             setTrailsError('Offline mode. Displaying downloaded trails.')
          } else {
             setTrails([])
             setTrailsGeojson({ type: 'FeatureCollection', features: [] })
             setTrailsError(
               'Could not load trails from the API. The base map is still available.'
             )
          }
        })
        .finally(() => {
          if (active) setLoadingTrails(false)
        })
    }, 180)

    return () => {
      active = false
      clearTimeout(fetchTimeout)
    }
  }, [trailsVersion, searchQuery, setSelectedTrail])

  useEffect(() => {
    const query = String(searchRequest?.query || '').trim()
    const requestId = searchRequest?.id
    if (!query || !requestId || !MAPBOX_TOKEN) return undefined
    if (processedSearchRequestRef.current === String(requestId)) {
      return undefined
    }
    processedSearchRequestRef.current = String(requestId)

    let active = true
    const normalizedQuery = query.toLowerCase()
    const matchedTrail = trails.find((trail) => {
      const values = [
        trail?.name,
        trail?.name_bg,
        trail?.name_en,
        trail?.ref,
      ]
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
      return (
        values.some((value) => value === normalizedQuery) ||
        values.some((value) => value.includes(normalizedQuery))
      )
    })

    if (matchedTrail) {
      const startCoordinates = deriveTrailStartCoordinates(matchedTrail)
      const pathCoordinates = extractLineCoordinates(matchedTrail.geojson)
      closeMapOverlays('trail')
      setSearchMapError('')
      setSearchResultMarker(null)
      setSelectedTrail(matchedTrail)
      setSelectedOfficialTrail(null)
      setSelectedAreaCenter(startCoordinates)

      const bounds = pathCoordinates.length
        ? buildBoundsFromCoordinates(pathCoordinates)
        : startCoordinates
          ? [startCoordinates, startCoordinates]
          : null

      if (bounds && pathCoordinates.length > 1) {
        mapRef.current?.getMap()?.fitBounds(bounds, {
          padding: 72,
          duration: 850,
          essential: true,
        })
      } else if (startCoordinates) {
        const [longitude, latitude] = startCoordinates
        setViewState((old) => ({
          ...old,
          longitude,
          latitude,
          zoom: Math.max(old.zoom, 13.2),
        }))
        mapRef.current?.getMap()?.flyTo({
          center: startCoordinates,
          zoom: 13.2,
          duration: 850,
          essential: true,
        })
      }
      return undefined
    }

    const mapCenter = mapRef.current?.getMap()?.getCenter()
    const proximity =
      Number.isFinite(userLocation?.longitude) &&
        Number.isFinite(userLocation?.latitude)
        ? `${userLocation.longitude},${userLocation.latitude}`
        : `${mapCenter?.lng || INITIAL_VIEW.longitude},${mapCenter?.lat || INITIAL_VIEW.latitude}`
    const params = new URLSearchParams({
      access_token: MAPBOX_TOKEN,
      limit: '1',
      language: 'en,bg',
      country: 'bg',
      types: 'poi,place,locality,region,address',
      proximity,
    })

    setSearchMapError('')

    fetch(
      `${MAPBOX_GEOCODING_ENDPOINT}/${encodeURIComponent(query)}.json?${params.toString()}`
    )
      .then((response) => {
        if (!response.ok) throw new Error('Search request failed')
        return response.json()
      })
      .then((payload) => {
        if (!active) return
        const feature = Array.isArray(payload?.features)
          ? payload.features[0]
          : null
        const coordinates = feature?.center
        if (!Array.isArray(coordinates) || coordinates.length !== 2) {
          setSearchMapError('No Mapbox location result found.')
          return
        }

        const [longitude, latitude] = coordinates.map(Number)
        if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
          setSearchMapError('Mapbox returned an invalid location.')
          return
        }

        setSearchResultMarker({
          coordinates: [longitude, latitude],
          label: feature.place_name || query,
        })
        closeMapOverlays('')
        setSelectedAreaCenter([longitude, latitude])
        setViewState((old) => ({
          ...old,
          longitude,
          latitude,
          zoom: Math.max(old.zoom, 12.8),
        }))
        mapRef.current?.getMap()?.flyTo({
          center: [longitude, latitude],
          zoom: 12.8,
          duration: 850,
          essential: true,
        })
      })
      .catch(() => {
        if (active) setSearchMapError('Could not search Mapbox right now.')
      })

    return () => {
      active = false
    }
  }, [searchRequest, userLocation, trails, setSelectedTrail, closeMapOverlays])

  useEffect(() => {
    if (initialStartFocus?.draftId && draftTrails.length) {
      const draftTrail = draftTrails.find(
        (trail) => String(trail.localId) === String(initialStartFocus.draftId)
      )
      if (!draftTrail) return

      const pathCoordinates = extractLineCoordinates(draftTrail.geojson)
      const startCoordinates =
        initialStartFocus.startCoordinates ||
        deriveTrailStartCoordinates(draftTrail) ||
        pathCoordinates[0]
      if (!Array.isArray(startCoordinates) || startCoordinates.length !== 2) {
        return
      }

      const focusKey = `draft:${draftTrail.localId}`
      if (initialStartFocusAppliedRef.current === focusKey) return
      initialStartFocusAppliedRef.current = focusKey

      setSelectedTrail(draftTrail)
      setSelectedOfficialTrail(null)
      setStartPanelTrail(draftTrail)
      setStartHoveredSegment(0)
      setStartPanelError('')
      setApproachRoute(null)
      setApproachSummary(null)
      setApproachError('')
      setSelectedAreaCenter(startCoordinates)

      const bounds = pathCoordinates.length
        ? buildBoundsFromCoordinates(pathCoordinates)
        : buildBoundsFromCoordinates([startCoordinates])
      if (bounds && pathCoordinates.length > 1) {
        mapRef.current?.getMap()?.fitBounds(bounds, {
          padding: 72,
          duration: 850,
          essential: true,
        })
      } else {
        mapRef.current?.getMap()?.flyTo({
          center: startCoordinates,
          zoom: 13.5,
          duration: 850,
          essential: true,
        })
      }
      return
    }

    if (!initialStartFocus?.startCoordinates) return

    const [startLng, startLat] = initialStartFocus.startCoordinates
    if (!Number.isFinite(startLng) || !Number.isFinite(startLat)) return

    const focusKey = `${startLng}|${startLat}|${initialStartFocus?.trailId || ''}`
    if (initialStartFocusAppliedRef.current === focusKey) return
    initialStartFocusAppliedRef.current = focusKey

    setSelectedAreaCenter([startLng, startLat])
    setViewState((old) => ({
      ...old,
      longitude: startLng,
      latitude: startLat,
      zoom: Math.max(old.zoom, 11.5),
    }))

    mapRef.current?.getMap()?.flyTo({
      center: [startLng, startLat],
      zoom: 11.5,
      essential: true,
      duration: 700,
    })
  }, [draftTrails, initialStartFocus, setSelectedTrail])

  useEffect(() => {
    if (!initialStartFocus?.trailId || !trails.length) return

    const selectKey = `${initialStartFocus.trailId}|${trails.length}`
    if (initialTrailSelectionRef.current === selectKey) return

    const matchedTrail = trails.find(
      (trail) =>
        String(trail._id || trail.id) === String(initialStartFocus.trailId)
    )
    if (!matchedTrail) return

    initialTrailSelectionRef.current = selectKey
    setSelectedTrail(matchedTrail)
  }, [initialStartFocus, trails, setSelectedTrail])

  useEffect(() => {
    refreshPingsAndClusters()
  }, [refreshPingsAndClusters, trailsVersion])

  useEffect(() => {
    if (!selectedAreaCenter) {
      setAreaWeather(null)
      setAreaWeatherError('')
      setAreaWeatherLoading(false)
      return
    }

    if (!hasWeatherApiKey()) {
      setAreaWeather(null)
      setAreaWeatherError('Add VITE_OPENWEATHER_API_KEY to enable map weather.')
      setAreaWeatherLoading(false)
      return
    }

    let active = true
    setAreaWeatherLoading(true)
    setAreaWeatherError('')

    fetchCurrentWeather({
      latitude: selectedAreaCenter[1],
      longitude: selectedAreaCenter[0],
    })
      .then((data) => {
        if (!active) return
        setAreaWeather(data)
      })
      .catch(() => {
        if (!active) return
        setAreaWeather(null)
        setAreaWeatherError(
          'Weather service is unavailable for the selected region.'
        )
      })
      .finally(() => {
        if (active) setAreaWeatherLoading(false)
      })

    return () => {
      active = false
    }
  }, [selectedAreaCenter])

  useEffect(() => {
    if (areaInsightsEnabled) {
      setAreaInsightsMinimized(false)
      return
    }

    setSelectedAreaCenter(null)
    setAreaWeather(null)
    setAreaWeatherError('')
    setAreaWeatherLoading(false)
    setAreaInsightsMinimized(false)
  }, [areaInsightsEnabled])

  useEffect(() => {
    if (!navigator.geolocation) return undefined

    const watchId = navigator.geolocation.watchPosition(
      ({ coords }) => {
        applyLiveUserLocation(coords)
      },
      () => {
        setGeoError('')
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 10000,
      }
    )

    locationWatchRef.current = watchId

    return () => {
      navigator.geolocation.clearWatch(watchId)
      locationWatchRef.current = null
    }
  }, [applyLiveUserLocation])

  useEffect(() => {
    if (!startPanelTrail) return undefined

    if (
      startPanelTrail.source !== 'local_draft' &&
      !extractLineCoordinates(getTrailGeometry(startPanelTrail)).length &&
      (startPanelTrail._id || startPanelTrail.id)
    ) {
      let active = true
      fetchTrailById(startPanelTrail._id || startPanelTrail.id)
        .then((res) => {
          if (!active || !res?.data) return
          if (!extractLineCoordinates(getTrailGeometry(res.data)).length) return
          setStartPanelTrail((current) =>
            current &&
            String(current._id || current.id) === String(startPanelTrail._id || startPanelTrail.id)
              ? { ...current, ...res.data }
              : current
          )
        })
        .catch(() => {})
      return () => {
        active = false
      }
    }

    let active = true
    lastStartReadinessLocationRef.current = null
    setStartPanelLoading(true)
    setStartPanelError('')
    setStartReadiness(null)
    setStartWeatherNow(null)
    setStartForecast([])
    setStartUnsafeAcknowledged(false)

    const trailId = startPanelTrail?._id || startPanelTrail?.id

    Promise.all([
      trailId
        ? fetchTrailStartReadiness(trailId, { maxDistanceMeters: 1000 })
        : Promise.resolve({
            data: {
              hasUserLocation: false,
              withinRange: true,
              distanceToStartMeters: null,
              message:
                'Local draft route. Distance-to-start check is unavailable until it is published.',
            },
          }),
      hasWeatherApiKey() && startPanelCoordinates
        ? fetchCurrentWeather({
          latitude: startPanelCoordinates[1],
          longitude: startPanelCoordinates[0],
        })
        : Promise.resolve(null),
      hasWeatherApiKey() && startPanelCoordinates
        ? fetchWeatherForecast({
          latitude: startPanelCoordinates[1],
          longitude: startPanelCoordinates[0],
          limit: 10,
        })
        : Promise.resolve([]),
    ])
      .then(([readinessRes, weatherNowRes, forecastRes]) => {
        if (!active) return
        setStartReadiness(readinessRes.data || null)
        setStartWeatherNow(weatherNowRes || null)
        setStartForecast(Array.isArray(forecastRes) ? forecastRes : [])
      })
      .catch(() => {
        if (!active) return
        setStartPanelError('Could not load trail start readiness right now.')
      })
      .finally(() => {
        if (active) setStartPanelLoading(false)
      })

    return () => {
      active = false
    }
  }, [startPanelTrail, startPanelCoordinates])

  useEffect(() => {
    if (!startPanelTrail || !userLocation) return undefined

    const trailId = startPanelTrail?._id || startPanelTrail?.id
    if (!trailId) return undefined

    const lastLocation = lastStartReadinessLocationRef.current
    if (lastLocation) {
      const movedMeters = haversineMeters(
        [lastLocation.longitude, lastLocation.latitude],
        [userLocation.longitude, userLocation.latitude]
      )
      if (movedMeters < 25) {
        return undefined
      }
    }

    lastStartReadinessLocationRef.current = {
      longitude: userLocation.longitude,
      latitude: userLocation.latitude,
    }

    let active = true

    fetchTrailStartReadiness(trailId, {
      maxDistanceMeters: 1000,
      userLng: userLocation.longitude,
      userLat: userLocation.latitude,
    })
      .then((res) => {
        if (!active) return
        setStartReadiness(res.data || null)
        setStartPanelError('')
      })
      .catch(() => {
        if (!active) return
        setStartPanelError(
          (current) =>
            current || 'Could not refresh distance to start right now.'
        )
      })

    return () => {
      active = false
    }
  }, [startPanelTrail, userLocation])

  const handlePingSubmit = useCallback(async () => {
    if (!pendingPing) return

    setPingSubmitting(true)
    try {
      const res = await createPing({
        ...(pendingPing.trailId || activeTrailSession?.trailId
          ? { trailId: pendingPing.trailId || activeTrailSession.trailId }
          : {}),
        type: pingType,
        description: pingDesc,
        coordinates: pendingPing.coordinates,
      })
      setPings((prev) => [res.data, ...prev])
      setPendingPing(null)
      setPingDesc('')
      setPingMode(false)

      fetchClusters()
        .then((r) => setClusters(Array.isArray(r.data) ? r.data : []))
        .catch(() => { })
    } catch (err) {
      console.error('Ping submit error:', err)
    } finally {
      setPingSubmitting(false)
    }
  }, [pendingPing, activeTrailSession, pingType, pingDesc])

  const handlePhotoCapture = useCallback(
    (photo) => {
      closeMapOverlays('')
      setCapturedPhoto(photo)
      setShowPhotoModal(true)
    },
    [closeMapOverlays]
  )

  const handlePhotoSubmit = useCallback(
    async (photoData) => {
      try {
        const trailId = asMongoObjectId(activeTrailSession?.trailId)
        const res = await createPhotoPing({
          ...(trailId ? { trailId } : {}),
          description: photoData.description,
          photoUrl: photoData.photoUrl,
          photoCategory: photoData.photoCategory,
          coordinates: photoData.coordinates,
        })
        const savedPhotoPing = {
          ...res.data,
          type: 'photo',
          photoUrl: res.data?.photoUrl || photoData.photoUrl,
          photoCategory: res.data?.photoCategory || photoData.photoCategory,
          coordinates: res.data?.coordinates || photoData.coordinates,
        }
        setPings((prev) => [savedPhotoPing, ...prev])
        setSelectedPing(savedPhotoPing)
        setPingMode(false)
        if (Array.isArray(photoData.coordinates)) {
          setViewState((old) => ({
            ...old,
            longitude: photoData.coordinates[0],
            latitude: photoData.coordinates[1],
            zoom: Math.max(old.zoom || 0, 16),
          }))
        }
      } catch (err) {
        console.error('Photo ping submit error:', err)
        throw err
      }
    },
    [activeTrailSession]
  )

  const handlePingVote = useCallback(async (pingId) => {
    setVoteSubmitting(true)
    try {
      await votePingGone(pingId)
      setPings((prev) => prev.filter((p) => p._id !== pingId))
      setSelectedPing(null)
    } catch (err) {
      if (err?.response?.status === 404) {
        setPings((prev) => prev.filter((p) => p._id !== pingId))
        setSelectedPing(null)
        return
      }
      console.error('Ping vote error:', err)
    } finally {
      setVoteSubmitting(false)
    }
  }, [])

  const handleClusterVote = useCallback(async (clusterId) => {
    setVoteSubmitting(true)
    try {
      const res = await voteClusterGone(clusterId)
      if (res.data.resolved) {
        setClusters((prev) =>
          prev.filter((cluster) => cluster._id !== clusterId)
        )
        setSelectedCluster(null)
        fetchPings()
          .then((r) => setPings(Array.isArray(r.data) ? r.data : []))
          .catch(() => { })
      } else {
        setClusters((prev) =>
          prev.map((cluster) =>
            cluster._id === clusterId ? res.data : cluster
          )
        )
        setSelectedCluster(res.data)
      }
    } catch (err) {
      if (err?.response?.status === 404) {
        setClusters((prev) =>
          prev.filter((cluster) => cluster._id !== clusterId)
        )
        setSelectedCluster(null)
        return
      }
      console.error('Cluster vote error:', err)
    } finally {
      setVoteSubmitting(false)
    }
  }, [])

  const applyMapAtmosphere = useCallback((map) => {
    if (!map) return
    try {
      map.setProjection?.({ name: 'globe' })
      map.setFog?.({
        color: 'rgb(186, 210, 235)',
        'high-color': 'rgb(36, 92, 138)',
        'horizon-blend': 0.08,
        'space-color': 'rgb(8, 15, 26)',
        'star-intensity': 0.12,
      })
    } catch {
      /* Older Mapbox style/runtime combinations may not support atmosphere. */
    }
  }, [])

  const applyTerrain = useCallback((map, enabled) => {
    if (enabled) {
      if (!map.getSource(DEM_SOURCE_ID)) {
        map.addSource(DEM_SOURCE_ID, {
          type: 'raster-dem',
          url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
          tileSize: 512,
          maxzoom: 14,
        })
      }
      map.setTerrain({ source: DEM_SOURCE_ID, exaggeration: 1.5 })
      map.setPitch(45)
    } else {
      map.setTerrain(null)
      if (map.getPitch() > 50) {
        map.setPitch(0)
      }
    }
  }, [])

  const handleMapLoad = useCallback(() => {
    const map = mapRef.current?.getMap()
    if (map) {
      applyMapAtmosphere(map)
      applyTerrain(map, terrain3D)
      setMapReady(true)
    }
  }, [terrain3D, applyTerrain, applyMapAtmosphere])

  const handleMapError = useCallback(
    (event) => {
      const status = event?.error?.status || event?.error?.statusCode
      const message = event?.error?.message || ''
      const is404 = status === 404 || message.includes('404')
      const updateMapError = (updater) => {
        window.setTimeout(updater, 0)
      }

      if (MAPBOX_STYLE_URL && !styleFailed && is404) {
        updateMapError(() => {
          setStyleFailed(true)
          setMapError(
            'Custom map style is not reachable (404). Switched to the default Mapbox style.'
          )
        })
        return
      }

      updateMapError(() => {
        setMapError(
          'Map failed to load. Check your network, Mapbox token, or style URL permissions.'
        )
        setMapReady(false)
      })
    },
    [styleFailed]
  )

  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (map && map.loaded()) {
      applyMapAtmosphere(map)
      applyTerrain(map, terrain3D)
    }
  }, [terrain3D, applyTerrain, applyMapAtmosphere])

  const handleZoomIn = useCallback(() => {
    const map = mapRef.current?.getMap()
    map?.zoomIn({ duration: 200 })
  }, [])

  const handleZoomOut = useCallback(() => {
    const map = mapRef.current?.getMap()
    map?.zoomOut({ duration: 200 })
  }, [])

  const handleTogglePitch = useCallback(() => {
    const map = mapRef.current?.getMap()
    if (!map) return

    const tilted = map.getPitch() >= 35
    const nextPitch = tilted ? 0 : 60
    const nextBearing = tilted ? 0 : -18
    const nextZoom = tilted ? map.getZoom() : Math.max(map.getZoom(), 12.5)

    setViewState((old) => ({
      ...old,
      pitch: nextPitch,
      bearing: nextBearing,
      zoom: nextZoom,
    }))

    map.easeTo({
      pitch: nextPitch,
      bearing: nextBearing,
      zoom: nextZoom,
      duration: 550,
      essential: true,
    })
  }, [])

  const handleCenterMe = useCallback(() => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        compassSyncEnabledRef.current = true
        setCompassSyncEnabled(true)
        applyLiveUserLocation(coords, {
          forceZoom: true,
          enableCompass: true,
        })
        if (areaInsightsEnabled) {
          setSelectedAreaCenter([coords.longitude, coords.latitude])
        }
      },
      () => {
        setGeoError('')
      }
    )
  }, [areaInsightsEnabled, applyLiveUserLocation])

  const handleToggleAreaInsights = useCallback(() => {
    setAreaInsightsEnabled((value) => !value)
  }, [])

  const handleTrailLayerFeatureClick = useCallback(
    (event) => {
      const feature = event?.features?.[0]
      if (!feature) return

      skipNextMapClickSelectionRef.current = true

      const normalized = normalizeTrailFeatureProperties(
        feature.properties || {}
      )
      const trailId = String(normalized.id || '')
      const matchedTrail = trailId ? trailsById.get(trailId) : null

      const fallbackTrail = {
        _id: trailId,
        id: trailId,
        source: normalized.source,
        name:
          normalized.name ||
          normalized.name_bg ||
          normalized.name_en ||
          'Unnamed trail',
        name_bg: normalized.name_bg,
        name_en: normalized.name_en,
        ref: normalized.ref,
        difficulty: normalized.difficulty,
        colour_type: normalized.colour_type,
        osm_colour: normalized.osm_colour,
        osm_marking: normalized.osm_marking,
        network: normalized.network,
        description: normalized.description,
        distance: normalized.distance,
        elevation_gain: normalized.elevation_gain,
        geojson: {
          type: 'Feature',
          geometry: feature.geometry,
          properties: normalized,
        },
        stats: {
          distance: Number(normalized.distance || 0) * 1000,
          elevationGain: Number(normalized.elevation_gain || 0),
        },
      }

      if (normalized.source === 'user') {
        closeMapOverlays('trail')
        if (normalized.colour_type === 'unmarked') {
          setUnmarkedWarning(
            'Warning: this section is unmarked. Advanced navigation skills are required.'
          )
        } else {
          setUnmarkedWarning('')
        }

        setSelectedTrail(matchedTrail || fallbackTrail)
        return
      }

      closeMapOverlays('officialTrail')
      setUnmarkedWarning('')
      setSelectedOfficialTrail(matchedTrail || fallbackTrail)
    },
    [closeMapOverlays, setSelectedTrail, trailsById]
  )

  useEffect(() => {
    if (!mapReady) return undefined

    const map = mapRef.current?.getMap()
    if (!map) return undefined

    const existingLayers = INTERACTIVE_TRAIL_LAYER_IDS.filter((id) =>
      map.getLayer(id)
    )
    if (!existingLayers.length) return undefined

    const handleMouseEnter = () => {
      map.getCanvas().style.cursor = 'pointer'
    }
    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = ''
    }

    existingLayers.forEach((layerId) => {
      map.on('click', layerId, handleTrailLayerFeatureClick)
      map.on('mouseenter', layerId, handleMouseEnter)
      map.on('mouseleave', layerId, handleMouseLeave)
    })

    return () => {
      existingLayers.forEach((layerId) => {
        map.off('click', layerId, handleTrailLayerFeatureClick)
        map.off('mouseenter', layerId, handleMouseEnter)
        map.off('mouseleave', layerId, handleMouseLeave)
      })
      if (map.getCanvas()) {
        map.getCanvas().style.cursor = ''
      }
    }
  }, [mapReady, handleTrailLayerFeatureClick, trailSourceCollection])

  const handleResetView = useCallback(() => {
    const map = mapRef.current?.getMap()
    setViewState(INITIAL_VIEW)
    setSelectedAreaCenter(null)
    setSelectedAreaRadiusKm(8)
    setSelectedTrail(null)
    setSelectedOfficialTrail(null)
    setUnmarkedWarning('')
    setGeoError('')

    map?.flyTo({
      center: [INITIAL_VIEW.longitude, INITIAL_VIEW.latitude],
      zoom: INITIAL_VIEW.zoom,
      essential: true,
      duration: 700,
    })
  }, [setSelectedTrail])

  const handleOpenStartPlanner = useCallback(
    (trail) => {
      if (!trail) return
      closeMapOverlays('startPanel')
      setSelectedOfficialTrail(null)
      setStartPanelTrail(trail)
      setStartHoveredSegment(0)
      setStartPanelError('')
      setApproachRoute(null)
      setApproachSummary(null)
      setApproachError('')

      if (!userLocation && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          ({ coords }) => {
            setUserLocation({
              longitude: coords.longitude,
              latitude: coords.latitude,
              altitude: Number.isFinite(coords.altitude)
                ? coords.altitude
                : null,
            })
          },
          () => { }
        )
      }
    },
    [closeMapOverlays, userLocation]
  )

  const handleShowApproachRoute = useCallback(async () => {
    if (!startPanelCoordinates || !MAPBOX_TOKEN) {
      setApproachError('Trail start coordinates are unavailable.')
      return
    }

    const loadCurrentLocation = () =>
      new Promise((resolve, reject) => {
        if (userLocation) {
          resolve(userLocation)
          return
        }
        if (!navigator.geolocation) {
          reject(new Error('Location unavailable'))
          return
        }
        navigator.geolocation.getCurrentPosition(
          ({ coords }) =>
            resolve({
              longitude: coords.longitude,
              latitude: coords.latitude,
              altitude: Number.isFinite(coords.altitude)
                ? coords.altitude
                : null,
            }),
          reject,
          { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
        )
      })

    setApproachLoading(true)
    setApproachError('')

    try {
      const current = await loadCurrentLocation()
      setUserLocation(current)

      const origin = `${current.longitude},${current.latitude}`
      const destination = `${startPanelCoordinates[0]},${startPanelCoordinates[1]}`
      const params = new URLSearchParams({
        access_token: MAPBOX_TOKEN,
        geometries: 'geojson',
        overview: 'full',
        steps: 'false',
        alternatives: 'false',
      })

      const response = await fetch(
        `${MAPBOX_DIRECTIONS_ENDPOINT}/${origin};${destination}?${params.toString()}`
      )
      if (!response.ok) throw new Error('Directions failed')

      const payload = await response.json()
      const route = Array.isArray(payload?.routes) ? payload.routes[0] : null
      const coordinates = route?.geometry?.coordinates
      if (!Array.isArray(coordinates) || coordinates.length < 2) {
        throw new Error('No route geometry')
      }

      const routeFeature = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: route.geometry,
          },
        ],
      }

      setApproachRoute(routeFeature)
      setApproachSummary({
        distanceMeters: Number(route.distance || 0),
        durationSeconds: Number(route.duration || 0),
      })

      const bounds = buildBoundsFromCoordinates([
        [current.longitude, current.latitude],
        ...coordinates,
        startPanelCoordinates,
      ])
      if (bounds) {
        mapRef.current?.getMap()?.fitBounds(bounds, {
          padding: 72,
          duration: 850,
          essential: true,
        })
      }
    } catch {
      setApproachError('Could not build a walking approach route.')
    } finally {
      setApproachLoading(false)
    }
  }, [startPanelCoordinates, userLocation])

  const fetchMapboxPointInfo = useCallback(async ([longitude, latitude]) => {
    if (!MAPBOX_TOKEN) return null
    const params = new URLSearchParams({
      access_token: MAPBOX_TOKEN,
      language: 'en,bg',
      types: MAPBOX_REVERSE_GEOCODING_TYPES,
      limit: '1',
    })

    const response = await fetch(
      `${MAPBOX_GEOCODING_ENDPOINT}/${longitude},${latitude}.json?${params.toString()}`
    )
    if (!response.ok) throw new Error('Could not inspect this point.')
    const payload = await response.json()
    const feature = Array.isArray(payload?.features) ? payload.features[0] : null
    return {
      coordinates: [longitude, latitude],
      label: feature?.text || feature?.place_name || 'Selected point',
      placeName: feature?.place_name || '',
      category: feature?.properties?.category || feature?.place_type?.[0] || '',
    }
  }, [])

  const inspectMapPoint = useCallback(
    async ([longitude, latitude]) => {
      const basePoint = makePlannerPoint([longitude, latitude])
      if (!basePoint) return null

      let pointInfo = null
      try {
        pointInfo = await fetchMapboxPointInfo([longitude, latitude])
      } catch {
        pointInfo = null
      }

      let elevation = null
      try {
        elevation = await fetchTerrainRgbElevation(longitude, latitude, MAPBOX_TOKEN)
        if (!Number.isFinite(elevation)) {
          const map = mapRef.current?.getMap()
          const queriedElevation = map?.queryTerrainElevation?.(
            [longitude, latitude],
            { exaggerated: false }
          )
          if (Number.isFinite(queriedElevation)) elevation = queriedElevation
        }
      } catch {
        elevation = null
      }

      return {
        ...basePoint,
        ...(pointInfo || {}),
        label:
          pointInfo?.placeName ||
          pointInfo?.label ||
          makePointLabel(basePoint, 'Marked location'),
        elevation,
      }
    },
    [fetchMapboxPointInfo]
  )

  const getCurrentPlannerPoint = useCallback(
    () =>
      new Promise((resolve, reject) => {
        if (userLocation?.longitude && userLocation?.latitude) {
          resolve(
            makePlannerPoint(
              [userLocation.longitude, userLocation.latitude],
              'Current location'
            )
          )
          return
        }
        if (!navigator.geolocation) {
          reject(new Error('Current location is unavailable.'))
          return
        }
        navigator.geolocation.getCurrentPosition(
          ({ coords }) => {
            const point = makePlannerPoint(
              [coords.longitude, coords.latitude],
              'Current location'
            )
            setUserLocation({
              longitude: coords.longitude,
              latitude: coords.latitude,
              altitude: Number.isFinite(coords.altitude) ? coords.altitude : null,
            })
            resolve(point)
          },
          () => reject(new Error('Could not read your current location.')),
          { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
        )
      }),
    [userLocation]
  )

  const handlePlannerPoint = useCallback(
    async ([longitude, latitude]) => {
      const basePoint = await inspectMapPoint([longitude, latitude])
      if (!basePoint) return

      setPlannerError('')
      setPlannerMessage('')
      setPlannerPointInfo(basePoint)

      if (plannerPickMode === 'start') {
        setPlannerStart(basePoint)
        setPlannerPickMode('destination')
      } else if (plannerPickMode === 'destination') {
        setPlannerDestination(basePoint)
        setPlannerPickMode('inspect')
      } else if (plannerPickMode === 'waypoint') {
        setPlannerWaypoints((current) => [...current, basePoint].slice(0, 8))
        setPlannerPickMode('destination')
      }
    },
    [inspectMapPoint, plannerPickMode]
  )

  const handleUseCurrentAsPlannerStart = useCallback(async () => {
    setPlannerError('')
    try {
      const point = await getCurrentPlannerPoint()
      setPlannerStart(point)
      setPlannerPickMode('destination')
      setPlannerMessage('Current location set as start. Tap the destination.')
    } catch (err) {
      setPlannerError(err?.message || 'Could not use current location.')
      setPlannerPickMode('start')
    }
  }, [getCurrentPlannerPoint])

  const handleBuildPlannerRoutes = useCallback(async (overrides = {}) => {
    setPlannerError('')
    setPlannerMessage('')

    let start = overrides.start || plannerStart
    if (!start) {
      try {
        start = await getCurrentPlannerPoint()
        setPlannerStart(start)
      } catch {
        setPlannerError('Choose a start point or enable current location.')
        setPlannerPickMode('start')
        return
      }
    }

    const destination = overrides.destination || plannerDestination
    const waypoints = Array.isArray(overrides.waypoints)
      ? overrides.waypoints
      : plannerWaypoints

    if (!destination) {
      setPlannerError('Choose a destination point on the map.')
      setPlannerPickMode('destination')
      return
    }

    const routePoints = [start, ...waypoints, destination]
      .map((point) => point?.coordinates)
      .filter((coords) => Array.isArray(coords) && coords.length === 2)

    if (routePoints.length < 2) {
      setPlannerError('At least two valid points are required.')
      return
    }

    setPlannerLoading(true)
    try {
      const map = mapRef.current?.getMap?.()
      const requestDirections = async (points, alternatives = false, tag = 'direct') => {
        const params = new URLSearchParams({
          access_token: MAPBOX_TOKEN,
          geometries: 'geojson',
          overview: 'full',
          steps: 'false',
          alternatives: alternatives ? 'true' : 'false',
        })
        const coordsParam = points.map(([lng, lat]) => `${lng},${lat}`).join(';')
        const response = await fetch(
          `${MAPBOX_DIRECTIONS_ENDPOINT}/${coordsParam}?${params.toString()}`
        )
        if (!response.ok) throw new Error('Mapbox directions failed.')
        const payload = await response.json()
        const rawRoutes = Array.isArray(payload?.routes) ? payload.routes : []
        return Promise.all(
          rawRoutes.map(async (route) => ({
            ...route,
            plannerTag: tag,
            telemetry: await enrichPlannerRouteTelemetry(route, routePoints, map),
          }))
        )
      }

      const routeSets = await Promise.allSettled([
        requestDirections(routePoints, routePoints.length === 2, 'direct'),
        ...buildAlternativeWaypointSets(routePoints).map((points, index) =>
          requestDirections(points, false, `variant-${index + 1}`)
        ),
      ])
      const routes = routeSets.flatMap((result) =>
        result.status === 'fulfilled' ? result.value : []
      )
      const validRoutes = routes.filter(
        (route) => Array.isArray(route?.geometry?.coordinates) &&
          route.geometry.coordinates.length >= 2
      )
      if (!validRoutes.length) throw new Error('No route was found.')

      const uniqueRoutes = []
      const signatures = new Set()
      validRoutes
        .sort((a, b) => Number(a.distance || 0) - Number(b.distance || 0))
        .forEach((route) => {
          const coordinates = route.geometry.coordinates
          const startCoord = coordinates[0] || []
          const endCoord = coordinates[coordinates.length - 1] || []
          const signature = [
            Math.round(Number(route.distance || 0) / 50),
            Math.round(Number(route.duration || 0) / 60),
            startCoord.map((value) => Number(value).toFixed(3)).join(','),
            endCoord.map((value) => Number(value).toFixed(3)).join(','),
          ].join('|')
          if (signatures.has(signature)) return
          signatures.add(signature)
          uniqueRoutes.push(route)
        })

      setPlannerRoutes(uniqueRoutes.slice(0, 4))
      setSelectedPlannerRouteIndex(0)
      setPlannerOpen(false)
      setPlannerRouteMode(false)
      setPlannerOptionsMinimized(false)
      setPlannerMessage(
        `${uniqueRoutes.length} route option${uniqueRoutes.length === 1 ? '' : 's'} found.`
      )

      const bounds = buildBoundsFromCoordinates(
        uniqueRoutes.flatMap((route) => route.geometry.coordinates || [])
      )
      if (bounds) {
        mapRef.current?.getMap()?.fitBounds(bounds, {
          padding: 80,
          duration: 850,
          essential: true,
        })
      }
    } catch (err) {
      setPlannerError(err?.message || 'Could not build route alternatives.')
      setPlannerRoutes([])
    } finally {
      setPlannerLoading(false)
    }
  }, [
    plannerStart,
    plannerDestination,
    plannerWaypoints,
    getCurrentPlannerPoint,
  ])

  const handleShowPlannerApproachRoute = useCallback(async () => {
    if (!plannerStart?.coordinates || !MAPBOX_TOKEN) {
      setPlannerError('Choose a planner start point first.')
      return
    }

    setPlannerLoading(true)
    setPlannerError('')
    setPlannerMessage('')

    try {
      const current = await getCurrentPlannerPoint()
      const origin = `${current.coordinates[0]},${current.coordinates[1]}`
      const destination = `${plannerStart.coordinates[0]},${plannerStart.coordinates[1]}`
      const params = new URLSearchParams({
        access_token: MAPBOX_TOKEN,
        geometries: 'geojson',
        overview: 'full',
        steps: 'false',
        alternatives: 'false',
      })

      const response = await fetch(
        `${MAPBOX_DIRECTIONS_ENDPOINT}/${origin};${destination}?${params.toString()}`
      )
      if (!response.ok) throw new Error('Directions failed.')

      const payload = await response.json()
      const route = Array.isArray(payload?.routes) ? payload.routes[0] : null
      const coordinates = route?.geometry?.coordinates
      if (!Array.isArray(coordinates) || coordinates.length < 2) {
        throw new Error('No approach route found.')
      }

      setApproachRoute({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { source: 'planner-approach' },
            geometry: route.geometry,
          },
        ],
      })
      setApproachSummary({
        distanceMeters: Number(route.distance || 0),
        durationSeconds: Number(route.duration || 0),
      })
      setPlannerMessage(
        `Approach to start: ${(Number(route.distance || 0) / 1000).toFixed(
          2
        )} km · ${formatPlannerDuration(route.duration)}.`
      )

      const bounds = buildBoundsFromCoordinates(coordinates)
      if (bounds) {
        mapRef.current?.getMap()?.fitBounds(bounds, {
          padding: 78,
          duration: 800,
          essential: true,
        })
      }
    } catch (err) {
      setPlannerError(err?.message || 'Could not build route to start.')
    } finally {
      setPlannerLoading(false)
    }
  }, [plannerStart, getCurrentPlannerPoint])

  const persistPlannerAuthAction = useCallback((action, routeDraft) => {
    try {
      window.sessionStorage.setItem(
        PLANNER_AUTH_STORAGE_KEY,
        JSON.stringify({ action, routeDraft })
      )
    } catch {
      /* Best effort. */
    }
    navigate('/login')
  }, [navigate])

  const handleSavePlannerRoute = useCallback(async () => {
    if (!plannerRouteDraft) {
      setPlannerError('Build and select a route first.')
      return
    }
    if (!isSignedIn || !userId) {
      persistPlannerAuthAction('save', plannerRouteDraft)
      return
    }
    setPlannerError('')
    closeMapOverlays('plannerForm')
    setPlannerDraftFormTrail(plannerRouteDraft)
  }, [
    plannerRouteDraft,
    isSignedIn,
    userId,
    persistPlannerAuthAction,
    closeMapOverlays,
  ])

  const handlePlannerDraftFormSuccess = useCallback(async (trail) => {
    const sourceDraft = plannerDraftFormTrail
    if (!sourceDraft) return

    setPlannerSaving(true)
    try {
      await saveDraftTrail({
        ...trail,
        stats: {
          ...(sourceDraft.stats || {}),
          pointCount:
            sourceDraft.stats?.pointCount ||
            extractLineCoordinates(trail.geojson).length,
        },
        startCoordinates: sourceDraft.startCoordinates,
        endCoordinates: sourceDraft.endCoordinates,
        startPoint: sourceDraft.startPoint,
        endPoint: sourceDraft.endPoint,
      })
      setPlannerDraftFormTrail(null)
      setPlannerOpen(false)
      setPlannerRouteMode(false)
      setPlannerRoutes([])
      setPlannerOptionsMinimized(false)
      window.sessionStorage?.removeItem(PLANNER_STATE_STORAGE_KEY)
      setPlannerMessage('Route saved locally in Account > Local Trail Drafts.')
    } catch (err) {
      setPlannerError(err?.message || 'Could not save this route locally.')
    } finally {
      setPlannerSaving(false)
    }
  }, [plannerDraftFormTrail, saveDraftTrail])

  const startPlannerRouteDraft = useCallback((routeDraft) => {
    const pathCoordinates = extractLineCoordinates(routeDraft?.geojson)
    if (pathCoordinates.length < 2) {
      setPlannerError('The selected generated route has no usable geometry.')
      return
    }

    startTrailActivity({
      trailId: routeDraft.localId,
      trailName: routeDraft.name,
      trailDifficulty: routeDraft.difficulty,
      totalDistanceMeters: routeDraft.stats?.distance || pathLengthMeters(pathCoordinates),
      totalElevationMeters: routeDraft.stats?.elevationGain || null,
      pathCoordinates,
      segments: buildSegmentModel(routeDraft, pathCoordinates.length),
      isLocalPlannerTrail: true,
      plannerDraft: routeDraft,
      startedAt: Date.now(),
    }, userLocation)
    setShowSectorSummary(false)
    setPlannerOpen(false)
    setPlannerRoutes([])
    setPlannerOptionsMinimized(false)
    setPingMode(false)
    setPendingPing(null)
    closeMapOverlays('')
    window.sessionStorage?.removeItem(PLANNER_STATE_STORAGE_KEY)

    const bounds = buildBoundsFromCoordinates(pathCoordinates)
    if (bounds) {
      mapRef.current?.getMap()?.fitBounds(bounds, {
        padding: 76,
        duration: 800,
        essential: true,
      })
    }
  }, [closeMapOverlays, startTrailActivity, userLocation])

  const handleStartPlannerRoute = useCallback(() => {
    if (!plannerRouteDraft) {
      setPlannerError('Build and select a route first.')
      return
    }
    if (!isSignedIn || !userId) {
      persistPlannerAuthAction('start', plannerRouteDraft)
      return
    }
    startPlannerRouteDraft(plannerRouteDraft)
  }, [
    plannerRouteDraft,
    isSignedIn,
    userId,
    persistPlannerAuthAction,
    startPlannerRouteDraft,
  ])

  useEffect(() => {
    if (!isSignedIn || !userId) return

    let pending = null
    try {
      const raw = window.sessionStorage.getItem(PLANNER_AUTH_STORAGE_KEY)
      pending = raw ? JSON.parse(raw) : null
      window.sessionStorage.removeItem(PLANNER_AUTH_STORAGE_KEY)
    } catch {
      pending = null
    }

    if (!pending?.routeDraft) return

    const routeDraft = pending.routeDraft
    setPlannerStart(null)
    setPlannerDestination(null)
    setPlannerWaypoints([])
    setPlannerRoutes([])
    setSelectedPlannerRouteIndex(0)
    setPlannerOptionsMinimized(false)
    setPlannerError('')
    setPlannerMessage('')

    if (pending.action === 'start') {
      startPlannerRouteDraft(routeDraft)
    } else {
      closeMapOverlays('plannerForm')
      setPlannerDraftFormTrail(routeDraft)
    }
  }, [isSignedIn, userId, startPlannerRouteDraft, closeMapOverlays])

  const handleResetPlanner = useCallback(() => {
    setPlannerPointInfo(null)
    setPlannerStart(null)
    setPlannerDestination(null)
    setPlannerWaypoints([])
    setPlannerRoutes([])
    setSelectedPlannerRouteIndex(0)
    setPlannerOptionsMinimized(false)
    setPlannerError('')
    setPlannerMessage('')
    setPlannerPickMode('inspect')
    setPlannerRouteMode(false)
    window.sessionStorage?.removeItem(PLANNER_STATE_STORAGE_KEY)
  }, [])

  const handleMarkedMapPoint = useCallback(
    async ([longitude, latitude]) => {
      const point = await inspectMapPoint([longitude, latitude])
      if (!point) return
      closeMapOverlays('markedPoint')
      setMarkedMapPoint(point)
      setPlannerPointInfo(point)
    },
    [closeMapOverlays, inspectMapPoint]
  )

  const handleCreateTrailFromMarkedPoint = useCallback(() => {
    if (!markedMapPoint) return
    setPlannerStart(markedMapPoint)
    setPlannerDestination(null)
    setPlannerWaypoints([])
    setPlannerRoutes([])
    setSelectedPlannerRouteIndex(0)
    setPlannerOptionsMinimized(false)
    setPlannerRouteMode(true)
    setPlannerOpen(false)
    setPlannerPickMode('waypoint')
    setPlannerMessage('Trail planning active. Tap the next point on the map.')
    setMarkedMapPoint(null)
  }, [markedMapPoint])

  const handleRoutesFromCurrentToMarkedPoint = useCallback(async () => {
    if (!markedMapPoint) return
    setPlannerStart(null)
    setPlannerDestination(markedMapPoint)
    setPlannerWaypoints([])
    setPlannerRoutes([])
    setSelectedPlannerRouteIndex(0)
    setPlannerOptionsMinimized(false)
    setPlannerOpen(true)
    setPlannerRouteMode(false)
    setPlannerPickMode('inspect')
    setMarkedMapPoint(null)
    await handleBuildPlannerRoutes({
      destination: markedMapPoint,
      waypoints: [],
    })
  }, [handleBuildPlannerRoutes, markedMapPoint])

  const handleAddMarkedPointAsStop = useCallback(() => {
    if (!markedMapPoint) return
    setPlannerWaypoints((current) => [...current, markedMapPoint].slice(0, 8))
    setPlannerMessage('Stop added. Tap another point or finish the route.')
    setMarkedMapPoint(null)
  }, [markedMapPoint])

  const handleFinishPlannerAtMarkedPoint = useCallback(async () => {
    if (!markedMapPoint) return
    const destination = markedMapPoint
    setPlannerDestination(destination)
    setPlannerOpen(true)
    setPlannerRouteMode(false)
    setPlannerPickMode('inspect')
    setMarkedMapPoint(null)
    await handleBuildPlannerRoutes({ destination })
  }, [handleBuildPlannerRoutes, markedMapPoint])

  const handleSelectPlannerRoute = useCallback(
    (index) => {
      setSelectedPlannerRouteIndex(index)
      const route = plannerRoutes[index]
      const bounds = buildBoundsFromCoordinates(route?.geometry?.coordinates || [])
      if (bounds) {
        mapRef.current?.getMap()?.fitBounds(bounds, {
          padding: 78,
          duration: 650,
          essential: true,
        })
      }
    },
    [plannerRoutes]
  )

  const handleMapClick = useCallback(
    (e) => {
      const map = mapRef.current?.getMap()
      if (!map) return
      const { lng, lat } = e.lngLat

      if (pingMode) {
        let snapped = [lng, lat]
        const trailId = activeTrailSession?.trailId

        const activeTrail = trailsById.get(String(trailId))
        const activeGeometry =
          parseTrailGeojson(activeTrail?.geojson) ||
          parseTrailGeojson(
            activeTrailSession?.pathCoordinates?.length
              ? {
                  type: 'LineString',
                  coordinates: activeTrailSession.pathCoordinates,
                }
              : null
          )

        if (activeGeometry) {
          const clickPt = turfPoint([lng, lat])
          try {
            const nearest = nearestPointOnLine(activeGeometry, clickPt)
            if (nearest?.geometry?.coordinates) {
              snapped = nearest.geometry.coordinates
            }
          } catch {
            /* Snapping ping placement is best-effort. */
          }
        }

        closeMapOverlays('pendingPing')
        setPendingPing({ coordinates: snapped, trailId })
        return
      }

      if (plannerRouteMode) {
        handleMarkedMapPoint([lng, lat])
        return
      }

      if (plannerOpen) {
        handlePlannerPoint([lng, lat])
        return
      }

      if (areaInsightsEnabled) {
        setSelectedAreaCenter([lng, lat])
      }

      if (skipNextMapClickSelectionRef.current) {
        skipNextMapClickSelectionRef.current = false
        return
      }

      const plannerFeatures = map.queryRenderedFeatures(e.point, {
        layers: [
          'pytechka-planner-routes-selected',
          'pytechka-planner-routes-alt',
        ].filter((id) => map.getLayer(id)),
      })
      const plannerIndex = Number(plannerFeatures?.[0]?.properties?.index)
      if (Number.isInteger(plannerIndex) && plannerRoutes[plannerIndex]) {
        setSelectedPlannerRouteIndex(plannerIndex)
        return
      }

      const features = map.queryRenderedFeatures(e.point, {
        layers: INTERACTIVE_TRAIL_LAYER_IDS.filter((id) => map.getLayer(id)),
      })
      if (!features.length) {
        handleMarkedMapPoint([lng, lat])
        return
      }

      handleTrailLayerFeatureClick({ features })
    },
    [
      pingMode,
      activeTrailSession,
      trailsById,
      setSelectedTrail,
      areaInsightsEnabled,
      plannerOpen,
      plannerRouteMode,
      plannerRoutes,
      closeMapOverlays,
      handlePlannerPoint,
      handleMarkedMapPoint,
      handleTrailLayerFeatureClick,
    ]
  )

  const handleFocusSelectedAreaTrail = useCallback(
    ({ trail, startCoordinates }) => {
      if (!Array.isArray(startCoordinates) || startCoordinates.length !== 2)
        return

      setSelectedAreaCenter(startCoordinates)
      setViewState((old) => ({
        ...old,
        longitude: startCoordinates[0],
        latitude: startCoordinates[1],
        zoom: Math.max(old.zoom, 12),
      }))

      mapRef.current?.getMap()?.flyTo({
        center: startCoordinates,
        zoom: 12,
        essential: true,
        duration: 650,
      })

      if (trail) {
        setSelectedTrail(trail)
      }
    },
    [setSelectedTrail]
  )

  const handleBeginTrail = useCallback(() => {
    if (!startPanelTrail) return

    if (!isSignedIn || !userId) {
      navigate('/login')
      return
    }

    const hasVerifiedDistance = startReadiness?.hasUserLocation === true
    const isOutOfStartRange =
      hasVerifiedDistance && startReadiness?.withinRange === false

    if (isOutOfStartRange) {
      setStartPanelError(
        startReadiness?.distanceToStartMeters
          ? `Move closer to the start point. You are ${Math.round(
            startReadiness.distanceToStartMeters
          )} m away and must be within 1000 m.`
          : 'Enable location and move within 1 km from the trail start to begin.'
      )
      return
    }

    if (startSafety.unsafe && !startUnsafeAcknowledged) {
      setStartPanelError('Review the safety suggestion and confirm that you still want to start.')
      return
    }

    const pathCoordinates = extractLineCoordinates(getTrailGeometry(startPanelTrail))
    if (!pathCoordinates.length) {
      setStartPanelError(
        'This trail has no usable coordinates for live sector tracking.'
      )
      return
    }

    const trailId = startPanelTrail._id || startPanelTrail.id
    const segments = buildSegmentModel(startPanelTrail, pathCoordinates.length)
    const totalDistanceMeters = resolveTrailTotalDistanceMeters(
      startPanelTrail,
      pathCoordinates
    )
    const totalElevationMeters = resolveTrailElevationMeters(startPanelTrail)

    startTrailActivity({
      trailId,
      trailName: startPanelTrail.name,
      trailDifficulty: startPanelTrail.difficulty,
      totalDistanceMeters,
      totalElevationMeters,
      pathCoordinates,
      segments,
      isLocalPlannerTrail: startPanelTrail.source === 'local_draft',
      plannerDraft:
        startPanelTrail.source === 'local_draft' ? startPanelTrail : null,
      startedAt: Date.now(),
    }, userLocation)
    setShowSectorSummary(false)
    setStartPanelTrail(null)
    setPingMode(false)
    setPendingPing(null)
    setStillTherePrompt(null)
    setFinishModalTrail(null)
    setFinishStats(null)
    promptedReportsRef.current = new Set()

    if (userLocation) {
      lastActivityPointRef.current = {
        longitude: userLocation.longitude,
        latitude: userLocation.latitude,
        altitude: userLocation.altitude,
      }
    } else {
      lastActivityPointRef.current = null
    }

    const bounds = buildBoundsFromCoordinates(pathCoordinates)
    if (bounds) {
      mapRef.current?.getMap()?.fitBounds(bounds, {
        padding: 76,
        duration: 800,
        essential: true,
      })
    }
  }, [
    startPanelTrail,
    isSignedIn,
    userId,
    navigate,
    startReadiness,
    startSafety,
    startUnsafeAcknowledged,
    startTrailActivity,
    userLocation,
  ])

  useEffect(() => {
    if (!activeTrailSession) return undefined

    ensureTrailTracking()

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        ensureTrailTracking()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [activeTrailSession, ensureTrailTracking])

  useEffect(() => {
    if (!activeTrailSession || !userLocation) return

    const current = [userLocation.longitude, userLocation.latitude]
    if (stillTherePrompt) return

    const nearbyPing = pings.find((ping) => {
      const key = `ping:${ping._id}`
      if (promptedReportsRef.current.has(key)) return false
      if (ping.photoUrl || ping.type === 'photo') return false
      return haversineMeters(current, ping.coordinates) <= 100
    })

    if (nearbyPing) {
      setStillTherePrompt({ type: 'ping', payload: nearbyPing })
      return
    }

    const nearbyCluster = clusters.find((cluster) => {
      const key = `cluster:${cluster._id}`
      if (promptedReportsRef.current.has(key)) return false
      return haversineMeters(current, cluster.coordinates) <= 100
    })

    if (nearbyCluster) {
      setStillTherePrompt({ type: 'cluster', payload: nearbyCluster })
    }
  }, [activeTrailSession, userLocation, pings, clusters, stillTherePrompt])

  useEffect(() => {
    if (activeTrailSession) return
    setPingMode(false)
    setPendingPing(null)
    setShowPhotoModal(false)
    setCapturedPhoto(null)
  }, [activeTrailSession])

  const handleKeepPrompt = useCallback(() => {
    if (!stillTherePrompt) return

    const key = `${stillTherePrompt.type}:${stillTherePrompt.payload._id}`
    promptedReportsRef.current.add(key)
    setStillTherePrompt(null)
  }, [stillTherePrompt])

  const handleVotePromptGone = useCallback(async () => {
    if (!stillTherePrompt) return

    setStillThereSubmitting(true)
    const { type, payload } = stillTherePrompt
    const key = `${type}:${payload._id}`

    try {
      if (type === 'ping') {
        await votePingGone(payload._id)
        setPings((prev) => prev.filter((entry) => entry._id !== payload._id))
      } else {
        const res = await voteClusterGone(payload._id)
        if (res.data?.resolved) {
          setClusters((prev) =>
            prev.filter((entry) => entry._id !== payload._id)
          )
          fetchPings()
            .then((r) => setPings(Array.isArray(r.data) ? r.data : []))
            .catch(() => { })
        } else {
          setClusters((prev) =>
            prev.map((entry) => (entry._id === payload._id ? res.data : entry))
          )
        }
      }
    } catch (err) {
      if (err?.response?.status === 404) {
        if (type === 'ping') {
          setPings((prev) => prev.filter((entry) => entry._id !== payload._id))
        } else {
          setClusters((prev) =>
            prev.filter((entry) => entry._id !== payload._id)
          )
        }
        return
      }
      console.error('Still-there vote failed:', err)
    } finally {
      promptedReportsRef.current.add(key)
      setStillTherePrompt(null)
      setStillThereSubmitting(false)
    }
  }, [stillTherePrompt])

  const handleFinishTrail = useCallback(() => {
    if (!activeTrailSession) return

    if (activeTrailSession.isLocalPlannerTrail && activeTrailSession.plannerDraft) {
      setPlannerDraftFormTrail({
        ...activeTrailSession.plannerDraft,
        stats: {
          ...(activeTrailSession.plannerDraft.stats || {}),
          distance: Math.round(
            activityDistanceMeters ||
              activeTrailSession.plannerDraft.stats?.distance ||
              0
          ),
          duration: activityDurationSeconds,
          elevationGain: Math.round(activityElevationGain || 0),
        },
      })
      clearTrailActivity()
      setShowSectorSummary(false)
      setPingMode(false)
      setPendingPing(null)
      setStillTherePrompt(null)
      lastActivityPointRef.current = null
      setSelectedTrail(null)
      setSelectedOfficialTrail(null)
      return
    }

    const trail = trails.find(
      (entry) =>
        String(entry._id || entry.id) === String(activeTrailSession.trailId)
    ) || {
      _id: activeTrailSession.trailId,
      name: activeTrailSession.trailName,
      difficulty: activeTrailSession.trailDifficulty,
    }

    setFinishModalTrail(trail)
    setFinishStats({
      distanceMeters: Math.round(activityDistanceMeters),
      durationSeconds: activityDurationSeconds,
      sectorName: activeSector?.name || 'N/A',
      sectorDifficulty: activeSector?.difficulty || 'moderate',
    })
    setFinishRating(0)
    setFinishComment('')
    setFinishError('')
    setFinishSuccess('')

    clearTrailActivity()
    setShowSectorSummary(false)
    setPingMode(false)
    setPendingPing(null)
    setStillTherePrompt(null)
    lastActivityPointRef.current = null
    setSelectedTrail(null)
    setSelectedOfficialTrail(null)
  }, [
    activeTrailSession,
    trails,
    activityDistanceMeters,
    activityDurationSeconds,
    activityElevationGain,
    activeSector,
    clearTrailActivity,
    setSelectedTrail,
  ])

  const handleSubmitFinish = useCallback(async () => {
    if (!finishModalTrail) return

    setFinishSubmitting(true)
    setFinishError('')
    setFinishSuccess('')

    const trailId = finishModalTrail._id || finishModalTrail.id

    try {
      const payload = {
        durationSeconds: finishStats?.durationSeconds || 0,
        distanceMeters: finishStats?.distanceMeters || 0,
        ...(finishRating > 0 ? { accuracy: finishRating } : {}),
        ...(finishComment.trim() ? { comment: finishComment.trim() } : {}),
      }

      const res = await completeTrailFromMap(trailId, payload)
      const data = res?.data || {}

      if (data.reviewAdded) {
        setFinishSuccess(
          'Trail completed and your rating was saved. Great work!'
        )
      } else if (finishRating > 0 && data.alreadyReviewed) {
        setFinishSuccess(
          'Trail completed. You have already reviewed this trail before.'
        )
      } else {
        setFinishSuccess('Trail completed successfully. Nice effort!')
      }

      setTimeout(() => {
        setFinishModalTrail(null)
        setFinishStats(null)
      }, 1200)
    } catch (err) {
      setFinishError(
        err?.response?.data?.error || 'Could not complete this trail right now.'
      )
    } finally {
      setFinishSubmitting(false)
    }
  }, [finishModalTrail, finishStats, finishRating, finishComment])

  if (!MAPBOX_TOKEN) {
    return (
      <div id="map-container" style={styles.container}>
        <div style={styles.fallback}>
          <div style={styles.fallbackCard}>
            <h3 style={{ margin: '0 0 8px 0' }}>Map cannot start</h3>
            <p style={{ margin: 0, lineHeight: 1.45, color: '#cbd5e1' }}>
              Missing VITE_MAPBOX_TOKEN in frontend environment. Mapbox-only
              mode is enabled.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div id="map-container" style={styles.container}>
      <Map
        ref={mapRef}
        {...viewState}
        onMove={(e) => setViewState(e.viewState)}
        mapboxAccessToken={MAPBOX_TOKEN}
        mapStyle={resolvedMapStyle}
        style={{ width: '100%', height: '100%' }}
        onLoad={handleMapLoad}
        onError={handleMapError}
        onClick={handleMapClick}
        attributionControl={false}
      >
        {mapReady ? (
          <>
            {hillshadeRelief ? (
              <Source
                id={RELIEF_DEM_SOURCE_ID}
                type="raster-dem"
                url="mapbox://mapbox.mapbox-terrain-dem-v1"
                tileSize={512}
                maxzoom={14}
              >
                <Layer
                  id="pytechka-hillshade-relief"
                  type="hillshade"
                  paint={{
                    'hillshade-exaggeration': 0.42,
                    'hillshade-shadow-color': '#0f172a',
                    'hillshade-highlight-color': '#e2e8f0',
                    'hillshade-accent-color': '#4281a4',
                  }}
                />
              </Source>
            ) : null}

            <Source
              id={TRAIL_SOURCE_ID}
              type="geojson"
              data={visibleTrailSourceCollection}
            >
              <Layer
                id={`${TRAIL_LAYER_IDS.unmarked}-casing`}
                type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                filter={[
                  'all',
                  ['==', ['get', 'colour_type'], 'unmarked'],
                  ['!=', ['get', 'source'], 'user'],
                ]}
                paint={{
                  'line-color': '#0f172a',
                  'line-width': 6,
                  'line-opacity': 0.9,
                }}
              />
              <Layer
                id={TRAIL_LAYER_IDS.unmarked}
                type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                filter={[
                  'all',
                  ['==', ['get', 'colour_type'], 'unmarked'],
                  ['!=', ['get', 'source'], 'user'],
                ]}
                paint={{
                  'line-color': '#000000',
                  'line-width': 3,
                  'line-opacity': 0.7,
                  'line-dasharray': [2, 2],
                }}
              />

              <Layer
                id={`${TRAIL_LAYER_IDS.yellow}-casing`}
                type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                filter={[
                  'all',
                  ['==', ['get', 'colour_type'], 'yellow'],
                  ['!=', ['get', 'source'], 'user'],
                ]}
                paint={{
                  'line-color': '#0f172a',
                  'line-width': 6,
                  'line-opacity': 0.9,
                }}
              />

              <Layer
                id={TRAIL_LAYER_IDS.yellow}
                type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                filter={[
                  'all',
                  ['==', ['get', 'colour_type'], 'yellow'],
                  ['!=', ['get', 'source'], 'user'],
                ]}
                paint={{
                  'line-color': '#FFD700',
                  'line-width': 3.5,
                  'line-opacity': 0.9,
                }}
              />

              <Layer
                id={`${TRAIL_LAYER_IDS.green}-casing`}
                type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                filter={[
                  'all',
                  ['==', ['get', 'colour_type'], 'green'],
                  ['!=', ['get', 'source'], 'user'],
                ]}
                paint={{
                  'line-color': '#0f172a',
                  'line-width': 6,
                  'line-opacity': 0.9,
                }}
              />

              <Layer
                id={TRAIL_LAYER_IDS.green}
                type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                filter={[
                  'all',
                  ['==', ['get', 'colour_type'], 'green'],
                  ['!=', ['get', 'source'], 'user'],
                ]}
                paint={{
                  'line-color': '#22c55e',
                  'line-width': 3.5,
                  'line-opacity': 0.9,
                }}
              />

              <Layer
                id={`${TRAIL_LAYER_IDS.blue}-casing`}
                type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                filter={[
                  'all',
                  ['==', ['get', 'colour_type'], 'blue'],
                  ['!=', ['get', 'source'], 'user'],
                ]}
                paint={{
                  'line-color': '#0f172a',
                  'line-width': 6,
                  'line-opacity': 0.9,
                }}
              />

              <Layer
                id={TRAIL_LAYER_IDS.blue}
                type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                filter={[
                  'all',
                  ['==', ['get', 'colour_type'], 'blue'],
                  ['!=', ['get', 'source'], 'user'],
                ]}
                paint={{
                  'line-color': '#2563eb',
                  'line-width': 3.5,
                  'line-opacity': 0.9,
                }}
              />

              <Layer
                id={TRAIL_LAYER_IDS.whiteCasing}
                type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                filter={[
                  'all',
                  ['==', ['get', 'colour_type'], 'white'],
                  ['!=', ['get', 'source'], 'user'],
                ]}
                paint={{
                  'line-color': '#0f172a',
                  'line-width': 7,
                  'line-opacity': 0.95,
                }}
              />

              <Layer
                id={TRAIL_LAYER_IDS.whiteMain}
                type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                filter={[
                  'all',
                  ['==', ['get', 'colour_type'], 'white'],
                  ['!=', ['get', 'source'], 'user'],
                ]}
                paint={{
                  'line-color': '#ffffff',
                  'line-width': 4,
                  'line-opacity': 0.95,
                }}
              />

              <Layer
                id={`${TRAIL_LAYER_IDS.black}-casing`}
                type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                filter={[
                  'all',
                  ['==', ['get', 'colour_type'], 'black'],
                  ['!=', ['get', 'source'], 'user'],
                ]}
                paint={{
                  'line-color': '#e2e8f0',
                  'line-width': 5,
                  'line-opacity': 0.8,
                }}
              />

              <Layer
                id={TRAIL_LAYER_IDS.black}
                type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                filter={[
                  'all',
                  ['==', ['get', 'colour_type'], 'black'],
                  ['!=', ['get', 'source'], 'user'],
                ]}
                paint={{
                  'line-color': '#0f172a',
                  'line-width': 4.5,
                  'line-opacity': 0.92,
                }}
              />

              <Layer
                id={`${TRAIL_LAYER_IDS.red}-casing`}
                type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                filter={[
                  'all',
                  ['==', ['get', 'colour_type'], 'red'],
                  ['!=', ['get', 'source'], 'user'],
                ]}
                paint={{
                  'line-color': '#0f172a',
                  'line-width': 6,
                  'line-opacity': 0.9,
                }}
              />

              <Layer
                id={TRAIL_LAYER_IDS.red}
                type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                filter={[
                  'all',
                  ['==', ['get', 'colour_type'], 'red'],
                  ['!=', ['get', 'source'], 'user'],
                ]}
                paint={{
                  'line-color': '#dc2626',
                  'line-width': 4.5,
                  'line-opacity': 0.92,
                }}
              />

              <Layer
                id={TRAIL_LAYER_IDS.featuredCasing}
                type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                filter={['==', ['get', 'source'], 'osm_featured']}
                paint={{
                  'line-color': '#0f172a',
                  'line-width': 8,
                  'line-opacity': 0.95,
                }}
              />

              <Layer
                id={TRAIL_LAYER_IDS.featuredMain}
                type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                filter={['==', ['get', 'source'], 'osm_featured']}
                paint={{
                  'line-color': [
                    'match',
                    ['upcase', ['get', 'ref']],
                    'E3',
                    '#dc2626',
                    'E4',
                    '#2563eb',
                    'E8',
                    '#7c3aed',
                    '#dc2626',
                  ],
                  'line-width': 5.5,
                  'line-opacity': 0.98,
                }}
              />

              <Layer
                id={`${TRAIL_LAYER_IDS.user}-casing`}
                type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                filter={['==', ['get', 'source'], 'user']}
                paint={{
                  'line-color': '#0f172a',
                  'line-width': 9,
                  'line-opacity': 0.9,
                }}
              />

              <Layer
                id={TRAIL_LAYER_IDS.user}
                type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                filter={['==', ['get', 'source'], 'user']}
                paint={{
                  'line-color': [
                    'match',
                    ['get', 'difficulty'],
                    'easy',
                    '#22c55e',
                    'moderate',
                    '#f97316',
                    'hard',
                    '#ef4444',
                    'extreme',
                    '#7f1d1d',
                    '#64748b',
                  ],
                  'line-width': 5,
                  'line-opacity': 0.94,
                }}
              />
            </Source>

            {viewState.zoom >= 9 &&
              huts.map((hut) => {
                const isSelected = selectedHut?._id === hut._id
                return (
                  <Marker
                    key={hut._id || hut.name}
                    longitude={hut.location[0]}
                    latitude={hut.location[1]}
                    anchor="bottom"
                    style={{
                      cursor: 'pointer',
                      zIndex: isSelected ? 10 : 1,
                    }}
                  >
                    <HutMarkerButton
                      title={hut.name}
                      selected={isSelected}
                      activePanel={selectedHutPanel}
                      onToggle={() => {
                        closeMapOverlays(isSelected ? '' : 'selectedHut')
                        setSelectedHut(isSelected ? null : hut)
                        setSelectedHutPanel('info')
                      }}
                      onPanelChange={(panel) => {
                        closeMapOverlays('selectedHut')
                        setSelectedHut(hut)
                        setSelectedHutPanel(panel)
                      }}
                    />
                  </Marker>
                )
              })}

            {loadedRouteEndpoints ? (
              <>
                <Marker
                  longitude={loadedRouteEndpoints.startCoordinates[0]}
                  latitude={loadedRouteEndpoints.startCoordinates[1]}
                  anchor="bottom"
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                      color: '#f8fafc',
                      fontSize: 12,
                      fontWeight: 900,
                      display: 'grid',
                      placeItems: 'center',
                      border: '2px solid #f8fafc',
                      boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
                    }}
                    title="Route start"
                  >
                    S
                  </div>
                </Marker>
                <Marker
                  longitude={loadedRouteEndpoints.endCoordinates[0]}
                  latitude={loadedRouteEndpoints.endCoordinates[1]}
                  anchor="bottom"
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                      color: '#f8fafc',
                      fontSize: 12,
                      fontWeight: 900,
                      display: 'grid',
                      placeItems: 'center',
                      border: '2px solid #f8fafc',
                      boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
                    }}
                    title="Route finish"
                  >
                    F
                  </div>
                </Marker>
              </>
            ) : null}

            {userLocation ? (
              <Marker
                longitude={userLocation.longitude}
                latitude={userLocation.latitude}
                anchor="center"
              >
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    background: '#0ea5e9',
                    border: '2px solid #f8fafc',
                    boxShadow: '0 0 0 6px rgba(14,165,233,0.22)',
                  }}
                  title="Your current position"
                />
              </Marker>
            ) : null}

            {searchResultMarker ? (
              <Marker
                longitude={searchResultMarker.coordinates[0]}
                latitude={searchResultMarker.coordinates[1]}
                anchor="bottom"
              >
                <div
                  style={{
                    minWidth: 34,
                    height: 34,
                    borderRadius: 999,
                    background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
                    color: '#fff',
                    display: 'grid',
                    placeItems: 'center',
                    border: '2px solid #f8fafc',
                    boxShadow: '0 8px 18px rgba(0,0,0,0.38)',
                    fontWeight: 900,
                    fontSize: 13,
                  }}
                  title={searchResultMarker.label}
                >
                  Go
                </div>
              </Marker>
            ) : null}

            {hasVectorTileset ? (
              <Source
                id="custom-tileset-source"
                type="vector"
                url={MAPBOX_TILESET_URL}
              >
                <Layer
                  id="custom-tileset-layer"
                  type="line"
                  source="custom-tileset-source"
                  source-layer={MAPBOX_TILESET_SOURCE_LAYER}
                  paint={{
                    'line-color': MAPBOX_TILESET_LINE_COLOR,
                    'line-width': MAPBOX_TILESET_LINE_WIDTH,
                  }}
                />
              </Source>
            ) : null}

            {hasRasterTileset ? (
              <Source
                id="custom-tileset-source"
                type="raster"
                url={MAPBOX_TILESET_URL}
              >
                <Layer
                  id="custom-tileset-raster-layer"
                  type="raster"
                  paint={{ 'raster-opacity': 0.9 }}
                />
              </Source>
            ) : null}

            {startPanelSegmentFeatures && !activeTrailSession ? (
              <Source
                id="map-start-segments"
                type="geojson"
                data={startPanelSegmentFeatures}
              >
                <Layer
                  id="map-start-segment-line"
                  type="line"
                  layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                  paint={{
                    'line-color': SEGMENT_COLOR_EXPRESSION,
                    'line-width': 5,
                    'line-opacity': 0.95,
                  }}
                />
              </Source>
            ) : null}

            {activeTrailSegmentFeatures ? (
              <Source
                id="map-active-segments"
                type="geojson"
                data={activeTrailSegmentFeatures}
              >
                <Layer
                  id="map-active-segment-line"
                  type="line"
                  layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                  paint={{
                    'line-color': SEGMENT_COLOR_EXPRESSION,
                    'line-width': 6,
                    'line-opacity': 0.98,
                  }}
                />
              </Source>
            ) : null}

            {approachRoute ? (
              <Source id="map-approach-route" type="geojson" data={approachRoute}>
                <Layer
                  id="map-approach-route-casing"
                  type="line"
                  layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                  paint={{
                    'line-color': '#0f172a',
                    'line-width': 8,
                    'line-opacity': 0.85,
                  }}
                />
                <Layer
                  id="map-approach-route-line"
                  type="line"
                  layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                  paint={{
                    'line-color': '#38bdf8',
                    'line-width': 4,
                    'line-opacity': 0.98,
                    'line-dasharray': [1.2, 1],
                  }}
                />
              </Source>
            ) : null}

            {plannerRouteFeatures ? (
              <Source
                id={PLANNER_ROUTE_SOURCE_ID}
                type="geojson"
                data={plannerRouteFeatures}
              >
                <Layer
                  id="pytechka-planner-routes-alt-casing"
                  type="line"
                  filter={['==', ['get', 'selected'], false]}
                  layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                  paint={{
                    'line-color': '#020617',
                    'line-width': 6,
                    'line-opacity': 0.7,
                  }}
                />
                <Layer
                  id="pytechka-planner-routes-alt"
                  type="line"
                  filter={['==', ['get', 'selected'], false]}
                  layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                  paint={{
                    'line-color': '#38bdf8',
                    'line-width': 3,
                    'line-opacity': 0.58,
                    'line-dasharray': [1.5, 0.7],
                  }}
                />
                <Layer
                  id="pytechka-planner-routes-selected-casing"
                  type="line"
                  filter={['==', ['get', 'selected'], true]}
                  layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                  paint={{
                    'line-color': '#020617',
                    'line-width': 9,
                    'line-opacity': 0.86,
                  }}
                />
                <Layer
                  id="pytechka-planner-routes-selected"
                  type="line"
                  filter={['==', ['get', 'selected'], true]}
                  layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                  paint={{
                    'line-color': '#22c55e',
                    'line-width': 5,
                    'line-opacity': 0.98,
                  }}
                />
              </Source>
            ) : null}

            {selectedAreaFeature ? (
              <Source
                id="map-selected-area"
                type="geojson"
                data={selectedAreaFeature}
              >
                <Layer
                  id="map-selected-area-fill"
                  type="fill"
                  paint={{
                    'fill-color': '#48a9a6',
                    'fill-opacity': 0.18,
                  }}
                />
                <Layer
                  id="map-selected-area-line"
                  type="line"
                  paint={{
                    'line-color': '#4281a4',
                    'line-width': 2,
                  }}
                />
              </Source>
            ) : null}

            {selectedAreaCenter ? (
              <Marker
                longitude={selectedAreaCenter[0]}
                latitude={selectedAreaCenter[1]}
                anchor="center"
              >
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: '#48a9a6',
                    border: '2px solid #fbfef9',
                    boxShadow: '0 0 0 4px rgba(72,169,166,0.22)',
                  }}
                />
              </Marker>
            ) : null}

            {(plannerOpen || plannerRouteMode) && plannerStart ? (
              <Marker
                longitude={plannerStart.coordinates[0]}
                latitude={plannerStart.coordinates[1]}
                anchor="center"
              >
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    background: '#16a34a',
                    color: '#fff',
                    border: '2px solid #ecfeff',
                    boxShadow: '0 6px 16px rgba(0,0,0,0.34)',
                    fontWeight: 900,
                    fontSize: 13,
                  }}
                  title={makePointLabel(plannerStart, 'Start')}
                >
                  S
                </div>
              </Marker>
            ) : null}

            {(plannerOpen || plannerRouteMode) &&
              plannerWaypoints.map((point, index) => (
                <Marker
                  key={point.id}
                  longitude={point.coordinates[0]}
                  latitude={point.coordinates[1]}
                  anchor="center"
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      display: 'grid',
                      placeItems: 'center',
                      background: '#2563eb',
                      color: '#fff',
                      border: '2px solid #dbeafe',
                      boxShadow: '0 5px 14px rgba(0,0,0,0.32)',
                      fontWeight: 900,
                      fontSize: 12,
                    }}
                    title={makePointLabel(point, `Waypoint ${index + 1}`)}
                  >
                    {index + 1}
                  </div>
                </Marker>
              ))}

            {(plannerOpen || plannerRouteMode) && plannerDestination ? (
              <Marker
                longitude={plannerDestination.coordinates[0]}
                latitude={plannerDestination.coordinates[1]}
                anchor="center"
              >
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    background: '#dc2626',
                    color: '#fff',
                    border: '2px solid #fee2e2',
                    boxShadow: '0 6px 16px rgba(0,0,0,0.34)',
                    fontWeight: 900,
                    fontSize: 13,
                  }}
                  title={makePointLabel(plannerDestination, 'Destination')}
                >
                  D
                </div>
              </Marker>
            ) : null}

            {markedMapPoint ? (
              <Marker
                longitude={markedMapPoint.coordinates[0]}
                latitude={markedMapPoint.coordinates[1]}
                anchor="bottom"
              >
                <div
                  style={{
                    minWidth: 34,
                    height: 34,
                    borderRadius: 999,
                    background: 'linear-gradient(135deg, #48a9a6, #2563eb)',
                    color: '#fff',
                    display: 'grid',
                    placeItems: 'center',
                    border: '2px solid #ecfeff',
                    boxShadow: '0 8px 18px rgba(0,0,0,0.35)',
                    fontWeight: 900,
                    fontSize: 13,
                  }}
                  title={makePointLabel(markedMapPoint, 'Marked location')}
                >
                  P
                </div>
              </Marker>
            ) : null}

            {pings.map((ping) => {
                const cfg = PING_TYPES[ping.type] || PING_TYPES.junk
                const isPhoto = Boolean(ping.photoUrl)
                const categoryMeta =
                  PHOTO_CATEGORY_META[ping.photoCategory] ||
                  PHOTO_CATEGORY_META.memory

                if (!isPhoto && viewState.zoom < 12) return null

                if (isPhoto) {
                  return (
                    <Marker
                      key={ping._id}
                      longitude={ping.coordinates[0]}
                      latitude={ping.coordinates[1]}
                      anchor="center"
                      onClick={(e) => {
                        e.originalEvent.stopPropagation()
                        closeMapOverlays('selectedPing')
                        setSelectedPing(
                          selectedPing?._id === ping._id ? null : ping
                        )
                      }}
                    >
                      <div
                        style={{
                          ...photoMarkerStyle,
                          border: `2px solid ${categoryMeta.color}`,
                        }}
                        title={`${categoryMeta.label}: ${ping.description || 'No description'}`}
                      >
                        <img
                          src={ping.photoUrl}
                          alt={ping.description || 'Photo'}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                          }}
                        />
                      </div>
                    </Marker>
                  )
                }

                return (
                  <Marker
                    key={ping._id}
                    longitude={ping.coordinates[0]}
                    latitude={ping.coordinates[1]}
                    anchor="center"
                    onClick={(e) => {
                      e.originalEvent.stopPropagation()
                      closeMapOverlays('selectedPing')
                      setSelectedPing(
                        selectedPing?._id === ping._id ? null : ping
                      )
                    }}
                  >
                    <div
                      style={{ ...pingMarkerStyle, background: cfg.color }}
                      title={`${cfg.label}: ${ping.description || 'No description'}`}
                    >
                      {cfg.marker}
                    </div>
                  </Marker>
                )
              })}

            {clusters.map((cluster) => {
              const cfg =
                CLUSTER_CONFIG[cluster.level] || CLUSTER_CONFIG.clutter
              return (
                <Marker
                  key={cluster._id}
                  longitude={cluster.coordinates[0]}
                  latitude={cluster.coordinates[1]}
                  anchor="center"
                  onClick={(e) => {
                    e.originalEvent.stopPropagation()
                    closeMapOverlays('selectedCluster')
                    setSelectedCluster(
                      selectedCluster?._id === cluster._id ? null : cluster
                    )
                    setSelectedPing(null)
                  }}
                >
                  <div
                    style={{
                      ...clusterMarkerStyle,
                      background: cfg.color,
                    }}
                    title={`${cfg.label}: ${cluster.description || ''}`}
                  >
                    {cfg.marker}
                  </div>
                </Marker>
              )
            })}

            {pendingPing ? (
              <Marker
                longitude={pendingPing.coordinates[0]}
                latitude={pendingPing.coordinates[1]}
                anchor="center"
              >
                <div
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: '#f43f5e',
                    border: '3px solid #fff',
                    boxShadow: '0 0 0 4px rgba(244,63,94,0.35)',
                  }}
                />
              </Marker>
            ) : null}
          </>
        ) : null}
      </Map>

      <LiveCompass
        mapBearing={viewState.bearing}
        movementHeading={compassSyncEnabled ? movementHeading : null}
        liveEnabled={compassSyncEnabled}
        top={
          isTrailFlowOverlayOpen
            ? 'calc(env(safe-area-inset-top, 0px) + 222px)'
            : 'calc(env(safe-area-inset-top, 0px) + 132px)'
        }
        left={18}
      />
      <EmergencyButton
        top={
          isTrailFlowOverlayOpen
            ? 'calc(env(safe-area-inset-top, 0px) + 316px)'
            : 'calc(env(safe-area-inset-top, 0px) + 226px)'
        }
        left={22}
        zIndex={25}
      />

      {!activeTrailSession ? (
        <button
          type="button"
          onClick={() => {
            const willOpen = !plannerOpen
            if (willOpen) closeMapOverlays('planner')
            setPlannerOpen(willOpen)
            setPlannerRouteMode(false)
            setPlannerError('')
            setPlannerMessage('')
            if (willOpen) {
              setPlannerPickMode('destination')
            }
          }}
          style={{
            position: 'absolute',
            right: 12,
            bottom: 'calc(var(--app-bottom-nav-space, 86px) + 24px)',
            zIndex: 28,
            width: 46,
            height: 46,
            borderRadius: 16,
            border: '1px solid rgba(141,224,220,0.42)',
            background: plannerOpen || plannerRouteMode
              ? 'linear-gradient(135deg, #48a9a6, #4281a4)'
              : 'rgba(15,23,42,0.94)',
            color: '#e2f8f7',
            display: 'grid',
            placeItems: 'center',
            boxShadow: '0 10px 24px rgba(0,0,0,0.36)',
            cursor: 'pointer',
          }}
          aria-pressed={plannerOpen || plannerRouteMode}
          aria-label="Open trail planner"
          title="Plan trail"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="6" cy="18" r="2.3" />
            <circle cx="18" cy="6" r="2.3" />
            <path d="M8 17c4.5-1.1 6.9-3.5 8-9" />
            <path d="M6 15.7V9a3 3 0 0 1 3-3h6.7" />
          </svg>
        </button>
      ) : null}

      {plannerRouteMode ? (
        <div
          style={{
            position: 'absolute',
            right: 18,
            bottom: isTrailFlowOverlayOpen
              ? 'calc(var(--app-bottom-nav-space, 86px) + 198px)'
              : 'calc(var(--app-bottom-nav-space, 86px) + 84px)',
            zIndex: 28,
            padding: '7px 10px',
            borderRadius: 999,
            border: '1px solid rgba(141,224,220,0.38)',
            background: 'rgba(15,23,42,0.92)',
            color: '#e2f8f7',
            fontSize: 11,
            fontWeight: 900,
            boxShadow: '0 8px 18px rgba(0,0,0,0.28)',
          }}
        >
          Planning · tap next point
        </div>
      ) : null}

      {markedMapPoint && !plannerOpen ? (
        <div
          style={{
            ...pingPopupStyle,
            zIndex: 35,
            padding: '14px 14px 16px',
            display: 'grid',
            gap: 10,
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 10,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, color: '#8de0dc', fontWeight: 900 }}>
                {plannerRouteMode ? 'ROUTE POINT' : 'MARKED LOCATION'}
              </div>
              <div
                style={{
                  fontSize: 17,
                  fontWeight: 900,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {makePointLabel(markedMapPoint, 'Marked location')}
              </div>
              {markedMapPoint.category ? (
                <div style={{ fontSize: 12, color: '#9fb9d0', marginTop: 2 }}>
                  {markedMapPoint.category}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setMarkedMapPoint(null)}
              style={{
                ...pingBtnBase,
                padding: '7px 11px',
                background: 'rgba(148,163,184,0.14)',
                color: '#cbd5e1',
              }}
            >
              Close
            </button>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 8,
            }}
          >
            <div
              style={{
                border: '1px solid rgba(66,129,164,0.28)',
                borderRadius: 12,
                padding: '8px 9px',
                background: 'rgba(2,6,23,0.36)',
              }}
            >
              <div style={{ fontSize: 10, color: '#89afc2', fontWeight: 800 }}>
                LAT
              </div>
              <div style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 800 }}>
                {Number(markedMapPoint.coordinates[1]).toFixed(5)}
              </div>
            </div>
            <div
              style={{
                border: '1px solid rgba(66,129,164,0.28)',
                borderRadius: 12,
                padding: '8px 9px',
                background: 'rgba(2,6,23,0.36)',
              }}
            >
              <div style={{ fontSize: 10, color: '#89afc2', fontWeight: 800 }}>
                LNG
              </div>
              <div style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 800 }}>
                {Number(markedMapPoint.coordinates[0]).toFixed(5)}
              </div>
            </div>
            <div
              style={{
                border: '1px solid rgba(66,129,164,0.28)',
                borderRadius: 12,
                padding: '8px 9px',
                background: 'rgba(2,6,23,0.36)',
              }}
            >
              <div style={{ fontSize: 10, color: '#89afc2', fontWeight: 800 }}>
                ELEV
              </div>
              <div style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 800 }}>
                {Number.isFinite(markedMapPoint.elevation)
                  ? `${Math.round(markedMapPoint.elevation)} m`
                  : '--'}
              </div>
            </div>
          </div>

          {plannerRouteMode && plannerStart ? (
            <div style={{ fontSize: 12, color: '#bfd4de' }}>
              From route start:{' '}
              <strong style={{ color: '#8de0dc' }}>
                {(haversineMeters(
                  plannerStart.coordinates,
                  markedMapPoint.coordinates
                ) / 1000).toFixed(2)}{' '}
                km direct
              </strong>
            </div>
          ) : null}

          {plannerRouteMode ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button
                type="button"
                onClick={handleAddMarkedPointAsStop}
                style={{
                  ...pingBtnBase,
                  background: 'rgba(37,99,235,0.25)',
                  color: '#bfdbfe',
                  border: '1px solid rgba(147,197,253,0.28)',
                }}
              >
                Add stop
              </button>
              <button
                type="button"
                onClick={handleFinishPlannerAtMarkedPoint}
                disabled={plannerLoading}
                style={{
                  ...pingBtnBase,
                  background: 'linear-gradient(135deg, #48a9a6, #4281a4)',
                  color: '#fff',
                  opacity: plannerLoading ? 0.65 : 1,
                }}
              >
                Finish route
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button
                type="button"
                onClick={handleCreateTrailFromMarkedPoint}
                style={{
                  ...pingBtnBase,
                  background: 'rgba(34,197,94,0.2)',
                  color: '#bbf7d0',
                  border: '1px solid rgba(134,239,172,0.28)',
                }}
              >
                Create trail
              </button>
              <button
                type="button"
                onClick={handleRoutesFromCurrentToMarkedPoint}
                disabled={plannerLoading}
                style={{
                  ...pingBtnBase,
                  background: 'rgba(56,189,248,0.18)',
                  color: '#bae6fd',
                  border: '1px solid rgba(125,211,252,0.28)',
                  opacity: plannerLoading ? 0.65 : 1,
                }}
              >
                Routes from me
              </button>
            </div>
          )}
        </div>
      ) : null}

      {plannerRoutes.length > 0 &&
      !plannerOpen &&
      !plannerRouteMode &&
      !activeTrailSession &&
      !plannerDraftFormTrail &&
      !plannerOptionsMinimized &&
      !markedMapPoint ? (
        <div
          style={{
            position: 'absolute',
            left: 10,
            right: 10,
            bottom: MAP_DRAWER_BOTTOM_GAP,
            zIndex: 34,
            borderRadius: 22,
            border: '1px solid rgba(66,129,164,0.48)',
            background: 'rgba(17,26,40,0.96)',
            color: '#e2e8f0',
            boxShadow: '0 -12px 28px rgba(0,0,0,0.34)',
            backdropFilter: 'blur(12px)',
            padding: '12px 12px 14px',
            display: 'grid',
            gap: 10,
            maxHeight: 'min(42dvh, 360px)',
            overflowY: 'auto',
            animation: 'map-drawer-in 180ms ease-out both',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: '#8de0dc', fontWeight: 900 }}>
                ROUTE OPTIONS
              </div>
              <div style={{ fontSize: 16, fontWeight: 900 }}>
                Tap a route on the map or choose below
              </div>
            </div>
            <div style={{ display: 'flex', gap: 7 }}>
              <button
                type="button"
                onClick={() => setPlannerOptionsMinimized(true)}
                style={{
                  ...pingBtnBase,
                  background: 'rgba(15,23,42,0.52)',
                  color: '#cbd5e1',
                  minWidth: 58,
                }}
              >
                Hide
              </button>
              <button
                type="button"
                onClick={() => setPlannerOpen(true)}
                style={{
                  ...pingBtnBase,
                  background: 'rgba(148,163,184,0.15)',
                  color: '#cbd5e1',
                  minWidth: 58,
                }}
              >
                Edit
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
            {plannerRoutes.map((route, index) => {
              const isSelected = index === selectedPlannerRouteIndex
              return (
                <button
                  key={`planner-review-route-${index}`}
                  type="button"
                  onClick={() => handleSelectPlannerRoute(index)}
                  style={{
                    flex: '0 0 140px',
                    border: `1px solid ${
                      isSelected
                        ? 'rgba(134,239,172,0.76)'
                        : 'rgba(66,129,164,0.34)'
                    }`,
                    borderRadius: 14,
                    padding: '9px 10px',
                    background: isSelected
                      ? 'rgba(34,197,94,0.2)'
                      : 'rgba(15,23,42,0.58)',
                    color: '#e2e8f0',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontWeight: 900 }}>
                    <span>Route {index + 1}</span>
                    <span>{formatPlannerDistance(route.telemetry?.distance || route.distance)}</span>
                  </div>
                  <div style={{ color: '#a8bdca', fontSize: 12, marginTop: 4, fontWeight: 800 }}>
                    {formatPlannerDuration(route.telemetry?.naismithDuration || route.duration)} ·{' '}
                    {DIFFICULTY_LABEL[route.telemetry?.difficulty] || 'Moderate'}
                  </div>
                </button>
              )
            })}
          </div>

          {selectedPlannerRoute?.telemetry ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
              {[
                ['Dist', formatPlannerDistance(selectedPlannerRoute.telemetry.distance)],
                [
                  'Time',
                  formatPlannerDuration(
                    selectedPlannerRoute.telemetry.naismithDuration ||
                      selectedPlannerRoute.telemetry.duration
                  ),
                ],
                [
                  'Gain',
                  selectedPlannerRoute.telemetry.elevationGain == null
                    ? '--'
                    : formatPlannerMeters(selectedPlannerRoute.telemetry.elevationGain),
                ],
                [
                  'High',
                  selectedPlannerRoute.telemetry.highestPoint == null
                    ? '--'
                    : formatPlannerMeters(selectedPlannerRoute.telemetry.highestPoint),
                ],
                [
                  'ETA',
                  formatPlannerDuration(selectedPlannerRoute.telemetry.duration),
                ],
                [
                  'Direct',
                  formatPlannerDistance(selectedPlannerRoute.telemetry.directDistance),
                ],
                ['Grade', formatPlannerGrade(selectedPlannerRoute.telemetry.maxGrade)],
                ['Points', selectedPlannerRoute.telemetry.pointCount || '--'],
              ].map(([label, value]) => (
                <div
                  key={label}
                  style={{
                    borderRadius: 12,
                    border: '1px solid rgba(148,163,184,0.18)',
                    background: 'rgba(2,6,23,0.36)',
                    padding: '7px 8px',
                    minWidth: 0,
                  }}
                >
                  <div style={{ color: '#8aa7b8', fontSize: 10, fontWeight: 900 }}>
                    {label}
                  </div>
                  <div style={{ color: '#f8fafc', fontSize: 12, fontWeight: 900 }}>
                    {value}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button
              type="button"
              onClick={handleStartPlannerRoute}
              disabled={!plannerRouteDraft}
              style={{
                ...pingBtnBase,
                minHeight: 42,
                background: '#22c55e',
                color: '#fff',
                opacity: plannerRouteDraft ? 1 : 0.55,
              }}
            >
              Start trail
            </button>
            <button
              type="button"
              onClick={handleSavePlannerRoute}
              disabled={!plannerRouteDraft || plannerSaving}
              style={{
                ...pingBtnBase,
                minHeight: 42,
                background: '#6366f1',
                color: '#fff',
                opacity: plannerRouteDraft && !plannerSaving ? 1 : 0.55,
              }}
            >
              {plannerSaving ? 'Saving...' : 'Save locally'}
            </button>
          </div>
        </div>
      ) : null}

      {plannerRoutes.length > 0 &&
      !plannerOpen &&
      !plannerRouteMode &&
      !activeTrailSession &&
      !plannerDraftFormTrail &&
      plannerOptionsMinimized &&
      !markedMapPoint ? (
        <button
          type="button"
          onClick={() => setPlannerOptionsMinimized(false)}
          style={{
            position: 'absolute',
            left: 16,
            right: 16,
            bottom: MAP_DRAWER_BOTTOM_GAP,
            zIndex: 34,
            minHeight: 46,
            borderRadius: 16,
            border: '1px solid rgba(66,129,164,0.48)',
            background: 'rgba(17,26,40,0.94)',
            color: '#e2e8f0',
            boxShadow: '0 -10px 24px rgba(0,0,0,0.3)',
            backdropFilter: 'blur(12px)',
            fontSize: 13,
            fontWeight: 900,
          }}
        >
          Route options · {plannerRoutes.length} found · tap to show
        </button>
      ) : null}

      {plannerOpen ? (
        <div
          style={{
            ...pingPopupStyle,
            zIndex: 34,
            padding: '12px 12px 14px',
            display: 'grid',
            gap: 9,
            maxHeight:
              'min(48dvh, calc(100dvh - env(safe-area-inset-top, 0px) - var(--app-bottom-nav-space, 86px) - 96px))',
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 900 }}>Plan a trail</div>
              <div
                style={{
                  fontSize: 12,
                  color: '#a8bdca',
                  marginTop: 2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {plannerPickMode === 'start'
                  ? 'Tap the map to choose the start point.'
                  : plannerPickMode === 'waypoint'
                    ? 'Tap the map to add a stop.'
                    : plannerPickMode === 'inspect'
                      ? 'Tap the map to inspect a place.'
                      : 'Tap the map to choose the destination.'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPlannerOpen(false)}
              style={{
                ...pingBtnBase,
                background: 'rgba(148,163,184,0.14)',
                color: '#cbd5e1',
                minWidth: 68,
              }}
            >
              Close
            </button>
          </div>

          <div
            style={{
              display: 'flex',
              gap: 7,
              overflowX: 'auto',
              paddingBottom: 2,
            }}
          >
            {[
              ['destination', 'Destination'],
              ['start', 'Start'],
              ['waypoint', 'Stop'],
              ['inspect', 'Inspect'],
            ].map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setPlannerPickMode(mode)
                  setPlannerMessage(
                    mode === 'inspect'
                      ? 'Tap a place on the map.'
                      : mode === 'start'
                        ? 'Tap to set the route start.'
                        : mode === 'waypoint'
                          ? 'Tap to add a route stop.'
                          : 'Tap to set the destination.'
                  )
                }}
                style={{
                  ...pingBtnBase,
                  flex: '0 0 auto',
                  minWidth: 96,
                  padding: '8px 12px',
                  border: '1px solid rgba(66,129,164,0.45)',
                  background:
                    plannerPickMode === mode
                      ? 'linear-gradient(135deg, rgba(72,169,166,0.38), rgba(66,129,164,0.5))'
                      : 'rgba(15,23,42,0.62)',
                  color: plannerPickMode === mode ? '#ecfeff' : '#c9dcea',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              gap: 8,
              border: '1px solid rgba(148,163,184,0.18)',
              borderRadius: 14,
              padding: 10,
              background: 'rgba(2,6,23,0.35)',
              fontSize: 12,
              color: '#cbd5e1',
            }}
          >
            <div style={{ minWidth: 0, display: 'grid', gap: 5 }}>
              <div
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                <strong style={{ color: '#8de0dc' }}>From:</strong>{' '}
                {plannerStart ? makePointLabel(plannerStart) : 'my location'}
              </div>
              <div
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                <strong style={{ color: '#8de0dc' }}>To:</strong>{' '}
                {plannerDestination
                  ? makePointLabel(plannerDestination)
                  : 'tap a destination'}
              </div>
              <div style={{ color: '#94a3b8' }}>
                {plannerWaypoints.length
                  ? `${plannerWaypoints.length} stop${
                      plannerWaypoints.length === 1 ? '' : 's'
                    }`
                  : 'No stops'}{' '}
                {plannerDirectDistanceMeters > 0
                  ? `· ${(plannerDirectDistanceMeters / 1000).toFixed(2)} km direct`
                  : ''}
              </div>
            </div>
            <button
              type="button"
              onClick={handleResetPlanner}
              style={{
                ...pingBtnBase,
                alignSelf: 'center',
                padding: '7px 10px',
                background: 'rgba(148,163,184,0.12)',
                color: '#cbd5e1',
                border: '1px solid rgba(148,163,184,0.2)',
              }}
            >
              Clear
            </button>
          </div>

          {plannerPointInfo ? (
            <div
              style={{
                border: '1px solid rgba(66,129,164,0.35)',
                borderRadius: 14,
                padding: '8px 10px',
                background: 'rgba(8,13,24,0.52)',
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  color: '#e2e8f0',
                  fontWeight: 800,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {plannerPointInfo.placeName ||
                  makePointLabel(plannerPointInfo, 'Selected point')}
              </div>
              {plannerPointInfo.category ? (
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                  {plannerPointInfo.category}
                </div>
              ) : null}
            </div>
          ) : null}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button
              type="button"
              onClick={handleUseCurrentAsPlannerStart}
              style={{
                ...pingBtnBase,
                background: 'rgba(34,197,94,0.18)',
                color: '#86efac',
                border: '1px solid rgba(134,239,172,0.28)',
              }}
            >
              Use my start
            </button>
            <button
              type="button"
              onClick={handleShowPlannerApproachRoute}
              disabled={!plannerStart || plannerLoading}
              style={{
                ...pingBtnBase,
                background: 'rgba(56,189,248,0.16)',
                color: '#bae6fd',
                border: '1px solid rgba(125,211,252,0.28)',
                opacity: plannerStart && !plannerLoading ? 1 : 0.55,
              }}
            >
              Route to start
            </button>
          </div>

          <button
            type="button"
            onClick={handleBuildPlannerRoutes}
            disabled={plannerLoading || !plannerDestination}
            style={{
              ...pingBtnBase,
              width: '100%',
              padding: '12px 14px',
              background: 'linear-gradient(135deg, #48a9a6, #4281a4)',
              color: '#fff',
              opacity: plannerLoading || !plannerDestination ? 0.6 : 1,
            }}
          >
            {plannerLoading ? 'Building routes...' : 'Show route options'}
          </button>

          {plannerRoutes.length ? (
            <div
              style={{
                display: 'flex',
                gap: 8,
                overflowX: 'auto',
                paddingBottom: 2,
              }}
            >
              {plannerRoutes.map((route, index) => {
                const isSelected = index === selectedPlannerRouteIndex
                return (
                  <button
                    key={`planner-route-${index}`}
                    type="button"
                    onClick={() => handleSelectPlannerRoute(index)}
                    style={{
                      flex: '0 0 158px',
                      border: `1px solid ${
                        isSelected
                          ? 'rgba(134,239,172,0.7)'
                          : 'rgba(66,129,164,0.34)'
                      }`,
                      borderRadius: 14,
                      padding: '10px 12px',
                      background: isSelected
                        ? 'rgba(34,197,94,0.18)'
                        : 'rgba(15,23,42,0.55)',
                      color: '#e2e8f0',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 8,
                        fontWeight: 900,
                      }}
                    >
                      <span>Route {index + 1}</span>
                      <span>{(Number(route.distance || 0) / 1000).toFixed(2)} km</span>
                    </div>
                    <div
                      style={{
                        marginTop: 4,
                        color: '#a8bdca',
                        fontSize: 12,
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}
                    >
                      <span>{formatPlannerDuration(route.telemetry?.naismithDuration || route.duration)}</span>
                      <span>{DIFFICULTY_LABEL[route.telemetry?.difficulty] || 'Moderate'}</span>
                    </div>
                    <div
                      style={{
                        marginTop: 6,
                        color: '#8aa7b8',
                        fontSize: 11,
                        fontWeight: 800,
                      }}
                    >
                      {route.telemetry?.elevationGain != null
                        ? `${formatPlannerMeters(route.telemetry.elevationGain)} climb`
                        : 'Elevation pending'}
                    </div>
                  </button>
                )
              })}
            </div>
          ) : null}

          {selectedPlannerRoute?.telemetry ? (
            <div
              style={{
                border: '1px solid rgba(66,129,164,0.32)',
                borderRadius: 14,
                background: 'rgba(2,6,23,0.36)',
                padding: 10,
                display: 'grid',
                gap: 9,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 10,
                  alignItems: 'center',
                }}
              >
                <strong style={{ color: '#dff8ff', fontSize: 13 }}>
                  Selected route telemetry
                </strong>
                <span style={{ color: '#9ce7c2', fontSize: 12, fontWeight: 900 }}>
                  {DIFFICULTY_LABEL[selectedPlannerRoute.telemetry.difficulty] || 'Moderate'}
                </span>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  gap: 8,
                  fontSize: 12,
                }}
              >
                {[
                  ['Distance', formatPlannerDistance(selectedPlannerRoute.telemetry.distance)],
                  [
                    'Hike time',
                    formatPlannerDuration(
                      selectedPlannerRoute.telemetry.naismithDuration ||
                        selectedPlannerRoute.telemetry.duration
                    ),
                  ],
                  [
                    'Mapbox ETA',
                    formatPlannerDuration(selectedPlannerRoute.telemetry.duration),
                  ],
                  [
                    'Direct line',
                    formatPlannerDistance(selectedPlannerRoute.telemetry.directDistance),
                  ],
                  [
                    'Elevation gain',
                    selectedPlannerRoute.telemetry.elevationGain == null
                      ? '--'
                      : formatPlannerMeters(selectedPlannerRoute.telemetry.elevationGain),
                  ],
                  [
                    'Highest point',
                    selectedPlannerRoute.telemetry.highestPoint == null
                      ? '--'
                      : formatPlannerMeters(selectedPlannerRoute.telemetry.highestPoint),
                  ],
                  [
                    'Steepest grade',
                    formatPlannerGrade(selectedPlannerRoute.telemetry.maxGrade),
                  ],
                  ['Route points', selectedPlannerRoute.telemetry.pointCount || '--'],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    style={{
                      border: '1px solid rgba(148,163,184,0.18)',
                      borderRadius: 10,
                      padding: '7px 8px',
                      background: 'rgba(15,23,42,0.5)',
                      minWidth: 0,
                    }}
                  >
                    <div style={{ color: '#8aa7b8', fontSize: 10, fontWeight: 850 }}>
                      {label}
                    </div>
                    <div style={{ color: '#f8fafc', fontWeight: 900 }}>{value}</div>
                  </div>
                ))}
              </div>
              {selectedPlannerRoute.telemetry.routeRatio ? (
                <div style={{ color: '#a8bdca', fontSize: 12, fontWeight: 700 }}>
                  Route is {selectedPlannerRoute.telemetry.routeRatio.toFixed(1)}x the direct distance.
                </div>
              ) : null}
            </div>
          ) : null}

          {plannerError ? (
            <div
              style={{
                border: '1px solid rgba(248,113,113,0.38)',
                borderRadius: 12,
                padding: '8px 10px',
                color: '#fecaca',
                background: 'rgba(127,29,29,0.24)',
                fontSize: 12,
                fontWeight: 800,
              }}
            >
              {plannerError}
            </div>
          ) : null}
          {plannerMessage ? (
            <div
              style={{
                border: '1px solid rgba(134,239,172,0.3)',
                borderRadius: 12,
                padding: '8px 10px',
                color: '#bbf7d0',
                background: 'rgba(20,83,45,0.22)',
                fontSize: 12,
                fontWeight: 800,
              }}
            >
              {plannerMessage}
            </div>
          ) : null}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button
              type="button"
              onClick={handleStartPlannerRoute}
              disabled={!plannerRouteDraft}
              style={{
                ...pingBtnBase,
                background: '#22c55e',
                color: '#fff',
                opacity: plannerRouteDraft ? 1 : 0.55,
              }}
            >
              Start trail
            </button>
            <button
              type="button"
              onClick={handleSavePlannerRoute}
              disabled={!plannerRouteDraft || plannerSaving}
              style={{
                ...pingBtnBase,
                background: '#6366f1',
                color: '#fff',
                opacity: plannerRouteDraft && !plannerSaving ? 1 : 0.55,
              }}
            >
              {plannerSaving ? 'Saving...' : 'Save locally'}
            </button>
          </div>
        </div>
      ) : null}

      {plannerDraftFormTrail ? (
        <RouteBuilderForm
          geojson={plannerDraftFormTrail.geojson}
          title="Save Planned Trail"
          submitLabel="Save to device"
          publishOnSubmit={false}
          initialValues={{
            name: plannerDraftFormTrail.name,
            region: plannerDraftFormTrail.region,
            difficulty: plannerDraftFormTrail.difficulty,
            description: plannerDraftFormTrail.description,
            equipment: plannerDraftFormTrail.equipment,
            resources: plannerDraftFormTrail.resources,
            stats: plannerDraftFormTrail.stats,
            trailMarks: plannerDraftFormTrail.trailMarks,
          }}
          onSuccess={handlePlannerDraftFormSuccess}
          onCancel={() => {
            if (!plannerSaving) setPlannerDraftFormTrail(null)
          }}
        />
      ) : null}

      {unmarkedWarning ? (
        <div
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          style={{
            position: 'absolute',
            left: '50%',
            transform: 'translateX(-50%)',
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 108px)',
            width: 'min(92vw, 440px)',
            zIndex: 32,
            borderRadius: 12,
            border: '1px solid rgba(250, 204, 21, 0.5)',
            background: 'rgba(30, 20, 5, 0.92)',
            color: '#fde68a',
            boxShadow: '0 10px 24px rgba(0,0,0,0.35)',
            padding: '10px 12px',
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 12, marginBottom: 6 }}>
            Safety warning
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.45 }}>
            {unmarkedWarning}
          </div>
          <button
            type="button"
            onClick={() => setUnmarkedWarning('')}
            onPointerDown={(event) => event.stopPropagation()}
            style={{
              ...pingBtnBase,
              marginTop: 8,
              width: '100%',
              background: 'rgba(250, 204, 21, 0.16)',
              color: '#fde68a',
            }}
          >
            Understood
          </button>
        </div>
      ) : null}

      {isLegendVisible ? (
        <div
          style={{
            position: 'absolute',
            left: 12,
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 86px)',
            width: 'min(84vw, 256px)',
            zIndex: 21,
            borderRadius: 14,
            border: '1px solid rgba(148,163,184,0.3)',
            background: 'rgba(15, 23, 35, 0.9)',
            boxShadow: '0 10px 24px rgba(0,0,0,0.32)',
            padding: 10,
            display: 'grid',
            gap: 7,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 800, color: '#e2e8f0' }}>
              Legend
            </span>
            <button
              type="button"
              onClick={() => setIsLegendVisible(false)}
              style={{
                width: 26,
                height: 26,
                borderRadius: '50%',
                border: '1px solid rgba(148,163,184,0.45)',
                display: 'grid',
                placeItems: 'center',
                cursor: 'pointer',
                background: 'rgba(148,163,184,0.16)',
                color: '#cbd5e1',
              }}
              aria-label="Hide legend"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {[
            ['Red marking', '#dc2626', false, 3],
            ['Blue marking', '#2563eb', false, 3],
            ['Green marking', '#22c55e', false, 3],
            ['Yellow marking', '#FFD700', false, 3],
            ['Black marking', '#0f172a', false, 3],
            ['Unmarked section', '#000000', true, 2],
            ['E3 Kom-Emine', '#dc2626', false, 5],
            ['E4', '#2563eb', false, 5],
            ['E8', '#7c3aed', false, 5],
          ].map(([label, color, dashed, width]) => (
            <div
              key={label}
              style={{
                display: 'grid',
                gridTemplateColumns: '44px 1fr',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                color: '#cbd5e1',
              }}
            >
              <span
                style={{
                  height: 0,
                  borderTop: `${width}px ${dashed ? 'dashed' : 'solid'} ${color}`,
                }}
              />
              <span>{label}</span>
            </div>
          ))}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsLegendVisible(true)}
          style={{
            position: 'absolute',
            left: 12,
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 86px)',
            zIndex: 21,
            width: 32,
            height: 32,
            borderRadius: '50%',
            border: '2px solid rgba(148,163,184,0.35)',
            boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
            display: 'grid',
            placeItems: 'center',
            cursor: 'pointer',
            background: 'rgba(15, 23, 35, 0.94)',
            color: '#e2e8f0',
          }}
          title="Show legend"
          aria-label="Show legend"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="18" x2="20" y2="18" />
          </svg>
        </button>
      )}

      {pingMode && !pendingPing && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(env(safe-area-inset-top, 0px) + 268px)',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 20,
            padding: '8px 16px',
            borderRadius: 12,
            border: '1px solid rgba(244,63,94,0.5)',
            background: 'rgba(18, 26, 40, 0.92)',
            color: '#fda4af',
            fontSize: 13,
            fontWeight: 700,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            boxShadow: '0 8px 20px rgba(0,0,0,0.25)',
          }}
        >
          Tap on the map while walking to place a ping
        </div>
      )}

      {activeTrailSession ? (
        <div
          style={{
            ...overlayCard,
            position: 'absolute',
            top: 'calc(env(safe-area-inset-top, 0px) + 10px)',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 'min(92vw, 380px)',
            padding: 10,
            zIndex: 18,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 8,
            }}
          >
            <div>
              <div style={{ fontSize: 11, color: '#89afc2', fontWeight: 700 }}>
                ACTIVE TRAIL
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, marginTop: 1 }}>
                {activeTrailSession.trailName}
              </div>
              <div style={{ fontSize: 12, color: '#9cb7c8', marginTop: 2 }}>
                Current: {activeSector?.name || 'N/A'} (
                {resolveSegmentLabel(activeSector)}
                )
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: '#89afc2' }}>Distance</div>
              <div style={{ fontWeight: 800, fontSize: 14 }}>
                {activityDistanceProgressText}
              </div>
              <div style={{ fontSize: 11, color: '#89afc2', marginTop: 2 }}>
                Time {formatDuration(activityDurationSeconds)}
              </div>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 6,
              marginTop: 8,
            }}
          >
            <div
              style={{
                ...styles.infoBox,
                fontSize: 11,
                padding: '6px 8px',
                border: '1px solid rgba(148,163,184,0.24)',
                background: 'rgba(12,19,30,0.72)',
              }}
            >
              <div style={{ color: '#8eaac0' }}>Steps</div>
              <div style={{ fontWeight: 800 }}>
                {activitySteps.toLocaleString()}
              </div>
            </div>
            <div
              style={{
                ...styles.infoBox,
                fontSize: 11,
                padding: '6px 8px',
                border: '1px solid rgba(148,163,184,0.24)',
                background: 'rgba(12,19,30,0.72)',
              }}
            >
              <div style={{ color: '#8eaac0' }}>Altitude</div>
              <div style={{ fontWeight: 800 }}>
                {Number.isFinite(activityCurrentElevation)
                  ? `${Math.round(activityCurrentElevation)} m`
                  : '--'}
              </div>
            </div>
            <div
              style={{
                ...styles.infoBox,
                fontSize: 11,
                padding: '6px 8px',
                border: '1px solid rgba(148,163,184,0.24)',
                background: 'rgba(12,19,30,0.72)',
              }}
            >
              <div style={{ color: '#8eaac0' }}>Progress</div>
              <div style={{ fontWeight: 800 }}>
                {activityProgressPercent.toFixed(0)}%
              </div>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${Math.max(1, activeTrailSession.segments.length)}, minmax(0, 1fr))`,
              gap: 4,
              marginTop: 8,
            }}
          >
            {activeTrailSession.segments.map((segment, index) => (
              <div
                key={`${segment.name}-chip-${index}`}
                style={{
                  minHeight: 7,
                  borderRadius: 999,
                  background: resolveSegmentColor(segment),
                  opacity: index === currentSectorIndex ? 1 : 0.45,
                  border:
                    index === currentSectorIndex
                      ? '1px solid rgba(241,245,249,0.7)'
                      : '1px solid transparent',
                }}
                title={`${segment.name} (${resolveSegmentLabel(segment)})`}
              />
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              onClick={() => setShowSectorSummary((v) => !v)}
              style={{
                ...pingBtnBase,
                flex: 1,
                background: 'rgba(72,169,166,0.2)',
                color: '#8de0dc',
                minHeight: 40,
              }}
            >
              {showSectorSummary
                ? 'Hide Sector Summary'
                : 'Show Sector Summary'}
            </button>
          </div>

          {showSectorSummary ? (
            <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
              <div
                style={{
                  ...styles.infoBox,
                  fontSize: 11,
                  padding: '7px 9px',
                  display: 'grid',
                  gap: 4,
                }}
              >
                <div>Average pace: {activityPaceText}</div>
                <div>
                  Elevation gain: +{Math.round(activityElevationGain)} m
                </div>
                <div>
                  Total route elevation:{' '}
                  {Number.isFinite(activeTrailSession?.totalElevationMeters)
                    ? `${Math.round(activeTrailSession.totalElevationMeters)} m`
                    : '--'}
                </div>
              </div>
              {activeTrailSession.segments.map((segment, index) => (
                <div
                  key={`${segment.name}-${index}`}
                  style={{
                    border: `1px solid ${index === currentSectorIndex ? 'rgba(203,213,225,0.85)' : 'rgba(107,114,128,0.4)'}`,
                    background:
                      index === currentSectorIndex
                        ? 'rgba(30,41,59,0.9)'
                        : 'rgba(15,23,35,0.58)',
                    borderRadius: 10,
                    padding: '8px 10px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      fontWeight: 700,
                      fontSize: 12,
                    }}
                  >
                    <span>{segment.name}</span>
                    <span
                      style={{
                        padding: '2px 7px',
                        borderRadius: 999,
                        background: resolveSegmentColor(segment),
                        color: '#f8fafc',
                        fontSize: 10,
                      }}
                    >
                      {resolveSegmentLabel(segment)}
                    </span>
                  </div>
                  <div style={{ marginTop: 3, fontSize: 11, color: '#96afc1' }}>
                    Points:{' '}
                    {Math.max(1, segment.endIndex - segment.startIndex + 1)}
                    {segment.estimatedTime ? ` · ${segment.estimatedTime}` : ''}
                  </div>
                  {segment.description ? (
                    <div
                      style={{ marginTop: 3, fontSize: 12, color: '#b7c9d6' }}
                    >
                      {segment.description}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {activeTrailSession ? (
        <button
          onClick={handleFinishTrail}
          style={{
            position: 'absolute',
            left: '50%',
            transform: 'translateX(-50%)',
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 108px)',
            zIndex: 23,
            width: 'min(92vw, 320px)',
            ...pingBtnBase,
            padding: '14px 20px',
            fontSize: 16,
            fontWeight: 800,
            letterSpacing: 0.2,
            border: '1px solid rgba(187,247,208,0.6)',
            background:
              'linear-gradient(135deg, #22c55e, #16a34a 58%, #15803d)',
            color: '#fff',
            boxShadow:
              '0 14px 30px rgba(8,32,18,0.42), inset 0 1px 0 rgba(255,255,255,0.22)',
          }}
        >
          Finish Trail
        </button>
      ) : null}

      {pendingPing ? (
        <div style={pingPopupStyle}>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10 }}>
            New Ping
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            {Object.entries(REPORT_PING_TYPES).map(([key, cfg]) => (
              <button
                key={key}
                onClick={() => setPingType(key)}
                style={{
                  flex: 1,
                  padding: '8px 4px',
                  borderRadius: 10,
                  border:
                    pingType === key
                      ? `2px solid ${cfg.color}`
                      : '2px solid rgba(148,163,184,0.2)',
                  background:
                    pingType === key ? `${cfg.color}22` : 'rgba(15,23,35,0.6)',
                  color: '#e2e8f0',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 700,
                  textAlign: 'center',
                  lineHeight: 1.3,
                }}
              >
                <span style={{ fontSize: 14, display: 'block' }}>
                  {cfg.marker}
                </span>
                {cfg.label}
              </button>
            ))}
          </div>

          <input
            type="text"
            placeholder="Brief description (optional)"
            value={pingDesc}
            onChange={(e) => setPingDesc(e.target.value)}
            maxLength={200}
            style={{
              width: '100%',
              padding: '9px 11px',
              borderRadius: 10,
              border: '1px solid rgba(66,129,164,0.34)',
              background: 'rgba(15,23,35,0.88)',
              color: '#fbfef9',
              fontSize: 13,
              outline: 'none',
              marginBottom: 10,
              boxSizing: 'border-box',
            }}
          />

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => {
                setPendingPing(null)
                setPingDesc('')
              }}
              style={{
                ...pingBtnBase,
                flex: 1,
                background: 'rgba(148,163,184,0.15)',
                color: '#94a3b8',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handlePingSubmit}
              disabled={pingSubmitting}
              style={{
                ...pingBtnBase,
                flex: 1,
                background: 'linear-gradient(135deg, #48a9a6, #4281a4)',
                color: '#fff',
                opacity: pingSubmitting ? 0.6 : 1,
              }}
            >
              {pingSubmitting ? 'Saving...' : 'Place Ping'}
            </button>
          </div>
        </div>
      ) : null}

      {selectedPing && !pendingPing ? (
        <div
          style={{
            ...pingPopupStyle,
            ...(selectedPing.photoUrl
              ? {
                  maxHeight:
                    'min(72dvh, calc(100dvh - env(safe-area-inset-top, 0px) - var(--app-bottom-nav-space, 86px) - 112px))',
                  overflowY: 'auto',
                }
              : {}),
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 6,
            }}
          >
            <span style={{ fontSize: 22 }}>
              {PING_TYPES[selectedPing.type]?.marker || 'P'}
            </span>
            <span style={{ fontWeight: 800, fontSize: 14 }}>
              {PING_TYPES[selectedPing.type]?.label || selectedPing.type}
            </span>
          </div>
          {selectedPing.description ? (
            <div style={{ fontSize: 13, color: '#cbd5e1', marginBottom: 6 }}>
              {selectedPing.description}
            </div>
          ) : null}
          {selectedPing.photoUrl ? (
            <div style={{ marginBottom: 6 }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  marginBottom: 8,
                  padding: '4px 8px',
                  borderRadius: 999,
                  background: 'rgba(148,163,184,0.14)',
                  color:
                    (
                      PHOTO_CATEGORY_META[selectedPing.photoCategory] ||
                      PHOTO_CATEGORY_META.memory
                    ).color,
                  fontSize: 11,
                  fontWeight: 800,
                }}
              >
                {(
                  PHOTO_CATEGORY_META[selectedPing.photoCategory] ||
                  PHOTO_CATEGORY_META.memory
                ).label}
              </div>
              <img
                src={selectedPing.photoUrl}
                alt={selectedPing.description || 'Photo'}
                style={{
                  width: '100%',
                  maxHeight: 'min(42vh, 320px)',
                  objectFit: 'contain',
                  borderRadius: 8,
                  background: 'rgba(2, 6, 23, 0.78)',
                }}
              />
            </div>
          ) : null}
          <div style={{ fontSize: 11, color: '#64748b' }}>
            By {selectedPing.username || 'Anonymous'} ·{' '}
            {new Date(selectedPing.createdAt).toLocaleDateString()}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {!selectedPing.photoUrl ? (
              <button
                onClick={() => handlePingVote(selectedPing._id)}
                disabled={voteSubmitting}
                style={{
                  ...pingBtnBase,
                  flex: 1,
                  background: 'rgba(34,197,94,0.18)',
                  color: '#4ade80',
                }}
              >
                {voteSubmitting ? '...' : 'Not there anymore'}
              </button>
            ) : null}
            <button
              onClick={() => setSelectedPing(null)}
              style={{
                ...pingBtnBase,
                flex: 1,
                background: 'rgba(148,163,184,0.15)',
                color: '#94a3b8',
              }}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

      {selectedCluster && !pendingPing ? (
        <div style={{ ...pingPopupStyle, padding: '12px 14px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 6,
            }}
          >
            <span
              style={{
                ...clusterMarkerStyle,
                width: 28,
                height: 28,
                fontSize: 13,
                cursor: 'default',
                background:
                  CLUSTER_CONFIG[selectedCluster.level]?.color ||
                  CLUSTER_CONFIG.clutter.color,
                boxShadow: '0 2px 8px rgba(0,0,0,0.32)',
              }}
            >
              {CLUSTER_CONFIG[selectedCluster.level]?.marker || 'C'}
            </span>
            <span style={{ fontWeight: 800, fontSize: 14 }}>
              {CLUSTER_CONFIG[selectedCluster.level]?.label ||
                selectedCluster.level}
            </span>
          </div>
          <div style={{ fontSize: 13, color: '#cbd5e1', marginBottom: 4 }}>
            {selectedCluster.pingCount} trash ping
            {selectedCluster.pingCount !== 1 ? 's' : ''} within this area
          </div>
          {selectedCluster.description ? (
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>
              {selectedCluster.description}
            </div>
          ) : null}
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
            Votes: {selectedCluster.goneVotes?.length || 0} /{' '}
            {CLUSTER_CONFIG[selectedCluster.level]?.votesNeeded || 3}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => handleClusterVote(selectedCluster._id)}
              disabled={voteSubmitting}
              style={{
                ...pingBtnBase,
                flex: 1,
                background: 'rgba(34,197,94,0.18)',
                color: '#4ade80',
              }}
            >
              {voteSubmitting ? '...' : 'Cleaned up'}
            </button>
            <button
              onClick={() => setSelectedCluster(null)}
              style={{
                ...pingBtnBase,
                flex: 1,
                background: 'rgba(148,163,184,0.15)',
                color: '#94a3b8',
              }}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

      {stillTherePrompt ? (
        <div
          style={{
            ...pingPopupStyle,
            zIndex: 35,
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 14 }}>Still there?</div>
          <div style={{ fontSize: 12, color: '#bfd4de', marginTop: 4 }}>
            You are within 100m of a reported{' '}
            {stillTherePrompt.type === 'cluster' ? 'cluster/event' : 'ping'}.
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              onClick={handleKeepPrompt}
              disabled={stillThereSubmitting}
              style={{
                ...pingBtnBase,
                flex: 1,
                background: 'rgba(148,163,184,0.15)',
                color: '#e2e8f0',
              }}
            >
              Yes, still there
            </button>
            <button
              onClick={handleVotePromptGone}
              disabled={stillThereSubmitting}
              style={{
                ...pingBtnBase,
                flex: 1,
                background: 'rgba(34,197,94,0.22)',
                color: '#4ade80',
              }}
            >
              {stillThereSubmitting ? 'Saving...' : 'No, gone'}
            </button>
          </div>
        </div>
      ) : null}

      {startPanelTrail ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 40,
            background: 'linear-gradient(180deg, rgba(3,9,17,0.18), rgba(3,9,17,0.66))',
            display: 'flex',
            alignItems: 'flex-end',
            padding: `0 10px ${MAP_DRAWER_BOTTOM_GAP}`,
          }}
          onClick={() => setStartPanelTrail(null)}
        >
          <div
            style={{
              ...overlayCard,
              width: '100%',
              maxHeight:
                'min(70dvh, calc(100dvh - env(safe-area-inset-top, 0px) - var(--app-bottom-nav-space, 86px) - 104px))',
              overflow: 'auto',
              padding: '14px 14px 0',
              borderRadius: '24px 24px 0 0',
              animation: 'map-drawer-in 180ms ease-out both',
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div>
                <div
                  style={{ fontSize: 11, color: '#89afc2', fontWeight: 700 }}
                >
                  START TRAIL
                </div>
                <h3 style={{ margin: '2px 0 0 0', fontSize: 17, lineHeight: 1.18 }}>
                  {startPanelTrail.name}
                </h3>
                <div style={{ fontSize: 12, color: '#b7c9d6' }}>
                  {startPanelTrail.region || 'Unknown region'} ·{' '}
                  {DIFFICULTY_LABEL[startPanelTrail.difficulty] ||
                    startPanelTrail.difficulty}
                </div>
              </div>
              <button
                onClick={() => setStartPanelTrail(null)}
                style={{
                  ...pingBtnBase,
                  width: 44,
                  height: 44,
                  padding: 0,
                  borderRadius: 14,
                  background: 'rgba(148,163,184,0.15)',
                  color: '#cbd5e1',
                  flexShrink: 0,
                }}
                aria-label="Close start trail drawer"
              >
                ×
              </button>
            </div>

            {startPanelLoading ? (
              <div style={{ ...styles.infoBox, marginTop: 12 }}>
                Loading start checks and weather...
              </div>
            ) : null}

            {startReadiness ? (
              <div style={{ ...styles.infoBox, marginTop: 12, padding: '9px 10px' }}>
                <div style={{ fontWeight: 700, color: '#8de0dc' }}>
                  Start Distance Check
                </div>
                {startReadiness.hasUserLocation ? (
                  <div style={{ marginTop: 4 }}>
                    Distance to start:{' '}
                    {Math.round(startReadiness.distanceToStartMeters || 0)} m
                    {' · '}
                    {startReadiness.withinRange
                      ? 'Within the 1 km start zone'
                      : 'Too far to begin (required <= 1000 m)'}
                  </div>
                ) : (
                  <div style={{ marginTop: 4 }}>
                    GPS distance check is unavailable. You can still start, but
                    distance-to-start cannot be verified.
                  </div>
                )}
              </div>
            ) : null}

            <div style={{ ...styles.infoBox, marginTop: 8, padding: '9px 10px' }}>
              <div style={{ fontWeight: 700, color: '#8de0dc' }}>
                Mapbox Approach Route
              </div>
              <div style={{ marginTop: 4 }}>
                {approachSummary
                  ? `${(approachSummary.distanceMeters / 1000).toFixed(2)} km walk to the trail start · ${Math.max(
                    1,
                    Math.round(approachSummary.durationSeconds / 60)
                  )} min`
                  : 'Draw a walking route from your location to the trail start.'}
              </div>
              {approachError ? (
                <div style={{ marginTop: 6, color: '#fca5a5' }}>
                  {approachError}
                </div>
              ) : null}
              <button
                type="button"
                onClick={handleShowApproachRoute}
                disabled={approachLoading}
                style={{
                  ...pingBtnBase,
                  width: '100%',
                  marginTop: 8,
                  background: approachRoute
                    ? 'rgba(56,189,248,0.24)'
                    : 'rgba(72,169,166,0.22)',
                  color: '#bfdbfe',
                  opacity: approachLoading ? 0.65 : 1,
                }}
              >
                {approachLoading
                  ? 'Building route...'
                  : approachRoute
                    ? 'Rebuild Approach'
                    : 'Show Approach To Start'}
              </button>
            </div>

            <div
              style={{
                ...styles.infoBox,
                marginTop: 8,
                padding: '9px 10px',
                border:
                  startSafety.level === 'high'
                    ? '1px solid rgba(239,68,68,0.55)'
                    : startSafety.level === 'medium'
                      ? '1px solid rgba(245,158,11,0.55)'
                      : '1px solid rgba(34,197,94,0.45)',
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  color:
                    startSafety.level === 'high'
                      ? '#fca5a5'
                      : startSafety.level === 'medium'
                        ? '#fcd34d'
                        : '#86efac',
                }}
              >
                Safety Suggestion: {startSafety.title}
              </div>
              <div style={{ marginTop: 4 }}>{startSafety.summary}</div>
              {startSafety.unsafe ? (
                <button
                  type="button"
                  onClick={() => {
                    setStartUnsafeAcknowledged((value) => !value)
                    setStartPanelError('')
                  }}
                  style={{
                    ...pingBtnBase,
                    width: '100%',
                    marginTop: 9,
                    minHeight: 40,
                    background: startUnsafeAcknowledged
                      ? 'rgba(34,197,94,0.22)'
                      : 'rgba(239,68,68,0.18)',
                    border: startUnsafeAcknowledged
                      ? '1px solid rgba(134,239,172,0.42)'
                      : '1px solid rgba(248,113,113,0.46)',
                    color: startUnsafeAcknowledged ? '#bbf7d0' : '#fecaca',
                  }}
                >
                  {startUnsafeAcknowledged
                    ? 'Risk acknowledged'
                    : 'I understand, allow start'}
                </button>
              ) : null}
            </div>

            {startWeatherNow ? (
              <div style={{ ...styles.infoBox, marginTop: 8, padding: '9px 10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {startWeatherNow.icon ? (
                    <img
                      src={weatherIconUrl(startWeatherNow.icon)}
                      alt={startWeatherNow.condition}
                      style={{ width: 38, height: 38 }}
                    />
                  ) : null}
                  <div>
                    <div style={{ fontWeight: 700, color: '#8de0dc' }}>
                      Start Area Weather
                    </div>
                    <div style={{ fontSize: 13 }}>
                      {Math.round(startWeatherNow.temperature)}°C ·{' '}
                      {startWeatherNow.description}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {startPanelSegments.length ? (
              <div style={{ ...styles.infoBox, marginTop: 8, padding: '9px 10px' }}>
                <div
                  style={{ fontWeight: 700, color: '#8de0dc', marginBottom: 6 }}
                >
                  Trail Sectors
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {startPanelSegments.map((segment, index) => {
                    const pointCount = Math.max(
                      1,
                      segment.endIndex - segment.startIndex + 1
                    )
                    return (
                      <div
                        key={`${segment.name}-${index}`}
                        onMouseEnter={() => setStartHoveredSegment(index)}
                        onFocus={() => setStartHoveredSegment(index)}
                        style={{
                          border:
                            index === startHoveredSegment
                              ? '1px solid rgba(203,213,225,0.8)'
                              : '1px solid rgba(148,163,184,0.24)',
                          borderRadius: 8,
                          padding: '7px 8px',
                          background:
                            index === startHoveredSegment
                              ? 'rgba(30,41,59,0.92)'
                              : 'rgba(15,23,35,0.62)',
                          cursor: 'pointer',
                        }}
                        title={segment.description || segment.name}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 8,
                          }}
                        >
                          <span style={{ fontSize: 12, fontWeight: 700 }}>
                            {segment.name}
                          </span>
                          <span
                            style={{
                              padding: '2px 7px',
                              borderRadius: 999,
                              background: resolveSegmentColor(segment),
                              color: '#f8fafc',
                              fontSize: 10,
                              fontWeight: 700,
                            }}
                          >
                            {resolveSegmentLabel(segment)}
                          </span>
                        </div>
                        <div
                          style={{
                            marginTop: 3,
                            fontSize: 11,
                            color: '#94aab9',
                          }}
                        >
                          Points: {pointCount}
                          {segment.estimatedTime
                            ? ` · ${segment.estimatedTime}`
                            : ''}
                        </div>
                        {segment.description ? (
                          <div
                            style={{
                              marginTop: 3,
                              fontSize: 11,
                              color: '#bfd4de',
                            }}
                          >
                            {segment.description}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : null}

            {Array.isArray(startForecast) && startForecast.length ? (
              <div style={{ ...styles.infoBox, marginTop: 8, padding: '9px 10px' }}>
                <div
                  style={{ fontWeight: 700, color: '#8de0dc', marginBottom: 6 }}
                >
                  Forecast (next hours)
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {startForecast.slice(0, 4).map((item) => (
                    <div
                      key={item.timestamp}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        fontSize: 12,
                      }}
                    >
                      <span>
                        {new Date(item.timestamp * 1000).toLocaleString([], {
                          weekday: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <span>
                        {Math.round(item.temperature)}°C · {item.condition} ·
                        wind {item.windSpeed.toFixed(1)} m/s
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {startPanelError ? (
              <div
                style={{
                  marginTop: 8,
                  color: '#fca5a5',
                  fontSize: 12,
                  fontWeight: 700,
                  border: '1px solid rgba(248,113,113,0.38)',
                  borderRadius: 12,
                  background: 'rgba(127,29,29,0.22)',
                  padding: '9px 10px',
                }}
              >
                {startPanelError}
              </div>
            ) : null}

            <div
              style={{
                display: 'flex',
                gap: 8,
                marginTop: 10,
                position: 'sticky',
                bottom: 0,
                padding: '10px 0 calc(env(safe-area-inset-bottom, 0px) + 12px)',
                background:
                  'linear-gradient(180deg, rgba(17,26,40,0), rgba(17,26,40,0.98) 28%)',
              }}
            >
              <button
                onClick={handleBeginTrail}
                disabled={startPanelLoading}
                style={{
                  ...pingBtnBase,
                  flex: 1,
                  minHeight: 44,
                  background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                  color: '#fff',
                  border: '1px solid rgba(134,239,172,0.45)',
                  outline: 'none',
                  opacity: startPanelLoading ? 0.6 : 1,
                }}
              >
                Start Trail
              </button>
              <button
                onClick={() => setStartPanelTrail(null)}
                style={{
                  ...pingBtnBase,
                  flex: 1,
                  minHeight: 44,
                  background: 'rgba(148,163,184,0.15)',
                  color: '#cbd5e1',
                  border: '1px solid rgba(148,163,184,0.2)',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {finishModalTrail && finishStats ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 42,
            background: 'rgba(3,9,17,0.58)',
            display: 'grid',
            placeItems: 'center',
            padding: 14,
          }}
          onClick={() => {
            if (!finishSubmitting) {
              setFinishModalTrail(null)
              setFinishStats(null)
            }
          }}
        >
          <div
            style={{
              ...overlayCard,
              width: 'min(92vw, 480px)',
              padding: 14,
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ fontSize: 12, color: '#89afc2', fontWeight: 700 }}>
              TRAIL COMPLETED
            </div>
            <h3 style={{ margin: '4px 0 6px 0' }}>
              Nice work! You finished {finishModalTrail.name}.
            </h3>

            <div style={{ ...styles.infoBox, marginTop: 4 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <span>Distance</span>
                <strong>
                  {(finishStats.distanceMeters / 1000).toFixed(2)} km
                </strong>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <span>Time</span>
                <strong>{formatDuration(finishStats.durationSeconds)}</strong>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <span>Final sector</span>
                <strong>
                  {finishStats.sectorName} (
                  {DIFFICULTY_LABEL[finishStats.sectorDifficulty] ||
                    finishStats.sectorDifficulty}
                  )
                </strong>
              </div>
            </div>

            <div style={{ marginTop: 10, fontSize: 12, color: '#b9cedd' }}>
              Rate this trail (optional, moved from Explore).
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => setFinishRating(star)}
                  style={{
                    ...pingBtnBase,
                    flex: 1,
                    background:
                      finishRating >= star
                        ? 'rgba(250,204,21,0.25)'
                        : 'rgba(148,163,184,0.12)',
                    color: finishRating >= star ? '#facc15' : '#94a3b8',
                    padding: '8px 0',
                  }}
                >
                  ★
                </button>
              ))}
            </div>

            <textarea
              value={finishComment}
              onChange={(event) => setFinishComment(event.target.value)}
              placeholder="Share quick feedback (optional)"
              rows={3}
              maxLength={500}
              style={{
                width: '100%',
                marginTop: 10,
                borderRadius: 10,
                border: '1px solid rgba(66,129,164,0.3)',
                background: 'rgba(15,23,35,0.88)',
                color: '#e2e8f0',
                padding: 10,
                boxSizing: 'border-box',
              }}
            />

            {finishError ? (
              <div
                style={{
                  marginTop: 8,
                  color: '#fca5a5',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {finishError}
              </div>
            ) : null}
            {finishSuccess ? (
              <div
                style={{
                  marginTop: 8,
                  color: '#86efac',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {finishSuccess}
              </div>
            ) : null}

            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button
                onClick={handleSubmitFinish}
                disabled={finishSubmitting}
                style={{
                  ...pingBtnBase,
                  flex: 1,
                  background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                  color: '#fff',
                  opacity: finishSubmitting ? 0.6 : 1,
                }}
              >
                {finishSubmitting ? 'Saving...' : 'Submit Completion'}
              </button>
              <button
                onClick={() => {
                  if (!finishSubmitting) {
                    setFinishModalTrail(null)
                    setFinishStats(null)
                  }
                }}
                style={{
                  ...pingBtnBase,
                  flex: 1,
                  background: 'rgba(148,163,184,0.15)',
                  color: '#cbd5e1',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <MapControls
        onCenterMe={handleCenterMe}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onResetView={handleResetView}
        onTogglePitch={handleTogglePitch}
        onToggleAreaInsights={handleToggleAreaInsights}
        areaInsightsEnabled={areaInsightsEnabled}
        showAreaInsightsButton
        showOfflineButton={false}
        onOverlayOpen={() => closeMapOverlays('')}
      >
        {children}
      </MapControls>

      <div className="maps-activity-actions">
        <>
          <button
            onClick={() => {
              closeMapOverlays('pendingPing')
              setPingMode((v) => !v)
              setPendingPing(null)
            }}
            className={`maps-ping-button ${pingMode ? 'active' : ''} ${
              activeTrailSession ? 'recording' : ''
            }`}
            type="button"
            aria-label={pingMode ? 'Cancel ping' : 'Add ping'}
            title={pingMode ? 'Cancel ping' : 'Add ping'}
          >
            {pingMode ? (
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : (
              <svg
                width="21"
                height="21"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 21s7-5.4 7-12a7 7 0 0 0-14 0c0 6.6 7 12 7 12z" />
                <circle cx="12" cy="9" r="2.4" />
              </svg>
            )}
          </button>
          <CameraButton
            onPhotoCapture={handlePhotoCapture}
            className={`maps-camera-button ${
              activeTrailSession ? 'recording' : ''
            }`}
          />
        </>
      </div>

      <PhotoCaptureModal
        photo={capturedPhoto}
        isOpen={showPhotoModal}
        onClose={() => {
          setShowPhotoModal(false)
          setCapturedPhoto(null)
        }}
        onSubmit={handlePhotoSubmit}
      />

      {showRadiusPanel ? (
        <div
          style={{
            ...styles.radiusWrap,
            bottom: activeTrailSession
              ? 'calc(env(safe-area-inset-bottom, 0px) + 188px)'
              : styles.radiusWrap.bottom,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <span style={{ fontSize: 12, color: '#8de0dc', fontWeight: 800 }}>
              Area insights
            </span>
            <button
              type="button"
              onClick={() => setAreaInsightsMinimized((value) => !value)}
              style={{
                ...pingBtnBase,
                padding: '4px 9px',
                fontSize: 11,
                background: 'rgba(148,163,184,0.14)',
                color: '#c9dcea',
              }}
            >
              {areaInsightsMinimized ? 'Expand' : 'Minimize'}
            </button>
          </div>

          {areaInsightsMinimized ? (
            <div
              style={{ ...styles.infoBox, fontSize: 11, padding: '7px 9px' }}
            >
              Area panel minimized.
            </div>
          ) : (
            <>
              <div style={styles.radiusRow}>
                <span style={styles.radiusLabel}>Area radius</span>
                <input
                  type="range"
                  min={2}
                  max={40}
                  step={1}
                  value={selectedAreaRadiusKm}
                  onChange={(event) =>
                    setSelectedAreaRadiusKm(Number(event.target.value))
                  }
                  style={styles.radiusInput}
                />
                <span style={styles.radiusValue}>
                  {selectedAreaRadiusKm} km
                </span>
              </div>

              <div
                style={{ ...styles.infoBox, fontSize: 11, padding: '6px 9px' }}
              >
                {!selectedAreaCenter ? (
                  <div>
                    Tap on the map to inspect exact trail starts inside this
                    radius.
                  </div>
                ) : selectedAreaTrails.length === 0 ? (
                  <div>
                    No trail starts found inside {selectedAreaRadiusKm} km.
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 6 }}>
                    <div style={{ fontWeight: 700, color: '#8de0dc' }}>
                      Trail starts in radius ({selectedAreaTrails.length})
                    </div>
                    <div
                      style={{
                        display: 'grid',
                        gap: 6,
                        maxHeight: 156,
                        overflowY: 'auto',
                        paddingRight: 2,
                      }}
                    >
                      {selectedAreaTrails.map((entry) => {
                        const trailId = entry.trail?._id || entry.trail?.id
                        return (
                          <div
                            key={`area-trail-${trailId}`}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 6,
                              border: '1px solid rgba(148,163,184,0.24)',
                              borderRadius: 8,
                              padding: '6px 8px',
                              background: 'rgba(15,23,35,0.58)',
                            }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <div
                                style={{
                                  fontSize: 12,
                                  fontWeight: 700,
                                  color: '#e2e8f0',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {entry.trail?.name || 'Unnamed trail'}
                              </div>
                              <div style={{ color: '#95adbf' }}>
                                start {Math.round(entry.distanceMeters)} m away
                              </div>
                            </div>
                            <button
                              onClick={() =>
                                handleFocusSelectedAreaTrail(entry)
                              }
                              style={{
                                ...pingBtnBase,
                                padding: '5px 10px',
                                fontSize: 11,
                                background: 'rgba(72,169,166,0.22)',
                                color: '#8de0dc',
                              }}
                            >
                              Focus
                            </button>
                          </div>
                        )
                      })}
                    </div>
                    {selectedAreaTrails.length > 3 ? (
                      <div style={{ color: '#93abc1' }}>
                        Scroll down to see more routes.
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </>
          )}

          {selectedAreaCenter && !areaInsightsMinimized ? (
            <div
              style={{ ...styles.infoBox, fontSize: 11, padding: '8px 9px' }}
            >
              {areaWeatherLoading ? (
                <div>Loading region weather...</div>
              ) : areaWeatherError ? (
                <div style={{ color: '#fca5a5' }}>{areaWeatherError}</div>
              ) : areaWeather ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, color: '#8de0dc' }}>
                      Selected Region Weather
                    </div>
                    <div>
                      {Math.round(areaWeather.temperature)}°C ·{' '}
                      {areaWeather.description}
                    </div>
                    <div style={{ color: '#93abc1' }}>
                      wind {areaWeather.windSpeed.toFixed(1)} m/s · humidity{' '}
                      {Math.round(areaWeather.humidity)}%
                    </div>
                  </div>
                  {areaWeather.icon ? (
                    <img
                      src={weatherIconUrl(areaWeather.icon)}
                      alt={areaWeather.condition}
                      style={{ width: 42, height: 42 }}
                    />
                  ) : null}
                </div>
              ) : (
                <div>Choose an area for weather details.</div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {loadingTrails ||
        trailsError ||
        geoError ||
        searchMapError ||
        mapError ||
        tilesetConfigWarning ? (
        <div
          style={{
            position: 'absolute',
            top: 'calc(env(safe-area-inset-top, 0px) + 88px)',
            left: 12,
            right: 12,
            zIndex: 12,
            display: 'grid',
            gap: 6,
            pointerEvents: 'none',
          }}
        >
          {loadingTrails ? (
            <div style={styles.infoBox}>Loading trails...</div>
          ) : null}
          {trailsError ? <div style={styles.infoBox}>{trailsError}</div> : null}
          {geoError ? <div style={styles.infoBox}>{geoError}</div> : null}
          {searchMapError ? (
            <div style={styles.infoBox}>{searchMapError}</div>
          ) : null}
          {mapError ? <div style={styles.infoBox}>{mapError}</div> : null}
          {tilesetConfigWarning ? (
            <div style={styles.infoBox}>{tilesetConfigWarning}</div>
          ) : null}
        </div>
      ) : null}

      {!isTrailFlowOverlayOpen ? (
        <>
          <RoutePreviewCard
            onStartTrail={handleOpenStartPlanner}
            bottomOffset={MAPS_BOTTOM_CARD_OFFSET}
            showScheduleButton={false}
          />
          <OfficialTrailCard
            trail={selectedOfficialTrail}
            onClose={() => setSelectedOfficialTrail(null)}
            onStartNavigation={handleOpenStartPlanner}
            bottomOffset={
              selectedOfficialTrail ? MAPS_BOTTOM_CARD_OFFSET : undefined
            }
          />
          <HutPreviewCard
            hut={selectedHut}
            onClose={() => setSelectedHut(null)}
            panel={selectedHutPanel}
            onPanelChange={setSelectedHutPanel}
          />
        </>
      ) : null}
    </div>
  )
}
