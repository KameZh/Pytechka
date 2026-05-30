import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import 'mapbox-gl/dist/mapbox-gl.css'
import Map, { Layer, Marker, Source } from 'react-map-gl/mapbox'
import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import { bbox as turfBbox } from '@turf/turf'
import BottomNav from '../components/layout/Bottomnav'
import MapControls from '../components/map/MapControls'
import LiveCompass from '../components/map/LiveCompass'
import EmergencyButton from '../components/map/EmergencyButton'
import HutMarkerButton from '../components/map/HutMarkerButton'
import RoutePreviewCard from '../components/layout/RoutePreviewCard'
import HutPreviewCard from '../components/layout/HutPreviewCard'
import RouteBuilderForm from '../components/route/RouteBuilderForm'
import CameraButton from '../components/camera/CameraButton'
import PhotoCaptureModal from '../components/camera/PhotoCaptureModal'
import { useMapStore } from '../store/mapStore'
import { useRecordingStore } from '../store/recordingStore'
import { fetchMapTrails, fetchMapTrailsGeojson, fetchHuts } from '../api/maps'
import { completeTrailFromMap } from '../api/maps'
import { addTrailCondition, fetchTrailById } from '../api/trails'
import {
  createPing,
  createPhotoPing,
  fetchPings,
  fetchClusters,
  voteClusterGone,
} from '../api/pings'
import { buildCenteredView } from '../utils/mapDefaults'
import TrailMapLayers from '../components/map/TrailMapLayers'
import {
  EMPTY_TRAIL_FEATURE_COLLECTION,
  getInteractiveTrailLayerIds,
  normalizeTrailGeojsonCollection,
  buildTrailGeojsonFromTrails,
} from '../components/map/trailMapLayerUtils'
import { useOfflineStore } from '../store/offlineStore'
import { downloadGpx } from '../utils/gpx'
import './Record.css'

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

const INITIAL_VIEW = buildCenteredView(7)
const TRAIL_VISIBILITY_MIN_ZOOM = 7
const RECORD_TRAIL_LAYER_PREFIX = 'record-trails'
const RECORD_INTERACTIVE_TRAIL_LAYER_IDS = getInteractiveTrailLayerIds(
  RECORD_TRAIL_LAYER_PREFIX
)
const RECORD_DEM_SOURCE_ID = 'record-relief-dem'
const MONGO_OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i

const asMongoObjectId = (value) => {
  const id = String(value || '').trim()
  return MONGO_OBJECT_ID_PATTERN.test(id) ? id : null
}

const PING_TYPES = {
  junk: { label: 'Junk / Rubbish', emoji: '🗑️', color: '#f59e0b' },
  mud: { label: 'Mud', emoji: '💧', color: '#92400e' },
  environmental_danger: {
    label: 'Environmental Danger',
    emoji: '🌳',
    color: '#dc2626',
  },
  photo: { label: 'Photo', emoji: '📷', color: '#8b5cf6' },
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

const RECORD_DRAWER_BOTTOM_GAP =
  'calc(var(--app-bottom-nav-space, 86px) + 10px)'

const pingBtnBase = {
  padding: '9px 14px',
  borderRadius: 10,
  border: 'none',
  cursor: 'pointer',
  fontWeight: 700,
  fontSize: 13,
  textAlign: 'center',
}

const pingPopupStyle = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: RECORD_DRAWER_BOTTOM_GAP,
  width: 'auto',
  margin: '0 10px',
  zIndex: 45,
  border: '1px solid rgba(66, 129, 164, 0.5)',
  borderRadius: 22,
  background: 'rgba(17, 26, 40, 0.95)',
  boxShadow: '0 12px 28px rgba(0,1,0,0.4)',
  backdropFilter: 'blur(8px)',
  padding: '16px 18px 18px',
  color: '#e2e8f0',
  maxHeight:
    'min(68dvh, calc(100dvh - env(safe-area-inset-top, 0px) - var(--app-bottom-nav-space, 86px) - 132px))',
  overflowY: 'auto',
  animation: 'map-drawer-in 180ms ease-out both',
}

const LIVE_RECORDING_NOTIFICATION_ID = 50001
const LIVE_RECORDING_CHANNEL_ID = 'recording-live'
const WRONG_TURN_DISTANCE_METERS = 85
const ARRIVAL_DISTANCE_METERS = 45

function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const hh = String(hours).padStart(2, '0')
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  return hours > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`
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

function deriveTrailStartCoordinates(trail) {
  const direct = Array.isArray(trail?.startCoordinates)
    ? trail.startCoordinates
    : Array.isArray(trail?.stats?.startCoordinates)
      ? trail.stats.startCoordinates
      : null

  if (Array.isArray(direct) && direct.length === 2) {
    return [Number(direct[0]), Number(direct[1])]
  }

  const parsed = parseTrailGeojson(trail?.geojson)
  if (!parsed) return null

  const extract = (shape) => {
    if (!shape || typeof shape !== 'object') return []
    if (shape.type === 'LineString') {
      return Array.isArray(shape.coordinates) ? shape.coordinates : []
    }
    if (shape.type === 'MultiLineString') {
      return Array.isArray(shape.coordinates)
        ? shape.coordinates.flatMap((line) => (Array.isArray(line) ? line : []))
        : []
    }
    if (shape.type === 'Feature') return extract(shape.geometry)
    if (shape.type === 'FeatureCollection') {
      return Array.isArray(shape.features)
        ? shape.features.flatMap((feature) => extract(feature?.geometry))
        : []
    }
    return []
  }

  const coordinates = extract(parsed)
  if (!coordinates.length) return null
  return [Number(coordinates[0][0]), Number(coordinates[0][1])]
}

const CONDITION_SURFACE_OPTIONS = [
  ['good', 'Good'],
  ['mixed', 'Mixed'],
  ['muddy', 'Muddy'],
  ['snow', 'Snow'],
  ['icy', 'Icy'],
  ['overgrown', 'Overgrown'],
  ['blocked', 'Blocked'],
]

const CONDITION_WATER_OPTIONS = [
  ['unknown', 'Unknown'],
  ['available', 'Available'],
  ['limited', 'Limited'],
  ['dry', 'Dry'],
]

const CONDITION_HAZARD_OPTIONS = [
  ['fallen_trees', 'Fallen trees'],
  ['landslide', 'Landslide'],
  ['flooded', 'Flooded'],
  ['missing_markers', 'Missing markers'],
  ['dangerous_animals', 'Animal risk'],
  ['trash', 'Trash'],
]

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
  if (parsed.type === 'Feature') return extractLineCoordinates(parsed.geometry)
  if (parsed.type === 'FeatureCollection') {
    return Array.isArray(parsed.features)
      ? parsed.features.flatMap((feature) =>
          extractLineCoordinates(feature?.geometry)
        )
      : []
  }
  return []
}

function distanceMeters(p1, p2) {
  const R = 6371000
  const toRad = (deg) => (deg * Math.PI) / 180
  const dLat = toRad(p2.latitude - p1.latitude)
  const dLon = toRad(p2.longitude - p1.longitude)
  const lat1 = toRad(p1.latitude)
  const lat2 = toRad(p2.latitude)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function lonLatDistanceMeters(a, b) {
  return distanceMeters(
    { longitude: Number(a?.[0]), latitude: Number(a?.[1]) },
    { longitude: Number(b?.[0]), latitude: Number(b?.[1]) }
  )
}

function pathLengthMeters(pathCoordinates) {
  if (!Array.isArray(pathCoordinates) || pathCoordinates.length < 2) return 0
  let total = 0
  for (let i = 1; i < pathCoordinates.length; i += 1) {
    total += lonLatDistanceMeters(pathCoordinates[i - 1], pathCoordinates[i])
  }
  return total
}

function distanceAlongPathMeters(pathCoordinates, endIndex) {
  if (!Array.isArray(pathCoordinates) || pathCoordinates.length < 2) return 0
  const safeEnd = Math.max(
    0,
    Math.min(pathCoordinates.length - 1, Number(endIndex) || 0)
  )
  let total = 0
  for (let i = 1; i <= safeEnd; i += 1) {
    total += lonLatDistanceMeters(pathCoordinates[i - 1], pathCoordinates[i])
  }
  return total
}

function getNearestPathPoint(pathCoordinates, location) {
  if (!Array.isArray(pathCoordinates) || !pathCoordinates.length || !location) {
    return null
  }

  let nearest = null
  for (let i = 0; i < pathCoordinates.length; i += 1) {
    const coord = pathCoordinates[i]
    const distance = distanceMeters(
      { longitude: Number(coord?.[0]), latitude: Number(coord?.[1]) },
      { longitude: location.longitude, latitude: location.latitude }
    )
    if (!nearest || distance < nearest.distanceMeters) {
      nearest = { index: i, coordinate: coord, distanceMeters: distance }
    }
  }
  return nearest
}

function buildTrailSegments(trail, pointCount) {
  const maxIndex = Math.max(0, Number(pointCount || 0) - 1)
  const marks = Array.isArray(trail?.trailMarks) ? trail.trailMarks : []
  const validMarks = marks
    .map((mark, index) => {
      const startIndex = Math.max(
        0,
        Math.min(maxIndex, Math.round(Number(mark?.startIndex || 0)))
      )
      const endIndex = Math.max(
        startIndex,
        Math.min(maxIndex, Math.round(Number(mark?.endIndex || maxIndex)))
      )
      return {
        name: mark?.name || `Sector ${index + 1}`,
        colourType: mark?.colourType || mark?.colour_type || 'unmarked',
        startIndex,
        endIndex,
      }
    })
    .filter((mark) => mark.endIndex >= mark.startIndex)

  if (validMarks.length) return validMarks
  return [
    {
      name: 'Finish',
      colourType: trail?.colour_type || 'unmarked',
      startIndex: 0,
      endIndex: maxIndex,
    },
  ]
}

export default function Record() {
  const mapRef = useRef(null)
  const pendingCenterRef = useRef(null)
  const hasAutoFittedTrailsRef = useRef(false)
  const lastCompassLocationRef = useRef(null)
  const liveNotificationReadyRef = useRef(false)
  const liveNotificationLastBodyRef = useRef('')
  const liveNotificationTickRef = useRef(-1)
  const wakeLockRef = useRef(null)
  const {
    mapStyle,
    terrain3D,
    hillshadeRelief,
    setSelectedTrail,
    setMode,
    selectedTrail,
  } = useMapStore()

  const [viewState, setViewState] = useState(INITIAL_VIEW)
  const {
    points,
    elapsedSeconds,
    distance,
    isTracking,
    autoPaused,
    splits,
    currentElevation,
    elevationGain,
    currentSpeedKmh,
    movementHeading,
    geoError: recordingGeoError,
    startTracking: startRecording,
    pauseTracking,
    reset: resetRecording,
  } = useRecordingStore()
  const [geoError, setGeoError] = useState('')
  const [trails, setTrails] = useState([])
  const [trailsGeojson, setTrailsGeojson] = useState(
    EMPTY_TRAIL_FEATURE_COLLECTION
  )
  const [loadingTrails, setLoadingTrails] = useState(true)
  const [trailsError, setTrailsError] = useState('')
  const [currentLocation, setCurrentLocation] = useState(null)
  const [savedRoute, setSavedRoute] = useState(null)
  const [aiStatus, setAiStatus] = useState(null)
  const [aiResult, setAiResult] = useState(null)
  const [saving] = useState(false)
  const [showPublishForm, setShowPublishForm] = useState(false)

  const [pings, setPings] = useState([])
  const [pingMode, setPingMode] = useState(false)
  const [pingType, setPingType] = useState('junk')
  const [pingDesc, setPingDesc] = useState('')
  const [pingSubmitting, setPingSubmitting] = useState(false)
  const [selectedPing, setSelectedPing] = useState(null)
  const [clusters, setClusters] = useState([])
  const [selectedCluster, setSelectedCluster] = useState(null)
  const [clusterVoting, setClusterVoting] = useState(null)
  const [isLegendVisible, setIsLegendVisible] = useState(false)
  const [loadedTrailActivity, setLoadedTrailActivity] = useState(null)
  const [navigationStatus, setNavigationStatus] = useState(null)

  // Photo capture state
  const [capturedPhoto, setCapturedPhoto] = useState(null)
  const [showPhotoModal, setShowPhotoModal] = useState(false)

  const [huts, setHuts] = useState([])
  const [selectedHut, setSelectedHut] = useState(null)
  const [selectedHutPanel, setSelectedHutPanel] = useState('info')

  const closeRecordOverlays = useCallback((keep = '') => {
    if (keep !== 'selectedPing') setSelectedPing(null)
    if (keep !== 'selectedCluster') setSelectedCluster(null)
    if (keep !== 'selectedHut') setSelectedHut(null)
    if (keep !== 'legend') setIsLegendVisible(false)
  }, [])

  const [showFinishModal, setShowFinishModal] = useState(false)
  const [finishRating, setFinishRating] = useState(0)
  const [finishComment, setFinishComment] = useState('')
  const [finishSubmitting, setFinishSubmitting] = useState(false)
  const [finishError, setFinishError] = useState('')
  const [finishSuccess, setFinishSuccess] = useState('')
  const [finishCondition, setFinishCondition] = useState({
    surface: 'mixed',
    waterSources: 'unknown',
    hazards: [],
    notes: '',
  })

  const {
    offlineHuts,
    offlinePings,
    offlineClusters,
    loadOfflineTrails,
    loadOfflineMapData,
    saveDraftTrail,
  } = useOfflineStore()


  const resolvedMapStyle =
    MAPBOX_STYLE_URL || `mapbox://styles/mapbox/${mapStyle}`
  const hasVectorTileset =
    Boolean(MAPBOX_TILESET_URL) &&
    MAPBOX_TILESET_TYPE === 'vector' &&
    Boolean(MAPBOX_TILESET_SOURCE_LAYER)
  const hasRasterTileset =
    Boolean(MAPBOX_TILESET_URL) && MAPBOX_TILESET_TYPE === 'raster'

  const routeGeoJSON = useMemo(() => {
    if (points.length < 2) return null
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: points.map((point) => [
              point.longitude,
              point.latitude,
            ]),
          },
          properties: {},
        },
      ],
    }
  }, [points])

  const visibleTrailSourceCollection = useMemo(
    () =>
      viewState.zoom >= TRAIL_VISIBILITY_MIN_ZOOM
        ? trailsGeojson
        : EMPTY_TRAIL_FEATURE_COLLECTION,
    [trailsGeojson, viewState.zoom]
  )

  useEffect(() => {
    if (hasAutoFittedTrailsRef.current) return

    const features = Array.isArray(visibleTrailSourceCollection.features)
      ? visibleTrailSourceCollection.features
      : []
    if (!features.length) return

    const map = mapRef.current?.getMap()
    if (!map || !map.loaded()) return

    try {
      const bounds = turfBbox(visibleTrailSourceCollection)
      if (!bounds || bounds.some((value) => !Number.isFinite(value))) return

      map.fitBounds(
        [
          [bounds[0], bounds[1]],
          [bounds[2], bounds[3]],
        ],
        {
          padding: 72,
          maxZoom: 14,
          duration: 1200,
        }
      )
      hasAutoFittedTrailsRef.current = true
    } catch {
    }
  }, [visibleTrailSourceCollection])

  const trailsById = useMemo(() => {
    const byId = new globalThis.Map()
    trails.forEach((trail) => {
      const id = String(trail?._id || trail?.id || '')
      if (id) byId.set(id, trail)
    })
    return byId
  }, [trails])

  const trailGeojsonFeaturesById = useMemo(() => {
    const byId = new globalThis.Map()
    const features = Array.isArray(trailsGeojson?.features)
      ? trailsGeojson.features
      : []
    features.forEach((feature) => {
      const id = String(feature?.properties?.id || '')
      if (id && !byId.has(id)) byId.set(id, feature)
    })
    return byId
  }, [trailsGeojson])

  const steps = useMemo(() => Math.round(distance / 0.78), [distance])

  const clearWatch = useCallback(() => {
    pauseTracking()
  }, [pauseTracking])

  const applyTerrain = useCallback((map, enabled) => {
    if (enabled) {
      if (!map.getSource('mapbox-dem')) {
        map.addSource('mapbox-dem', {
          type: 'raster-dem',
          url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
          tileSize: 512,
          maxzoom: 14,
        })
      }
      map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 })
      map.setPitch(45)
    } else {
      map.setTerrain(null)
      map.setPitch(0)
    }
  }, [])

  const centerOnCurrentLocation = useCallback(
    ({ longitude, latitude }, zoom = 16, duration = 1200) => {
      setViewState((old) => ({ ...old, longitude, latitude, zoom }))
      const map = mapRef.current?.getMap()
      const target = {
        center: [longitude, latitude],
        zoom,
        duration,
        essential: true,
      }

      if (map) {
        map.flyTo(target)
      } else {
        pendingCenterRef.current = target
      }
    },
    []
  )

  const handleMapLoad = useCallback(() => {
    const map = mapRef.current?.getMap()
    if (map) {
      applyTerrain(map, terrain3D)
      if (pendingCenterRef.current) {
        map.flyTo(pendingCenterRef.current)
        pendingCenterRef.current = null
      }
    }
  }, [applyTerrain, terrain3D])

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
    const nextPitch = tilted ? 0 : 58
    const nextBearing = tilted ? 0 : -18
    const nextZoom = tilted ? map.getZoom() : Math.max(map.getZoom(), 13)

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
      duration: 500,
      essential: true,
    })
  }, [])

  const startTracking = useCallback(() => {
    if (!navigator.geolocation) {
      setGeoError('Geolocation is not supported on this device.')
      return
    }

    setGeoError('')
    startRecording()

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setGeoError('')
        centerOnCurrentLocation({
          longitude: coords.longitude,
          latitude: coords.latitude,
        })
      },
      () => {
        setGeoError(
          'Could not access location. Allow GPS permissions and try again.'
        )
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 10000,
      }
    )
  }, [centerOnCurrentLocation, startRecording])

  const stopTracking = useCallback(() => {
    pauseTracking()
  }, [pauseTracking])

  const resetActivity = useCallback(() => {
    resetRecording()
    lastCompassLocationRef.current = null
    setGeoError('')
    setPingMode(false)
    setPingDesc('')
    setSelectedPing(null)
    setLoadedTrailActivity(null)
    setNavigationStatus(null)
    setSelectedTrail(null)
    setShowPublishForm(false)
    setSavedRoute(null)
    setAiStatus(null)
    setAiResult(null)
    setShowFinishModal(false)
    setFinishRating(0)
    setFinishComment('')
    setFinishError('')
    setFinishSuccess('')
    setFinishCondition({
      surface: 'mixed',
      waterSources: 'unknown',
      hazards: [],
      notes: '',
    })
  }, [resetRecording, setSelectedTrail])

  const recordedGeoJSON = useMemo(() => {
    if (points.length < 2) return null
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: points.map((p) => [
              p.longitude,
              p.latitude,
              ...(p.elevation != null ? [p.elevation] : []),
            ]),
          },
          properties: {},
        },
      ],
    }
  }, [points])

  const saveTracking = useCallback(() => {
    clearWatch()
    if (points.length < 2) return

    if (
      selectedTrail?._id ||
      selectedTrail?.id ||
      loadedTrailActivity?.trailId
    ) {
      setShowFinishModal(true)
      setFinishRating(0)
      setFinishComment('')
      setFinishError('')
      setFinishSuccess('')
      setFinishCondition({
        surface: 'mixed',
        waterSources: 'unknown',
        hazards: [],
        notes: '',
      })
    }

    setShowPublishForm(true)
  }, [clearWatch, points, selectedTrail, loadedTrailActivity])

  const submitTrailCompletion = useCallback(async () => {
    const trailId =
      selectedTrail?._id || selectedTrail?.id || loadedTrailActivity?.trailId
    if (!trailId) {
      setFinishError('No selected trail to rate.')
      return
    }

    setFinishSubmitting(true)
    setFinishError('')
    setFinishSuccess('')

    try {
      const payload = {
        durationSeconds: elapsedSeconds,
        distanceMeters: Math.round(distance),
        elevationGain: Math.round(elevationGain),
        ...(finishRating > 0 ? { accuracy: finishRating } : {}),
        ...(finishComment.trim() ? { comment: finishComment.trim() } : {}),
      }

      const res = await completeTrailFromMap(trailId, payload)
      const data = res?.data || {}

      const hasConditionReport =
        finishCondition.surface !== 'mixed' ||
        finishCondition.waterSources !== 'unknown' ||
        finishCondition.hazards.length > 0 ||
        finishCondition.notes.trim().length > 0

      if (hasConditionReport) {
        await addTrailCondition(trailId, {
          ...finishCondition,
          notes: finishCondition.notes.trim(),
        })
      }

      if (data.reviewAdded) {
        setFinishSuccess(
          hasConditionReport
            ? 'Trail completed. Rating and condition report saved.'
            : 'Trail completed and your rating was saved.'
        )
      } else if (finishRating > 0 && data.alreadyReviewed) {
        setFinishSuccess(
          hasConditionReport
            ? 'Trail completed. Condition report saved.'
            : 'Trail completed. You already reviewed it before.'
        )
      } else {
        setFinishSuccess(
          hasConditionReport
            ? 'Trail completion and condition report saved.'
            : 'Trail completion saved successfully.'
        )
      }

      setTimeout(() => setShowFinishModal(false), 1000)
    } catch (err) {
      setFinishError(
        err.response?.data?.error || 'Could not save completion now.'
      )
    } finally {
      setFinishSubmitting(false)
    }
  }, [
    selectedTrail,
    loadedTrailActivity,
    elapsedSeconds,
    distance,
    elevationGain,
    finishRating,
    finishComment,
    finishCondition,
  ])

  const toggleFinishHazard = useCallback((hazard) => {
    setFinishCondition((old) => ({
      ...old,
      hazards: old.hazards.includes(hazard)
        ? old.hazards.filter((entry) => entry !== hazard)
        : [...old.hazards, hazard],
    }))
  }, [])

  const handleExportGpx = useCallback(() => {
    const name =
      loadedTrailActivity?.trailName ||
      selectedTrail?.name ||
      `Pytechka activity ${new Date().toISOString().slice(0, 10)}`
    downloadGpx(points, name)
  }, [loadedTrailActivity, selectedTrail, points])

  const handlePublishSuccess = useCallback(
    async (trail) => {
      const localDraft = await saveDraftTrail({
        ...trail,
        stats: {
          distance: Math.round(distance),
          elevationGain: Math.round(elevationGain),
          duration: elapsedSeconds,
          pointCount: points.length,
          startCoordinates:
            points.length > 0
              ? [points[0].longitude, points[0].latitude]
              : undefined,
          endCoordinates:
            points.length > 0
              ? [
                  points[points.length - 1].longitude,
                  points[points.length - 1].latitude,
                ]
              : undefined,
        },
      })
      setShowPublishForm(false)
      setSavedRoute(localDraft)
      setAiStatus(null)
      setAiResult({
        message:
          'Trail saved on this device. Publish it from Account when you are ready.',
      })
    },
    [distance, elevationGain, elapsedSeconds, points, saveDraftTrail]
  )

  const handleCenterMe = useCallback(() => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setGeoError('')
        centerOnCurrentLocation(
          {
            longitude: coords.longitude,
            latitude: coords.latitude,
          },
          15,
          700
        )
      },
      () => {
        setGeoError(
          'Location is unavailable. Allow location access and try again.'
        )
      }
    )
  }, [centerOnCurrentLocation])

  const startLoadedTrailActivity = useCallback(
    async (trail) => {
      if (!trail) return

      const trailId = trail._id || trail.id
      if (!trailId) return

      let activityTrail = trail
      try {
        const res = await fetchTrailById(trailId)
        if (res?.data) activityTrail = res.data
      } catch {
        activityTrail = trail
      }

      const pathCoordinates = extractLineCoordinates(activityTrail.geojson)
      const segments = buildTrailSegments(activityTrail, pathCoordinates.length)
      const totalDistanceMeters =
        Number(activityTrail?.stats?.distance) || pathLengthMeters(pathCoordinates)
      const endCoordinate = pathCoordinates[pathCoordinates.length - 1] || null

      setLoadedTrailActivity({
        trailId,
        trailName: activityTrail.name || trail.name || 'Trail',
        trail: activityTrail,
        pathCoordinates,
        segments,
        totalDistanceMeters,
        endCoordinate,
      })

      const startCoordinates = deriveTrailStartCoordinates(activityTrail)
      if (startCoordinates) {
        setViewState((old) => ({
          ...old,
          longitude: startCoordinates[0],
          latitude: startCoordinates[1],
          zoom: Math.max(old.zoom, 13),
        }))
        mapRef.current?.getMap()?.flyTo({
          center: startCoordinates,
          zoom: 13,
          duration: 700,
          essential: true,
        })
      }

      setSelectedTrail(activityTrail)
      setPingMode(false)
    },
    [setSelectedTrail]
  )

  const handleMapClick = useCallback(
    (event) => {
      const map = mapRef.current?.getMap()
      if (!map) return

      const layerIds = RECORD_INTERACTIVE_TRAIL_LAYER_IDS.filter((id) =>
        map.getLayer(id)
      )

      if (!layerIds.length) {
        setSelectedTrail(null)
        setSelectedHut(null)
        setSelectedCluster(null)
        return
      }

      const features = map.queryRenderedFeatures(event.point, {
        layers: layerIds,
      })
      if (!features.length) {
        setSelectedTrail(null)
        setSelectedHut(null)
        setSelectedCluster(null)
        return
      }

      const properties = features[0]?.properties || {}
      const trailId = String(properties.id || '')
      const selected = trailsById.get(trailId)
      if (selected) {
        setSelectedTrail(selected)
        setSelectedHut(null)
        setSelectedCluster(null)
        return
      }

      const geojsonFeature = trailGeojsonFeaturesById.get(trailId)
      if (trailId && geojsonFeature) {
        setSelectedTrail({
          _id: trailId,
          id: trailId,
          name: properties.name || properties.name_bg || 'Trail',
          name_bg: properties.name_bg || '',
          name_en: properties.name_en || '',
          ref: properties.ref || '',
          source: properties.source || 'user',
          difficulty: properties.difficulty || 'moderate',
          colour_type: properties.colour_type || 'unmarked',
          osm_colour: properties.osm_colour || '',
          osm_marking: properties.osm_marking || '',
          network: properties.network || '',
          geojson: {
            type: 'Feature',
            geometry: geojsonFeature.geometry,
            properties,
          },
          stats: {
            distance: Number(properties.distance || 0) * 1000,
            elevationGain: Number(properties.elevation_gain || 0),
          },
        })
        setSelectedHut(null)
        setSelectedCluster(null)
      }
    },
    [setSelectedTrail, trailGeojsonFeaturesById, trailsById]
  )

  useEffect(() => {
    if (!navigator.geolocation) return

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const nextLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }

        setCurrentLocation(nextLocation)

        lastCompassLocationRef.current = nextLocation
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
    )

    return () => navigator.geolocation.clearWatch(watchId)
  }, [])

  useEffect(() => {
    let active = true

    const loadTrails = async () => {
      setLoadingTrails(true)
      setTrailsError('')

      // Step 1: immediately show whatever is in offline storage
      await loadOfflineTrails()
      await loadOfflineMapData()
      const cachedTrails = useOfflineStore.getState().offlineTrails
      if (cachedTrails.length > 0) {
        setTrails([...cachedTrails])
        setTrailsGeojson(buildTrailGeojsonFromTrails(cachedTrails))
        setLoadingTrails(false) // stop the spinner immediately
      }

      // Step 2: try to fetch from API in the background
      try {
        const [trailsResult, geojsonResult] = await Promise.allSettled([
          fetchMapTrails({ compact: true }),
          fetchMapTrailsGeojson(),
        ])
        if (!active) return

        const fresh = cachedTrails.length === 0 // only show loading if we had nothing to show

        if (trailsResult.status === 'fulfilled') {
          const apiTrails = Array.isArray(trailsResult.value?.data) ? trailsResult.value.data : []
          const mergedMap = new globalThis.Map()
          cachedTrails.forEach(t => mergedMap.set(t._id || t.id, t))
          apiTrails.forEach(t => mergedMap.set(t._id || t.id, t))
          setTrails(Array.from(mergedMap.values()))
        } else if (cachedTrails.length === 0) {
          setTrailsError('Could not load trail details from API. Record mode still works.')
        }

        if (geojsonResult.status === 'fulfilled') {
          const apiGeojson = normalizeTrailGeojsonCollection(geojsonResult.value?.data)
          const offlineGeojson = buildTrailGeojsonFromTrails(cachedTrails)
          const mergedFeatures = new globalThis.Map()
          apiGeojson.features.forEach(f => { if (f.properties?.id) mergedFeatures.set(f.properties.id, f) })
          offlineGeojson.features.forEach(f => { if (f.properties?.id && !mergedFeatures.has(f.properties.id)) mergedFeatures.set(f.properties.id, f) })
          setTrailsGeojson({ type: 'FeatureCollection', features: Array.from(mergedFeatures.values()) })
        } else if (cachedTrails.length === 0) {
          setTrailsGeojson(EMPTY_TRAIL_FEATURE_COLLECTION)
        }

        if (fresh) setLoadingTrails(false)
      } catch {
        if (!active) return
        if (cachedTrails.length === 0) {
          setTrailsError('Offline — no cached trails available.')
          setLoadingTrails(false)
        }
      }
    }

    loadTrails()

    return () => {
      active = false
      setMode('explore')
      setSelectedTrail(null)
    }
  }, [setMode, setSelectedTrail, loadOfflineMapData, loadOfflineTrails])


  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (map && map.loaded()) {
      applyTerrain(map, terrain3D)
    }
  }, [applyTerrain, terrain3D])

  useEffect(() => {
    return undefined
  }, [isTracking, autoPaused])

  useEffect(() => {
    if (!savedRoute?._id) return
    if (aiStatus === 'done' || aiStatus === 'error') return

    const interval = setInterval(async () => {
      try {
        const res = await fetchTrailById(savedRoute._id)
        const status = res.data.ai?.status
        setAiStatus(status)
        if (status === 'done') {
          setAiResult(res.data.ai)
          clearInterval(interval)
        } else if (status === 'error') {
          setAiResult({ error: res.data.ai?.error || 'Analysis failed' })
          clearInterval(interval)
        }
      } catch {
        /* Ignore transient polling failures. */
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [savedRoute, aiStatus])

  useEffect(() => {
    let active = true
    if (offlinePings.length) setPings(offlinePings)
    fetchPings()
      .then((res) => {
        if (active) setPings(Array.isArray(res.data) ? res.data : [])
      })
      .catch(() => {
        if (active) setPings(offlinePings)
      })
    return () => {
      active = false
    }
  }, [offlinePings])

  useEffect(() => {
    let active = true
    if (offlineClusters.length) setClusters(offlineClusters)
    fetchClusters()
      .then((res) => {
        if (active) setClusters(Array.isArray(res.data) ? res.data : [])
      })
      .catch(() => {
        if (active) setClusters(offlineClusters)
      })
    return () => {
      active = false
    }
  }, [offlineClusters])

  useEffect(() => {
    let active = true
    if (offlineHuts.length) setHuts(offlineHuts)
    fetchHuts()
      .then((res) => {
        if (active) setHuts(Array.isArray(res.data) ? res.data : [])
      })
      .catch(() => {
        if (active) setHuts(offlineHuts)
      })
    return () => {
      active = false
    }
  }, [offlineHuts])

  const handlePingSubmit = useCallback(async () => {
    if (!currentLocation) return
    setPingSubmitting(true)
    try {
      let nearestTrailId = loadedTrailActivity?.trailId || null
      if (trails.length > 0) {
        let minDist = Infinity
        for (const trail of trails) {
          const center = trail.stats?.centerCoordinates
          if (Array.isArray(center) && center.length === 2) {
            const d = distanceMeters(
              {
                latitude: currentLocation.latitude,
                longitude: currentLocation.longitude,
              },
              { latitude: center[1], longitude: center[0] }
            )
            if (d < minDist) {
              minDist = d
              nearestTrailId = trail._id || trail.id
            }
          }
        }
        if (minDist > 2000) nearestTrailId = null
      }

      const res = await createPing({
        trailId: nearestTrailId,
        type: pingType,
        description: pingDesc,
        coordinates: [currentLocation.longitude, currentLocation.latitude],
      })
      setPings((prev) => [res.data, ...prev])
      fetchClusters()
        .then((clustersRes) =>
          setClusters(
            Array.isArray(clustersRes.data) ? clustersRes.data : []
          )
        )
        .catch(() => {})
      setPingMode(false)
      setPingDesc('')
    } catch (err) {
      console.error('Ping submit error:', err)
    } finally {
      setPingSubmitting(false)
    }
  }, [
    currentLocation,
    pingType,
    pingDesc,
    trails,
    loadedTrailActivity,
  ])

  const handleClusterVote = useCallback(async (clusterId) => {
    setClusterVoting(clusterId)
    try {
      const res = await voteClusterGone(clusterId)
      if (res.data?.resolved) {
        setClusters((prev) => prev.filter((cluster) => cluster._id !== clusterId))
        setSelectedCluster(null)
      } else {
        setClusters((prev) =>
          prev.map((cluster) =>
            cluster._id === clusterId ? res.data : cluster
          )
        )
        setSelectedCluster(res.data)
      }
    } catch (err) {
      console.error('Cluster vote error:', err)
    } finally {
      setClusterVoting(null)
    }
  }, [])

  // Handle photo capture from camera button
  const handlePhotoCapture = useCallback(
    (photo) => {
      closeRecordOverlays('')
      setCapturedPhoto(photo)
      setShowPhotoModal(true)
    },
    [closeRecordOverlays]
  )

  // Handle photo submission
  const handlePhotoSubmit = useCallback(async (photoData) => {
    try {
      const trailId = asMongoObjectId(loadedTrailActivity?.trailId)
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
  }, [loadedTrailActivity])

  useEffect(() => {
    if (!loadedTrailActivity?.pathCoordinates?.length || !currentLocation) {
      setNavigationStatus(null)
      return
    }

    const nearest = getNearestPathPoint(
      loadedTrailActivity.pathCoordinates,
      currentLocation
    )
    if (!nearest) {
      setNavigationStatus(null)
      return
    }

    const coveredMeters = distanceAlongPathMeters(
      loadedTrailActivity.pathCoordinates,
      nearest.index
    )
    const totalMeters =
      Number(loadedTrailActivity.totalDistanceMeters) ||
      pathLengthMeters(loadedTrailActivity.pathCoordinates)
    const progressPercent =
      totalMeters > 0
        ? Math.max(0, Math.min(100, (coveredMeters / totalMeters) * 100))
        : 0
    const nextSegment =
      loadedTrailActivity.segments?.find(
        (segment) => nearest.index <= Number(segment.endIndex)
      ) || null

    let distanceToNextMeters = null
    if (nextSegment) {
      const targetDistance = distanceAlongPathMeters(
        loadedTrailActivity.pathCoordinates,
        nextSegment.endIndex
      )
      distanceToNextMeters = Math.max(0, targetDistance - coveredMeters)
    }

    const finishDistanceMeters = loadedTrailActivity.endCoordinate
      ? distanceMeters(
          {
            longitude: currentLocation.longitude,
            latitude: currentLocation.latitude,
          },
          {
            longitude: Number(loadedTrailActivity.endCoordinate[0]),
            latitude: Number(loadedTrailActivity.endCoordinate[1]),
          }
        )
      : null

    setNavigationStatus({
      offRoute: nearest.distanceMeters > WRONG_TURN_DISTANCE_METERS,
      nearestDistanceMeters: nearest.distanceMeters,
      progressPercent,
      coveredMeters,
      totalMeters,
      nextSegment,
      distanceToNextMeters,
      arrived:
        Number.isFinite(finishDistanceMeters) &&
        finishDistanceMeters <= ARRIVAL_DISTANCE_METERS,
    })
  }, [loadedTrailActivity, currentLocation])

  const hasRecordingData =
    points.length > 0 || elapsedSeconds > 0 || distance > 0
  const showControls = hasRecordingData || isTracking
  const completionTrail =
    selectedTrail ||
    (loadedTrailActivity
      ? {
          _id: loadedTrailActivity.trailId,
          id: loadedTrailActivity.trailId,
          name: loadedTrailActivity.trailName,
        }
      : null)

  const liveNotificationBody = useMemo(() => {
    return [
      `${steps.toLocaleString()} STEPS   ${formatDuration(elapsedSeconds)} TIME   ${(distance / 1000).toFixed(2)} KM`,
      `${Math.round(currentElevation)} M ELEV   +${Math.round(elevationGain)} GAIN   ${currentSpeedKmh.toFixed(1)} KM/H`,
    ].join('\n')
  }, [
    steps,
    elapsedSeconds,
    distance,
    currentElevation,
    elevationGain,
    currentSpeedKmh,
  ])

  useEffect(() => {
    let released = false

    const requestWakeLock = async () => {
      if (!isTracking || !navigator.wakeLock?.request) return
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen')
        wakeLockRef.current.addEventListener('release', () => {
          if (!released) wakeLockRef.current = null
        })
      } catch {
        wakeLockRef.current = null
      }
    }

    const releaseWakeLock = async () => {
      released = true
      try {
        await wakeLockRef.current?.release?.()
      } catch {
        /* Wake lock release is best-effort. */
      } finally {
        wakeLockRef.current = null
      }
    }

    requestWakeLock()

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isTracking) {
        requestWakeLock()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      releaseWakeLock()
    }
  }, [isTracking])

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    let cancelled = false
    ;(async () => {
      try {
        const permissions = await LocalNotifications.checkPermissions()
        if (permissions.display !== 'granted') {
          await LocalNotifications.requestPermissions()
        }

        if (Capacitor.getPlatform() === 'android') {
          await LocalNotifications.createChannel({
            id: LIVE_RECORDING_CHANNEL_ID,
            name: 'Live recording',
            description: 'Live stats while recording a trail',
            importance: 2,
            visibility: 1,
            sound: undefined,
          })
        }

        await LocalNotifications.cancel({
          notifications: [{ id: 1101 }],
        })

        if (!cancelled) {
          liveNotificationReadyRef.current = true
        }
      } catch {
        /* Native notification permission setup is best-effort. */
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    if (!liveNotificationReadyRef.current) return

    const syncNotification = async () => {
      if (!isTracking) {
        liveNotificationLastBodyRef.current = ''
        liveNotificationTickRef.current = -1
        try {
          await LocalNotifications.cancel({
            notifications: [{ id: LIVE_RECORDING_NOTIFICATION_ID }],
          })
        } catch {
          /* Native notification cancellation is best-effort. */
        }
        return
      }

      const tick = Math.floor(elapsedSeconds / 5)
      const shouldUpdate =
        elapsedSeconds === 0 ||
        tick !== liveNotificationTickRef.current ||
        liveNotificationBody !== liveNotificationLastBodyRef.current

      if (!shouldUpdate) return

      liveNotificationTickRef.current = tick
      liveNotificationLastBodyRef.current = liveNotificationBody

      try {
        await LocalNotifications.schedule({
          notifications: [
            {
              id: LIVE_RECORDING_NOTIFICATION_ID,
              channelId:
                Capacitor.getPlatform() === 'android'
                  ? LIVE_RECORDING_CHANNEL_ID
                  : undefined,
              title: 'Trail recording in progress',
              body: liveNotificationBody,
              ongoing: true,
              autoCancel: false,
              schedule: { at: new Date(Date.now() + 100) },
            },
          ],
        })
      } catch {
        /* Native notification sync is best-effort. */
      }
    }

    syncNotification()
  }, [isTracking, elapsedSeconds, liveNotificationBody])

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    return () => {
      LocalNotifications.cancel({
        notifications: [{ id: LIVE_RECORDING_NOTIFICATION_ID }],
      }).catch(() => {})
    }
  }, [])

  if (!MAPBOX_TOKEN) {
    return (
      <div className="record-page">
        <div className="record-fallback">
          <div className="record-fallback-card">
            <h3>Record cannot start</h3>
            <p>Missing VITE_MAPBOX_TOKEN in frontend environment.</p>
          </div>
        </div>
        <div className="record-bottomnav-wrap">
          <BottomNav />
        </div>
      </div>
    )
  }

  return (
    <div id="record-page" className="record-page">
      <div className="record-glow record-glow-top" />
      <div className="record-glow record-glow-bottom" />

      <div className="record-map-layer">
        <Map
          ref={mapRef}
          {...viewState}
          onMove={(event) => setViewState(event.viewState)}
          mapStyle={resolvedMapStyle}
          mapboxAccessToken={MAPBOX_TOKEN}
          className="record-map"
          attributionControl={false}
          onLoad={handleMapLoad}
          onClick={handleMapClick}
        >
          {hillshadeRelief ? (
            <Source
              id={RECORD_DEM_SOURCE_ID}
              type="raster-dem"
              url="mapbox://mapbox.mapbox-terrain-dem-v1"
              tileSize={512}
              maxzoom={14}
            >
              <Layer
                id="record-hillshade-relief"
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

          <TrailMapLayers
            sourceId="record-trails-source"
            layerPrefix={RECORD_TRAIL_LAYER_PREFIX}
            data={visibleTrailSourceCollection}
          />

          {hasVectorTileset ? (
            <Source
              id="record-custom-tileset-source"
              type="vector"
              url={MAPBOX_TILESET_URL}
            >
              <Layer
                id="record-custom-tileset-layer"
                type="line"
                source="record-custom-tileset-source"
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
              id="record-custom-tileset-source"
              type="raster"
              url={MAPBOX_TILESET_URL}
            >
              <Layer
                id="record-custom-tileset-raster-layer"
                type="raster"
                paint={{ 'raster-opacity': 0.9 }}
              />
            </Source>
          ) : null}

          {routeGeoJSON && (
            <Source id="record-route" type="geojson" data={routeGeoJSON}>
              <Layer
                id="record-route-line"
                type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                paint={{
                  'line-color': '#48a9a6',
                  'line-width': 5,
                  'line-opacity': 0.95,
                }}
              />
            </Source>
          )}

          {currentLocation && (
            <Marker
              latitude={currentLocation.latitude}
              longitude={currentLocation.longitude}
              anchor="center"
            >
              <div className="current-location-marker" />
            </Marker>
          )}

          {viewState.zoom >= 10 &&
            huts.map((hut) => {
              if (!Array.isArray(hut.location) || hut.location.length < 2)
                return null
              const [lng, lat] = hut.location
              const isSelected = selectedHut?._id === hut._id
              return (
                <Marker
                  key={hut._id}
                  longitude={lng}
                  latitude={lat}
                  anchor="bottom"
                >
                  <HutMarkerButton
                    title={hut.name}
                    selected={isSelected}
                    activePanel={selectedHutPanel}
                    onToggle={() => {
                      closeRecordOverlays(isSelected ? '' : 'selectedHut')
                      setSelectedHut(isSelected ? null : hut)
                      setSelectedHutPanel('info')
                    }}
                    onPanelChange={(panel) => {
                      closeRecordOverlays('selectedHut')
                      setSelectedHut(hut)
                      setSelectedHutPanel(panel)
                    }}
                  />
                </Marker>
              )
            })}

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
                      closeRecordOverlays('selectedPing')
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
                    closeRecordOverlays('selectedPing')
                    setSelectedPing(
                      selectedPing?._id === ping._id ? null : ping
                    )
                  }}
                >
                  <div
                    style={{ ...pingMarkerStyle, background: cfg.color }}
                    title={`${cfg.label}: ${ping.description || 'No description'}`}
                  >
                    {cfg.emoji}
                  </div>
                </Marker>
              )
            })}

          {clusters.map((cluster) => {
            if (
              !Array.isArray(cluster.coordinates) ||
              cluster.coordinates.length < 2
            ) {
              return null
            }

            const cfg =
              CLUSTER_CONFIG[cluster.level] || CLUSTER_CONFIG.clutter

            return (
              <Marker
                key={cluster._id}
                longitude={cluster.coordinates[0]}
                latitude={cluster.coordinates[1]}
                anchor="center"
                style={{ zIndex: selectedCluster?._id === cluster._id ? 12 : 8 }}
                onClick={(e) => {
                  e.originalEvent.stopPropagation()
                  closeRecordOverlays('selectedCluster')
                  setSelectedCluster(
                    selectedCluster?._id === cluster._id ? null : cluster
                  )
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
        </Map>
      </div>

      <LiveCompass
        mapBearing={viewState.bearing}
        movementHeading={movementHeading}
        top={`calc(env(safe-area-inset-top, 0px) + ${showControls ? 142 : 12}px)`}
        left={12}
        zIndex={19}
      />
      <EmergencyButton
        top={`calc(env(safe-area-inset-top, 0px) + ${showControls ? 236 : 106}px)`}
        left={22}
        zIndex={20}
      />

      <CameraButton
        onPhotoCapture={handlePhotoCapture}
        className={`record-camera-button ${
          showControls ? 'record-map-action-shifted' : ''
        }`}
      />

      {/* Photo capture modal */}
      <PhotoCaptureModal
        photo={capturedPhoto}
        isOpen={showPhotoModal}
        onClose={() => {
          setShowPhotoModal(false)
          setCapturedPhoto(null)
        }}
        onSubmit={handlePhotoSubmit}
      />

      <button
        onClick={() => {
          setPingMode((v) => !v)
          setSelectedPing(null)
        }}
        className={`record-ping-button ${pingMode ? 'active' : ''} ${
          showControls ? 'record-map-action-shifted' : ''
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

      {pingMode && (
        <div style={pingPopupStyle}>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10 }}>
            New Ping at your location
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
                <span style={{ fontSize: 20, display: 'block' }}>
                  {cfg.emoji}
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

          {!currentLocation && (
            <div style={{ fontSize: 12, color: '#f87171', marginBottom: 8 }}>
              Waiting for GPS location...
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => {
                setPingMode(false)
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
              disabled={pingSubmitting || !currentLocation}
              style={{
                ...pingBtnBase,
                flex: 1,
                background: 'linear-gradient(135deg, #48a9a6, #4281a4)',
                color: '#fff',
                opacity: pingSubmitting || !currentLocation ? 0.6 : 1,
              }}
            >
              {pingSubmitting ? 'Saving...' : 'Place Ping'}
            </button>
          </div>
        </div>
      )}

      {selectedPing && !pingMode && (
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
              {PING_TYPES[selectedPing.type]?.emoji || '📌'}
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
            By {selectedPing.username || 'Anonymous'} &middot;{' '}
            {new Date(selectedPing.createdAt).toLocaleDateString()}
          </div>
          <button
            onClick={() => setSelectedPing(null)}
            style={{
              ...pingBtnBase,
              marginTop: 8,
              background: 'rgba(148,163,184,0.15)',
              color: '#94a3b8',
              width: '100%',
            }}
          >
            Close
          </button>
        </div>
      )}

      {selectedCluster && !pingMode && (
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
            {selectedCluster.pingCount !== 1 ? 's' : ''} in this area
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
              disabled={clusterVoting === selectedCluster._id}
              style={{
                ...pingBtnBase,
                flex: 1,
                background: 'rgba(34,197,94,0.18)',
                color: '#4ade80',
              }}
            >
              {clusterVoting === selectedCluster._id ? '...' : 'Cleaned up'}
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
      )}

      {showControls ? (
        <div className="record-status-wrap">
          <div className="record-topbar">
            <div className="record-stats-grid record-top-stats-enter">
              <div className="record-top-stat">
                <span className="record-top-stat-value">
                  {steps.toLocaleString()}
                </span>
                <span className="record-top-stat-label">Steps</span>
              </div>
              <div className="record-top-stat">
                <span className="record-top-stat-value">
                  {formatDuration(elapsedSeconds)}
                </span>
                <span className="record-top-stat-label">Time</span>
              </div>
              <div className="record-top-stat">
                <span className="record-top-stat-value">
                  {(distance / 1000).toFixed(2)}
                </span>
                <span className="record-top-stat-label">km</span>
              </div>
              <div className="record-top-stat">
                <span className="record-top-stat-value">
                  {Math.round(currentElevation)}
                </span>
                <span className="record-top-stat-label">m Elev</span>
              </div>
              <div className="record-top-stat">
                <span className="record-top-stat-value">
                  +{Math.round(elevationGain)}
                </span>
                <span className="record-top-stat-label">Gain</span>
              </div>
              <div className="record-top-stat">
                <span className="record-top-stat-value">
                  {currentSpeedKmh.toFixed(1)}
                </span>
                <span className="record-top-stat-label">km/h</span>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div
        className={`record-info-wrap ${
          showControls ? 'record-info-wrap-active' : ''
        }`}
      >
        {loadingTrails && (
          <div className="record-info-box">Loading trails...</div>
        )}
        {trailsError && (
          <div className="record-info-box record-info-error">
            {trailsError}
          </div>
        )}
        {(geoError || recordingGeoError) && (
          <div className="record-info-box record-info-error">
            {geoError || recordingGeoError}
          </div>
        )}
        {autoPaused && (
          <div className="record-info-box">Auto-paused while standing still.</div>
        )}
        {navigationStatus?.offRoute && (
          <div className="record-info-box record-info-error">
            Wrong-turn warning: you are about{' '}
            {Math.round(navigationStatus.nearestDistanceMeters)} m from the
            loaded route.
          </div>
        )}
      </div>

      {isLegendVisible ? (
        <div className="record-legend-panel">
          <div className="record-legend-head">
            <span>Legend</span>
            <button
              type="button"
              onClick={() => setIsLegendVisible(false)}
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
            <div className="record-legend-row" key={label}>
              <span
                style={{
                  borderTop: `${width}px ${dashed ? 'dashed' : 'solid'} ${color}`,
                }}
              />
              <span>{label}</span>
            </div>
          ))}
        </div>
      ) : null}

      <MapControls
        onCenterMe={handleCenterMe}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onTogglePitch={handleTogglePitch}
        showResetViewButton={false}
        showOfflineButton={false}
        onOverlayOpen={() => closeRecordOverlays('')}
      >
        <button
          type="button"
          className={`record-legend-button ${isLegendVisible ? 'active' : ''}`}
          onClick={() => {
            const willOpen = !isLegendVisible
            if (willOpen) closeRecordOverlays('legend')
            setIsLegendVisible(willOpen)
          }}
          title={isLegendVisible ? 'Hide legend' : 'Show legend'}
          aria-label={isLegendVisible ? 'Hide legend' : 'Show legend'}
          aria-pressed={isLegendVisible}
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
      </MapControls>

      {selectedTrail && !selectedHut && !loadedTrailActivity && (
        <RoutePreviewCard onStartTrail={startLoadedTrailActivity} />
      )}

      {selectedHut && (
        <HutPreviewCard
          hut={selectedHut}
          onClose={() => setSelectedHut(null)}
          panel={selectedHutPanel}
          onPanelChange={setSelectedHutPanel}
        />
      )}

      {savedRoute && (
        <div className="record-ai-panel">
          {(aiStatus === 'pending' || aiStatus === 'processing') && (
            <div className="record-ai-loading">
              <div className="record-ai-spinner" />
              <span>Analyzing your route...</span>
            </div>
          )}

          {aiStatus === 'error' && (
            <div className="record-ai-error">
              <span>Route analysis failed</span>
              {aiResult?.error && <p>{aiResult.error}</p>}
            </div>
          )}

          {aiStatus === 'done' && aiResult && (
            <div className="record-ai-results">
              <h3 className="record-ai-title">Route Analysis</h3>

              {aiResult.overallDifficulty && (
                <div
                  className={`record-ai-difficulty record-ai-diff-${aiResult.overallDifficulty}`}
                >
                  Overall: {aiResult.overallDifficulty.toUpperCase()}
                </div>
              )}

              {aiResult.summary && (
                <p className="record-ai-summary">{aiResult.summary}</p>
              )}

              {aiResult.segments?.length > 0 && (
                <div className="record-ai-segments">
                  <h4>Segments</h4>
                  {aiResult.segments.map((seg, i) => (
                    <div
                      key={i}
                      className={`record-ai-segment record-ai-seg-${seg.difficulty}`}
                    >
                      <div className="record-ai-seg-header">
                        <strong>{seg.name}</strong>
                        <span className="record-ai-seg-badge">
                          {seg.difficulty}
                        </span>
                        {seg.estimatedTime && (
                          <span className="record-ai-seg-time">
                            {seg.estimatedTime}
                          </span>
                        )}
                      </div>
                      <p>{seg.description}</p>
                    </div>
                  ))}
                </div>
              )}

              {aiResult.warnings?.length > 0 && (
                <div className="record-ai-warnings">
                  <h4>Warnings</h4>
                  {aiResult.warnings.map((w, i) => (
                    <div
                      key={i}
                      className={`record-ai-warning record-ai-warn-${w.severity}`}
                    >
                      <span className="record-ai-warn-severity">
                        {w.severity?.toUpperCase()}
                      </span>
                      <span>{w.description}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {loadedTrailActivity && navigationStatus && (
        <div className="record-navigation-panel">
          <div className="record-navigation-head">
            <span>{loadedTrailActivity.trailName}</span>
            <strong>{Math.round(navigationStatus.progressPercent)}%</strong>
          </div>
          <div className="record-navigation-bar">
            <span style={{ width: `${navigationStatus.progressPercent}%` }} />
          </div>
          <div className="record-navigation-grid">
            <div>
              <span>Route</span>
              <strong>
                {(navigationStatus.coveredMeters / 1000).toFixed(1)} /{' '}
                {(navigationStatus.totalMeters / 1000).toFixed(1)} km
              </strong>
            </div>
            <div>
              <span>Next mark</span>
              <strong>
                {navigationStatus.nextSegment
                  ? `${Math.round(
                      navigationStatus.distanceToNextMeters || 0
                    )} m`
                  : '--'}
              </strong>
            </div>
            <div>
              <span>Status</span>
              <strong>
                {navigationStatus.arrived
                  ? 'Arrived'
                  : navigationStatus.offRoute
                    ? 'Off route'
                    : 'On route'}
              </strong>
            </div>
          </div>
          {navigationStatus.nextSegment ? (
            <div className="record-navigation-sector">
              {navigationStatus.nextSegment.name}
              {navigationStatus.nextSegment.colourType
                ? ` · ${navigationStatus.nextSegment.colourType}`
                : ''}
            </div>
          ) : null}
        </div>
      )}

      <div className="record-live-panel-wrap">
        <div className="record-live-panel">
          {!hasRecordingData && !isTracking ? (
            <div className="record-start-only-row">
              <button
                onClick={startTracking}
                className="record-primary-btn record-start-btn"
              >
                Start Recording
              </button>
            </div>
          ) : (
            <div className="record-controls-stack record-actions-enter">
              {splits.length > 0 ? (
                <div className="record-splits-row">
                  {splits.slice(-3).map((split) => (
                    <div key={`${split.km}-${split.recordedAt}`}>
                      <span>{split.km} km</span>
                      <strong>{formatDuration(split.elapsedSeconds)}</strong>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="record-actions-row">
                <button
                  onClick={saveTracking}
                  disabled={saving || points.length < 2}
                  className="record-action-btn record-save-btn"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>

                {isTracking ? (
                  <button
                    onClick={stopTracking}
                    className="record-primary-btn record-stop-btn"
                  >
                    Pause
                  </button>
                ) : (
                  <button
                    onClick={startTracking}
                    className="record-primary-btn record-resume-btn"
                  >
                    Resume
                  </button>
                )}

                <button
                  onClick={resetActivity}
                  className="record-action-btn record-reset-btn"
                >
                  Reset
                </button>
              </div>
              <button
                type="button"
                onClick={handleExportGpx}
                disabled={points.length < 2}
                className="record-gpx-btn"
              >
                Export GPX
              </button>
            </div>
          )}
        </div>
      </div>

      {showPublishForm && recordedGeoJSON && (
        <RouteBuilderForm
          geojson={recordedGeoJSON}
          title="Save Trail"
          submitLabel="Save to device"
          publishOnSubmit={false}
          onSuccess={handlePublishSuccess}
          onCancel={() => setShowPublishForm(false)}
        />
      )}

      {showFinishModal && completionTrail && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 60,
            background: 'rgba(3, 9, 17, 0.56)',
            display: 'grid',
            placeItems: 'center',
            padding: 14,
          }}
          onClick={() => {
            if (!finishSubmitting) setShowFinishModal(false)
          }}
        >
          <div
            style={{
              width: 'min(92vw, 460px)',
              border: '1px solid rgba(66,129,164,0.5)',
              borderRadius: 14,
              background: 'rgba(17,26,40,0.96)',
              boxShadow: '0 12px 28px rgba(0,1,0,0.45)',
              backdropFilter: 'blur(8px)',
              color: '#e2e8f0',
              padding: 14,
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ fontSize: 12, color: '#89afc2', fontWeight: 700 }}>
              TRAIL COMPLETED
            </div>
            <h3 style={{ margin: '4px 0 8px 0' }}>
              Congrats! You finished {completionTrail.name}.
            </h3>

            <div
              style={{
                border: '1px solid rgba(148,163,184,0.28)',
                borderRadius: 10,
                padding: '8px 10px',
                fontSize: 13,
                display: 'grid',
                gap: 4,
              }}
            >
              <div>Distance: {(distance / 1000).toFixed(2)} km</div>
              <div>Time: {formatDuration(elapsedSeconds)}</div>
              <div>Elevation gain: +{Math.round(elevationGain)} m</div>
            </div>

            <div style={{ marginTop: 10, fontSize: 12, color: '#bfd4de' }}>
              Rate this trail (optional):
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
                border: '1px solid rgba(66,129,164,0.34)',
                background: 'rgba(15,23,35,0.88)',
                color: '#fbfef9',
                fontSize: 13,
                outline: 'none',
                padding: 10,
                boxSizing: 'border-box',
              }}
            />

            <div className="record-finish-condition">
              <div className="record-finish-condition-title">
                Trail conditions now
              </div>
              <div className="record-finish-condition-grid">
                <label>
                  Surface
                  <select
                    value={finishCondition.surface}
                    onChange={(event) =>
                      setFinishCondition((old) => ({
                        ...old,
                        surface: event.target.value,
                      }))
                    }
                  >
                    {CONDITION_SURFACE_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Water
                  <select
                    value={finishCondition.waterSources}
                    onChange={(event) =>
                      setFinishCondition((old) => ({
                        ...old,
                        waterSources: event.target.value,
                      }))
                    }
                  >
                    {CONDITION_WATER_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="record-finish-hazards">
                {CONDITION_HAZARD_OPTIONS.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={
                      finishCondition.hazards.includes(value) ? 'is-active' : ''
                    }
                    onClick={() => toggleFinishHazard(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <textarea
                value={finishCondition.notes}
                onChange={(event) =>
                  setFinishCondition((old) => ({
                    ...old,
                    notes: event.target.value,
                  }))
                }
                placeholder="Condition note for the next hikers (optional)"
                rows={2}
                maxLength={500}
              />
            </div>

            {finishError && (
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
            )}
            {finishSuccess && (
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
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button
                onClick={submitTrailCompletion}
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
                onClick={() => setShowFinishModal(false)}
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
        </div>
      )}

      <div className="record-bottomnav-wrap">
        <BottomNav />
      </div>
    </div>
  )
}
