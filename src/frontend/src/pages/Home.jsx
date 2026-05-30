import { useCallback, useId, useRef, useState, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth, useClerk, useUser } from '@clerk/clerk-react'
import api from '../api/client'
import { updateTrail, deleteTrail, publishTrail } from '../api/trails'
import BottomNav from '../components/layout/Bottomnav'
import OfflineMapModal from '../components/map/OfflineMapModal'
import { useOfflineStore } from '../store/offlineStore'
import './Account.css'

const BADGE_TIERS = {
  trailers: [
    { min: 20, name: 'Senior', color: '#dfc94c' },
    { min: 10, name: 'Junior', color: '#74aed0' },
    { min: 3, name: 'Rookie', color: '#82c0de' },
  ],
  contribution: [
    { min: 20, name: 'Country guide', color: '#dfc94c' },
    { min: 10, name: 'Local guide', color: '#74aed0' },
    { min: 3, name: 'New guide', color: '#82c0de' },
  ],
  campaign: [
    { min: 20, name: 'Basically organizer', color: '#dfc94c' },
    { min: 10, name: 'Helper', color: '#74aed0' },
    { min: 3, name: 'Volunteer', color: '#82c0de' },
  ],
}

function pickTier(category, value = 0) {
  const tiers = BADGE_TIERS[category] || []
  const found = tiers.find((t) => value >= t.min)
  return found || null
}

function getNextGoal(category, value = 0) {
  const tiers = (BADGE_TIERS[category] || [])
    .map((tier) => Number(tier.min) || 0)
    .sort((a, b) => a - b)

  return tiers.find((goal) => value < goal) ?? null
}

const TRAIL_MARK_OPTIONS = [
  { value: 'red', label: 'Red', color: '#ef4444' },
  { value: 'blue', label: 'Blue', color: '#3b82f6' },
  { value: 'green', label: 'Green', color: '#22c55e' },
  { value: 'yellow', label: 'Yellow', color: '#eab308' },
  { value: 'white', label: 'White', color: '#f8fafc' },
  { value: 'black', label: 'Black', color: '#0f172a' },
  { value: 'unmarked', label: 'Unmarked', color: '#6b7280' },
]

const TRAIL_MARK_COLORS = TRAIL_MARK_OPTIONS.reduce((acc, option) => {
  acc[option.value] = option.color
  return acc
}, {})

function parseLineCoordinates(geojson) {
  if (!geojson || typeof geojson !== 'object') return []
  if (geojson.type === 'LineString') {
    return Array.isArray(geojson.coordinates)
      ? geojson.coordinates
          .map((point) => [Number(point?.[0]), Number(point?.[1])])
          .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]))
      : []
  }
  if (geojson.type === 'MultiLineString') {
    return Array.isArray(geojson.coordinates)
      ? geojson.coordinates.flatMap((line) => parseLineCoordinates({
          type: 'LineString',
          coordinates: line,
        }))
      : []
  }
  if (geojson.type === 'Feature') return parseLineCoordinates(geojson.geometry)
  if (geojson.type === 'FeatureCollection') {
    return Array.isArray(geojson.features)
      ? geojson.features.flatMap((feature) => parseLineCoordinates(feature?.geometry))
      : []
  }
  return []
}

function formatTrailDistance(stats = {}) {
  const meters = Number(stats.distance || 0)
  if (!Number.isFinite(meters) || meters <= 0) return '--'
  const km = meters / 1000
  return `${km >= 10 ? km.toFixed(1) : km.toFixed(2)} km`
}

function formatTrailElevation(stats = {}) {
  const gain = Number(stats.elevationGain || 0)
  if (!Number.isFinite(gain) || gain <= 0) return '--'
  return `${Math.round(gain)} m`
}

function formatTrailHigh(stats = {}, highestPoint = '') {
  const high = Number(stats.highestPoint || 0)
  if (Number.isFinite(high) && high > 0) return `${Math.round(high)} m`
  return highestPoint || '--'
}

function formatTrailTime(stats = {}) {
  const seconds = Number(stats.duration || 0)
  if (!Number.isFinite(seconds) || seconds <= 0) return '--'
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

function TrailStatsStrip({ trail }) {
  return (
    <div className="account-trail-stats-strip">
      <span>
        <small>Distance</small>
        <strong>{formatTrailDistance(trail?.stats)}</strong>
      </span>
      <span>
        <small>Gain</small>
        <strong>{formatTrailElevation(trail?.stats)}</strong>
      </span>
      <span>
        <small>High</small>
        <strong>{formatTrailHigh(trail?.stats, trail?.highestPoint)}</strong>
      </span>
      <span>
        <small>Time</small>
        <strong>{formatTrailTime(trail?.stats)}</strong>
      </span>
    </div>
  )
}

function BadgeRing({ progress, maxGoal, label }) {
  const percent = Math.max(0, Math.min(100, (Number(progress || 0) / maxGoal) * 100))
  return (
    <div
      className="badge-ring"
      style={{
        '--badge-progress': `${percent > 0 ? Math.max(3, percent) : 0}%`,
      }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={maxGoal}
      aria-valuenow={Math.min(Number(progress || 0), maxGoal)}
      aria-label={label}
    >
      <div className="badge-ring-inner">
        <strong>{progress}</strong>
        <span>of {maxGoal}</span>
      </div>
    </div>
  )
}

function TrailCarouselCard({
  trail,
  type,
  publishingDraftId,
  onOpenDraft,
  onPublishDraft,
  onDiscardDraft,
  onOpenTrail,
  onEditTrail,
  onDeleteTrail,
}) {
  const id = trail.localId || trail._id || trail.id
  return (
    <article className="account-trail-carousel-card">
      <div className="account-carousel-head">
        <span className="my-trail-name">{trail.name || 'Unnamed trail'}</span>
        <span className="my-trail-meta">
          {type === 'draft' ? 'Saved on device' : 'Published'} ·{' '}
          {trail.difficulty || 'moderate'}
        </span>
      </div>
      <AccountTrailMap trail={trail} />
      <TrailStatsStrip trail={trail} />
      <div className="account-carousel-actions">
        {type === 'draft' ? (
          <>
            <button
              className="my-trail-save-btn"
              onClick={() => onOpenDraft(trail)}
              disabled={publishingDraftId === id}
            >
              Open
            </button>
            <button
              className="my-trail-save-btn"
              onClick={() => onPublishDraft(trail)}
              disabled={publishingDraftId === id}
            >
              {publishingDraftId === id ? 'Publishing...' : 'Publish'}
            </button>
            <button
              className="my-trail-delete-btn"
              onClick={() => onDiscardDraft(id)}
              disabled={publishingDraftId === id}
            >
              Discard
            </button>
          </>
        ) : (
          <>
            <button className="my-trail-save-btn" onClick={() => onOpenTrail?.(trail)}>
              Open
            </button>
            <button className="my-trail-edit-btn" onClick={() => onEditTrail(trail)}>
              Edit
            </button>
            <button className="my-trail-delete-btn" onClick={() => onDeleteTrail(id)}>
              Delete
            </button>
          </>
        )}
      </div>
    </article>
  )
}

function trailNeedsTelemetryRepair(trail) {
  if (!trail?.geojson) return false
  const stats = trail.stats || {}
  const hasDistance = Number(stats.distance || 0) > 0
  const hasHighest = Number(stats.highestPoint || 0) > 0 || Boolean(trail.highestPoint)
  const hasDuration = Number(stats.duration || 0) > 0
  return !hasDistance || !hasHighest || !hasDuration
}

function createPreviewProjection(coordinates, width = 340, height = 176, padding = 24) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null
  const lngs = coordinates.map((point) => Number(point[0]))
  const lats = coordinates.map((point) => Number(point[1]))
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const lngSpan = Math.max(0.000001, maxLng - minLng)
  const latSpan = Math.max(0.000001, maxLat - minLat)
  const usableWidth = width - padding * 2
  const usableHeight = height - padding * 2
  const scale = Math.min(usableWidth / lngSpan, usableHeight / latSpan)
  const routeWidth = lngSpan * scale
  const routeHeight = latSpan * scale
  const offsetX = (width - routeWidth) / 2
  const offsetY = (height - routeHeight) / 2

  const projectPoint = (point) => {
      const x = offsetX + (Number(point[0]) - minLng) * scale
      const y = height - (offsetY + (Number(point[1]) - minLat) * scale)
    return {
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
    }
  }

  const toPath = (points) =>
    (Array.isArray(points) ? points : [])
      .map((point) => {
        const projected = projectPoint(point)
        return `${projected.x},${projected.y}`
      })
      .join(' ')

  return {
    toPath,
    start: projectPoint(coordinates[0]),
    end: projectPoint(coordinates[coordinates.length - 1]),
  }
}

function AccountTrailMap({ trail }) {
  const previewId = useId().replace(/:/g, '')
  const bgId = `${previewId}-bg`
  const gridId = `${previewId}-grid`
  const shadowId = `${previewId}-shadow`
  const pathCoordinates = useMemo(
    () => parseLineCoordinates(trail?.geojson),
    [trail?.geojson]
  )
  const projection = useMemo(
    () => createPreviewProjection(pathCoordinates),
    [pathCoordinates]
  )
  const previewPath = projection?.toPath(pathCoordinates) || ''
  const sectorPaths = useMemo(() => {
    if (!projection) return []
    const maxIndex = pathCoordinates.length - 1
    return (Array.isArray(trail?.trailMarks) ? trail.trailMarks : [])
      .map((segment, index) => {
        const startIndex = Math.max(0, Math.min(maxIndex, Number(segment?.startIndex || 0)))
        const endIndex = Math.max(startIndex, Math.min(maxIndex, Number(segment?.endIndex || maxIndex)))
        const coordinates = pathCoordinates.slice(startIndex, endIndex + 1)
        const points = projection.toPath(coordinates)
        if (!points) return null
        return {
          id: `${trail?._id || trail?.localId || 'draft'}-${index}`,
          points,
          color: TRAIL_MARK_COLORS[segment?.colourType] || TRAIL_MARK_COLORS.unmarked,
        }
      })
      .filter(Boolean)
  }, [pathCoordinates, projection, trail?.trailMarks, trail?._id, trail?.localId])

  if (!previewPath) {
    return (
      <div className="account-trail-map account-trail-map-empty">
        Trail map is unavailable for this route.
      </div>
    )
  }

  return (
    <div className="account-trail-map">
      <svg
        className="account-trail-preview"
        viewBox="0 0 340 176"
        role="img"
        aria-label={`${trail?.name || 'Trail'} preview`}
      >
        <defs>
          <linearGradient id={bgId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgba(72,169,166,0.16)" />
            <stop offset="48%" stopColor="rgba(15,23,42,0.2)" />
            <stop offset="100%" stopColor="rgba(66,129,164,0.16)" />
          </linearGradient>
          <pattern id={gridId} width="28" height="28" patternUnits="userSpaceOnUse">
            <path d="M 28 0 L 0 0 0 28" fill="none" stroke="rgba(141,224,220,0.07)" strokeWidth="1" />
          </pattern>
          <filter id={shadowId} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="4" stdDeviation="5" floodColor="#000" floodOpacity="0.42" />
          </filter>
        </defs>
        <rect width="340" height="176" rx="14" fill={`url(#${bgId})`} />
        <rect width="340" height="176" rx="14" fill={`url(#${gridId})`} />
        <polyline
          points={previewPath}
          fill="none"
          stroke="rgba(2,6,23,0.88)"
          strokeWidth="9"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter={`url(#${shadowId})`}
        />
        <polyline
          points={previewPath}
          fill="none"
          stroke="#48a9a6"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {sectorPaths.map((segment) => (
          <polyline
            key={segment.id}
            points={segment.points}
            fill="none"
            stroke={segment.color}
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {projection?.start ? (
          <circle cx={projection.start.x} cy={projection.start.y} r="6" fill="#22c55e" stroke="#fbfef9" strokeWidth="2" />
        ) : null}
        {projection?.end ? (
          <circle cx={projection.end.x} cy={projection.end.y} r="5" fill="#82c0de" stroke="#fbfef9" strokeWidth="2" />
        ) : null}
      </svg>
    </div>
  )
}

function normalizeTrailMarksInput(trailMarks, maxPointIndex) {
  const limit = Number.isFinite(maxPointIndex)
    ? Math.max(0, Math.floor(maxPointIndex))
    : Number.POSITIVE_INFINITY

  return (Array.isArray(trailMarks) ? trailMarks : [])
    .map((segment, index) => {
      const colourType = String(segment?.colourType || '').toLowerCase()
      if (!TRAIL_MARK_OPTIONS.some((entry) => entry.value === colourType)) {
        return null
      }

      const rawStart = Number(segment?.startIndex)
      const rawEnd = Number(segment?.endIndex)
      if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) return null

      const startIndex = Math.max(
        0,
        Math.min(limit, Math.round(Math.min(rawStart, rawEnd)))
      )
      const endIndex = Math.max(
        startIndex,
        Math.min(limit, Math.round(Math.max(rawStart, rawEnd)))
      )

      return {
        name: String(segment?.name || `Sector ${index + 1}`).slice(0, 80),
        description: String(segment?.description || '').slice(0, 300),
        colourType,
        startIndex,
        endIndex,
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.startIndex - b.startIndex || a.endIndex - b.endIndex)
}

export default function Home() {
  const { isSignedIn, getToken } = useAuth()
  const { user } = useUser()
  const { signOut, openUserProfile } = useClerk()
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [dbUser, setDbUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [badgeProgress, setBadgeProgress] = useState(null)
  const [myTrails, setMyTrails] = useState([])
  const [loadError, setLoadError] = useState('')
  const [profileError, setProfileError] = useState('')
  const [trailsError, setTrailsError] = useState('')
  const [editingTrail, setEditingTrail] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [editSaving, setEditSaving] = useState(false)
  const [publishingDraftId, setPublishingDraftId] = useState(null)
  const [draftError, setDraftError] = useState('')
  const [offlineModalOpen, setOfflineModalOpen] = useState(false)
  const [expandedDrawers, setExpandedDrawers] = useState({
    badges: false,
    offline: false,
    drafts: false,
    published: false,
  })
  const navigate = useNavigate()
  const {
    draftTrails,
    offlineTrails,
    offlineHuts,
    offlinePings,
    offlineClusters,
    offlineEvents,
    offlineMapPacks,
    offlineDeviceInfo,
    loadDraftTrails,
    loadOfflineTrails,
    loadOfflineMapData,
    clearOfflineMapData,
    clearAll,
    removeDraftTrail,
    updateDraftTrail,
  } = useOfflineStore()
  const draftTelemetryRepairingRef = useRef(new Set())

  const toggleDrawer = (key) => {
    setExpandedDrawers((prev) => ({
      ...prev,
      [key]: !prev[key],
    }))
  }

  const describeApiError = (err) => {
    const status = err?.response?.status ? `HTTP ${err.response.status}` : ''
    const code = err?.code ? String(err.code) : ''
    const message =
      err?.response?.data?.error || err?.message || 'Unknown backend error'

    return [status, code, message].filter(Boolean).join(' - ')
  }

  const refreshMyTrails = useCallback(async () => {
    if (!isSignedIn) return
    const token = await getToken()
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined
    const res = await api.get('/trails/mine', { headers })
    setMyTrails(Array.isArray(res.data) ? res.data : [])
  }, [getToken, isSignedIn])

  useEffect(() => {
    if (!isSignedIn) {
      setLoading(false)
      return
    }

    let canceled = false

    ;(async () => {
      try {
        setLoadError('')
        setProfileError('')
        setTrailsError('')
        const token = await getToken()
        const headers = token ? { Authorization: `Bearer ${token}` } : undefined
        const [profileResult, trailsResult] = await Promise.allSettled([
          api.get('/user/profile', { headers }),
          api.get('/trails/mine', { headers }),
        ])

        if (!canceled && profileResult.status === 'fulfilled') {
          setDbUser(profileResult.value.data)
          setBadgeProgress(profileResult.value.data?.badgeProgress || null)
        } else if (!canceled) {
          setProfileError(describeApiError(profileResult.reason))
        }

        if (!canceled && trailsResult.status === 'fulfilled') {
          setMyTrails(Array.isArray(trailsResult.value.data) ? trailsResult.value.data : [])
        } else if (!canceled) {
          setTrailsError(describeApiError(trailsResult.reason))
        }

        if (
          !canceled &&
          profileResult.status === 'rejected' &&
          trailsResult.status === 'rejected'
        ) {
          setLoadError('Could not load backend data from ngrok.')
        } else if (!canceled) {
          setLoadError('')
        }
      } catch (err) {
        console.error('Failed to fetch profile:', err)
        setLoadError(describeApiError(err))
      } finally {
        if (!canceled) setLoading(false)
      }
    })()

    return () => {
      canceled = true
    }
  }, [isSignedIn, getToken])

  useEffect(() => {
    if (!isSignedIn) return undefined

    let lastRefresh = 0
    const refreshIfVisible = () => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - lastRefresh < 2500) return
      lastRefresh = now
      refreshMyTrails().catch((err) => {
        setTrailsError(describeApiError(err))
      })
    }

    window.addEventListener('focus', refreshIfVisible)
    document.addEventListener('visibilitychange', refreshIfVisible)
    return () => {
      window.removeEventListener('focus', refreshIfVisible)
      document.removeEventListener('visibilitychange', refreshIfVisible)
    }
  }, [isSignedIn, refreshMyTrails])

  useEffect(() => {
    if (isSignedIn) {
      loadDraftTrails()
      loadOfflineTrails()
      loadOfflineMapData()
    }
  }, [isSignedIn, loadDraftTrails, loadOfflineMapData, loadOfflineTrails])

  useEffect(() => {
    if (!isSignedIn || !draftTrails.length) return

    draftTrails.forEach((draft) => {
      const id = draft?.localId
      if (!id || !trailNeedsTelemetryRepair(draft)) return
      if (draftTelemetryRepairingRef.current.has(id)) return

      draftTelemetryRepairingRef.current.add(id)
      api
        .post('/trails/telemetry', {
          geojson: draft.geojson,
          stats: draft.stats || {},
        })
        .then((res) => {
          const stats = res.data?.stats
          if (!stats) return
          return updateDraftTrail(id, {
            stats: {
              ...(draft.stats || {}),
              ...stats,
            },
            highestPoint: res.data?.highestPoint || draft.highestPoint || '',
            difficulty: draft.difficulty || res.data?.difficulty || 'moderate',
          })
        })
        .catch((err) => {
          console.error('Failed to repair local draft telemetry:', err)
        })
        .finally(() => {
          draftTelemetryRepairingRef.current.delete(id)
        })
    })
  }, [draftTrails, isSignedIn, updateDraftTrail])

  const handleEditOpen = (trail) => {
    const maxPointIndex = Math.max(0, Number(trail?.stats?.pointCount || 0) - 1)
    setEditingTrail(trail._id)
    setEditForm({
      name: trail.name || '',
      region: trail.region || '',
      difficulty: trail.difficulty || 'moderate',
      description: trail.description || '',
      equipment: trail.equipment || '',
      resources: trail.resources || '',
      trailMarks: normalizeTrailMarksInput(trail.trailMarks, maxPointIndex),
      maxPointIndex,
    })
  }

  const handleTrailMarkChange = (index, key, value) => {
    setEditForm((prev) => {
      const next = Array.isArray(prev.trailMarks) ? [...prev.trailMarks] : []
      if (!next[index]) return prev

      const normalizedValue =
        key === 'startIndex' || key === 'endIndex' ? Number(value) : value
      next[index] = {
        ...next[index],
        [key]: normalizedValue,
      }

      return {
        ...prev,
        trailMarks: next,
      }
    })
  }

  const handleAddTrailMark = () => {
    setEditForm((prev) => ({
      ...prev,
      trailMarks: [
        ...(Array.isArray(prev.trailMarks) ? prev.trailMarks : []),
        {
          name: `Sector ${(prev.trailMarks?.length || 0) + 1}`,
          description: '',
          colourType: 'red',
          startIndex: 0,
          endIndex: 1,
        },
      ],
    }))
  }

  const handleRemoveTrailMark = (index) => {
    setEditForm((prev) => ({
      ...prev,
      trailMarks: (Array.isArray(prev.trailMarks) ? prev.trailMarks : []).filter(
        (_, idx) => idx !== index
      ),
    }))
  }

  const handleEditSave = async () => {
    if (!editingTrail) return
    setEditSaving(true)
    try {
      const payload = {
        ...editForm,
        trailMarks: normalizeTrailMarksInput(
          editForm.trailMarks,
          Number(editForm.maxPointIndex)
        ),
      }
      const res = await updateTrail(editingTrail, payload)
      setMyTrails((prev) =>
        prev.map((t) => (t._id === editingTrail ? { ...t, ...res.data } : t))
      )
      setEditingTrail(null)
    } catch (err) {
      console.error('Failed to update trail:', err)
    } finally {
      setEditSaving(false)
    }
  }

  const handleDeleteTrail = async (id) => {
    try {
      await deleteTrail(id)
      setMyTrails((prev) => prev.filter((t) => t._id !== id))
      if (editingTrail === id) setEditingTrail(null)
    } catch (err) {
      console.error('Failed to delete trail:', err)
    }
  }

  const handlePublishDraft = async (draft) => {
    if (!draft?.localId) return
    setPublishingDraftId(draft.localId)
    setDraftError('')
    try {
      const res = await publishTrail({
        geojson: draft.geojson,
        name: draft.name,
        region: draft.region,
        difficulty: draft.difficulty,
        description: draft.description,
        equipment: draft.equipment,
        resources: draft.resources,
        stats: draft.stats,
        trailMarks: normalizeTrailMarksInput(
          draft.trailMarks,
          Math.max(0, Number(draft.stats?.pointCount || 0) - 1)
        ),
      })
      await removeDraftTrail(draft.localId)
      setMyTrails((prev) => [res.data, ...prev])
    } catch (err) {
      setDraftError(describeApiError(err) || 'Could not publish local trail.')
    } finally {
      setPublishingDraftId(null)
    }
  }

  const handleDiscardDraft = async (draftId) => {
    await removeDraftTrail(draftId)
  }

  const handleOpenDraftOnMap = (draft) => {
    if (!draft?.localId) return
    const coordinates = parseLineCoordinates(draft.geojson)
    const firstPoint = coordinates[0]
    const params = new URLSearchParams({ draftId: draft.localId })
    if (Array.isArray(firstPoint) && firstPoint.length === 2) {
      params.set('startLng', String(firstPoint[0]))
      params.set('startLat', String(firstPoint[1]))
    }
    navigate(`/maps?${params.toString()}`)
  }

  const handleOpenPublishedOnMap = (trail) => {
    const trailId = trail?._id || trail?.id
    if (!trailId) return
    const coordinates = parseLineCoordinates(trail.geojson)
    const firstPoint = coordinates[0]
    const params = new URLSearchParams({ trailId })
    if (Array.isArray(firstPoint) && firstPoint.length === 2) {
      params.set('startLng', String(firstPoint[0]))
      params.set('startLat', String(firstPoint[1]))
    }
    navigate(`/maps?${params.toString()}`)
  }

  const handleLogout = async () => {
    await signOut()
    setShowLogoutConfirm(false)
    navigate('/login')
  }

  const handleDeleteAccount = async () => {
    try {
      await user?.delete()
      setShowDeleteConfirm(false)
      navigate('/signup')
    } catch {
      setShowDeleteConfirm(false)
    }
  }

  const handleOpenProfile = () => {
    if (openUserProfile) openUserProfile()
  }

  if (!isSignedIn || loading) {
    if (loading) {
      return (
        <div className="account-page">
          <div className="account-scroll">
            <div className="account-badges-box" style={{ color: '#9fb9d0' }}>
              Loading account...
            </div>
          </div>
          <BottomNav />
        </div>
      )
    }
    return (
      <div className="account-page">
        <div className="account-login-prompt">
          <div className="account-guest-shell">
            <h2 className="explore-title">Welcome to Pytechka</h2>
            <p>
              Create an account to start your adventure or log into an existing
              one
            </p>
            <div className="account-guest-actions">
              <Link to="/signup" className="account-guest-link">
                <button className="account-btn account-btn-primary">
                  Sign Up
                </button>
              </Link>
              <Link to="/login" className="account-guest-link">
                <button className="account-btn account-btn-secondary">
                  Log In
                </button>
              </Link>
            </div>
          </div>
        </div>
        <BottomNav />
      </div>
    )
  }

  const displayName =
    dbUser?.username ||
    user?.username ||
    user?.firstName ||
    user?.fullName ||
    '—'
  const email =
    dbUser?.email ||
    user?.primaryEmailAddress?.emailAddress ||
    ''
  const avatarUrl =
    dbUser?.avatarUrl || dbUser?.photoUrl || dbUser?.imageUrl || user?.imageUrl
  const avatarInitial =
    (dbUser?.username ||
      user?.firstName ||
      user?.username ||
      '?')[0]?.toUpperCase?.() || '?'

  const totalDistance = myTrails.reduce(
    (sum, t) => sum + (t.stats?.distance || 0),
    0
  )
  const totalDuration = myTrails.reduce(
    (sum, t) => sum + (t.stats?.duration || 0),
    0
  )
  const totalSteps = Math.round(totalDistance / 0.762) // avg stride ~0.762m
  const totalElevation = myTrails.reduce(
    (sum, t) => sum + (t.stats?.elevationGain || 0),
    0
  )

  const formatDistance = (m) => {
    if (m >= 1000) return `${(m / 1000).toFixed(1)} km`
    return `${Math.round(m)} m`
  }

  const formatTime = (sec) => {
    if (!sec) return '0 min'
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    if (h > 0) return `${h}h ${m}m`
    return `${m} min`
  }

  const activityChart = [
    { label: 'Distance', value: totalDistance / 1000, display: formatDistance(totalDistance), color: '#48a9a6' },
    { label: 'Elevation', value: totalElevation / 100, display: `${Math.round(totalElevation)} m`, color: '#82c0de' },
    { label: 'Time', value: totalDuration / 3600, display: formatTime(totalDuration), color: '#74aed0' },
  ]
  const chartMax = Math.max(1, ...activityChart.map((entry) => entry.value))
  const activityRingPercent = Math.max(
    4,
    Math.min(100, (totalDistance / 250000) * 100)
  )
  const averageTrailDistance = myTrails.length
    ? totalDistance / myTrails.length
    : 0

  const badgeCards = [
    {
      key: 'trailers',
      title: 'Trailers',
      progress: badgeProgress?.trailCompletions || 0,
      tier: pickTier('trailers', badgeProgress?.trailCompletions || 0),
      nextGoal: getNextGoal('trailers', badgeProgress?.trailCompletions || 0),
    },
    {
      key: 'contribution',
      title: 'Contributors',
      progress: Math.max(badgeProgress?.createdTrails || 0, myTrails.length),
      tier: pickTier('contribution', Math.max(badgeProgress?.createdTrails || 0, myTrails.length)),
      nextGoal: getNextGoal('contribution', Math.max(badgeProgress?.createdTrails || 0, myTrails.length)),
    },
    {
      key: 'campaign',
      title: 'Campaign',
      progress: badgeProgress?.campaignPoints || 0,
      tier: pickTier('campaign', badgeProgress?.campaignPoints || 0),
      nextGoal: getNextGoal('campaign', badgeProgress?.campaignPoints || 0),
    },
  ]

  return (
    <div className="account-page">
      <div className="account-scroll">
          {loadError ? (
            <div className="account-section">
              <div className="account-badges-box" style={{ color: '#fca5a5' }}>
                {loadError}
              </div>
            </div>
          ) : null}

          {profileError ? (
            <div className="account-section">
              <div className="account-badges-box" style={{ color: '#fca5a5' }}>
                Profile: {profileError}
              </div>
            </div>
          ) : null}

          {trailsError ? (
            <div className="account-section">
              <div className="account-badges-box" style={{ color: '#fca5a5' }}>
                Trails: {trailsError}
              </div>
            </div>
          ) : null}

        <div className="account-profile">
          <div className="account-avatar">
            {avatarUrl ? (
              <img src={avatarUrl} alt="Profile" />
            ) : (
              <span>{avatarInitial}</span>
            )}
          </div>
          <div className="account-info">
            <h2 className="account-name">{displayName}</h2>
            <p className="account-email">{email}</p>
          </div>
        </div>

        <section className="account-section account-drawer account-badges-section">
          <h3 className="account-section-title">Badges</h3>
          <div className="account-badges-box account-drawer-surface">
            {!expandedDrawers.badges ? (
              <>
                <div className="badge-summary-row">
                  {badgeCards.map((card) => {
                    const tiers = [...(BADGE_TIERS[card.key] || [])].sort(
                      (a, b) => a.min - b.min
                    )
                    const maxGoal = tiers[tiers.length - 1]?.min || 20
                    return (
                      <button
                        key={card.key}
                        type="button"
                        className="badge-mini-card"
                        onClick={() => toggleDrawer('badges')}
                      >
                        <span className="badge-mini-title">{card.title}</span>
                        <BadgeRing
                          progress={card.progress}
                          maxGoal={maxGoal}
                          label={`${card.title} badge progress`}
                        />
                        <span
                          className={`badge-mini-tier ${card.tier ? '' : 'empty'}`}
                          style={card.tier ? { color: card.tier.color } : undefined}
                        >
                          {card.tier?.name || 'Earn it'}
                        </span>
                      </button>
                    )
                  })}
                </div>
                <button
                  type="button"
                  className="account-drawer-toggle"
                  onClick={() => toggleDrawer('badges')}
                >
                  Show all
                </button>
              </>
            ) : (
              <div className="account-drawer-expand">
                <div className="badge-grid">
                  {badgeCards.map((card) => (
                    <div key={card.key} className="badge-card">
                  {(() => {
                    const tiers = [...(BADGE_TIERS[card.key] || [])].sort(
                      (a, b) => a.min - b.min
                    )
                    const maxGoal = tiers[tiers.length - 1]?.min || 20
                    const progressTarget = card.nextGoal || maxGoal
                    const ringPercent = Math.max(
                      0,
                      Math.min(100, (card.progress / maxGoal) * 100)
                    )

                    return (
                      <>
                        <div className="badge-card-top">
                          <span className="badge-title">{card.title}</span>
                          {card.tier ? (
                            <span
                              className="badge-pill"
                              style={{ color: card.tier.color }}
                            >
                              {card.tier.name}
                            </span>
                          ) : (
                            <span className="badge-pill badge-pill-empty">
                              Earn it
                            </span>
                          )}
                        </div>
                        <div className="badge-chart">
                          <BadgeRing
                            progress={card.progress}
                            maxGoal={maxGoal}
                            label={`${card.title} badge progress`}
                          />

                          <div className="badge-rank-chart">
                            <div className="badge-rank-head">
                              <span className="badge-hint">
                              {card.nextGoal
                                ? `${Math.max(0, card.nextGoal - card.progress)} to next goal`
                                : 'Top goal reached'}
                              </span>
                              <strong>Goal {progressTarget}</strong>
                            </div>
                            <div className="badge-rank-bars">
                              {tiers.map((tier) => {
                                const tierPercent = Math.max(
                                  0,
                                  Math.min(100, (card.progress / tier.min) * 100)
                                )
                                const reached = card.progress >= tier.min
                                return (
                                  <div
                                    key={`${card.key}-${tier.name}`}
                                    className={`badge-rank-step ${reached ? 'reached' : ''}`}
                                  >
                                    <div className="badge-rank-label">
                                      <span>{tier.name}</span>
                                      <small>{tier.min}</small>
                                    </div>
                                    <div className="badge-rank-track">
                                      <span
                                        className="badge-rank-fill"
                                        style={{
                                          width: `${tierPercent}%`,
                                          background: reached
                                            ? tier.color
                                            : 'linear-gradient(90deg, #4281a4, #48a9a6)',
                                        }}
                                      />
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        </div>
                      </>
                    )
                  })()}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="account-drawer-toggle"
                  onClick={() => toggleDrawer('badges')}
                >
                  Hide
                </button>
              </div>
            )}
          </div>
        </section>

        <div className="account-section">
          <h3 className="account-section-title">Overall Activity</h3>
          <div className="account-activity-panel">
            <div className="activity-hero">
              <div
                className="activity-ring"
                style={{ '--activity-progress': `${activityRingPercent}%` }}
                aria-label="Distance progress"
              >
                <div className="activity-ring-inner">
                  <span>Total</span>
                  <strong>{formatDistance(totalDistance)}</strong>
                </div>
              </div>
              <div className="activity-hero-copy">
                <span className="activity-kicker">Lifetime trail log</span>
                <strong>{myTrails.length} saved routes</strong>
                <span>
                  Avg. {formatDistance(averageTrailDistance)} per trail
                </span>
              </div>
            </div>

            <div className="account-stats-row">
              <div className="account-stat">
                <span className="stat-icon stat-steps">Steps</span>
                <span className="stat-value">{totalSteps.toLocaleString()}</span>
              </div>
              <div className="account-stat">
                <span className="stat-icon stat-time">Time</span>
                <span className="stat-value">{formatTime(totalDuration)}</span>
              </div>
              <div className="account-stat">
                <span className="stat-icon stat-elevation">Elevation</span>
                <span className="stat-value">{Math.round(totalElevation)} m</span>
              </div>
            </div>

            <div className="account-activity-chart" aria-label="Activity chart">
              {activityChart.map((entry) => (
                <div className="activity-chart-row" key={entry.label}>
                  <div className="activity-chart-head">
                    <span>{entry.label}</span>
                    <strong>{entry.display}</strong>
                  </div>
                  <div className="activity-chart-track">
                    <span
                      className="activity-chart-fill"
                      style={{
                        width: `${Math.max(8, Math.min(100, (entry.value / chartMax) * 100))}%`,
                        background: entry.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <section className="account-section account-drawer">
          <h3 className="account-section-title">Offline Maps</h3>
          <div className="account-offline-box account-drawer-surface">
            <div className="account-offline-grid">
              <span>{offlineTrails.length} trails</span>
              <span>{offlineHuts.length} huts</span>
              <span>{offlinePings.length} photos/pings</span>
              <span>{offlineClusters.length + offlineEvents.length} reports/events</span>
              <span>{offlineMapPacks.length} map packs</span>
            </div>
            <div className="account-offline-summary">
              <div>
                <strong>Device:</strong>{' '}
                {offlineDeviceInfo?.name || 'this browser/app storage'}
              </div>
              {offlineMapPacks.length > 0 ? (
                <div>
                  <strong>Map packs:</strong>{' '}
                  {offlineMapPacks
                    .slice(-3)
                    .reverse()
                    .map((pack) =>
                      `${pack.name || 'Saved map'}${
                        Number(pack.cachedTiles) > 0
                          ? ` (${pack.cachedTiles} tiles)`
                          : ''
                      }`
                    )
                    .join(', ')}
                </div>
              ) : (
                <div>
                  <strong>Map packs:</strong> none saved yet
                </div>
              )}
              {offlineTrails.length > 0 ? (
                <div>
                  <strong>Recent trails:</strong>{' '}
                  {offlineTrails
                    .slice(0, 4)
                    .map((trail) => trail.name || trail.name_bg || 'Unnamed trail')
                    .join(', ')}
                </div>
              ) : null}
            </div>

            {expandedDrawers.offline ? (
              <div className="account-drawer-expand">
                <div className="account-offline-details">
                  <div className="account-offline-detail-card">
                    <span>Ready for offline route finding</span>
                    <strong>{offlineTrails.length + draftTrails.length}</strong>
                    <small>saved trails and local drafts</small>
                  </div>
                  <div className="account-offline-detail-card">
                    <span>Field references</span>
                    <strong>{offlineHuts.length + offlinePings.length}</strong>
                    <small>huts, photos, and map notes</small>
                  </div>
                  <div className="account-offline-detail-card">
                    <span>Community updates</span>
                    <strong>{offlineClusters.length + offlineEvents.length}</strong>
                    <small>reports and event markers</small>
                  </div>
                </div>
                <div className="account-offline-list">
                  <strong>Saved map packs</strong>
                  {offlineMapPacks.length > 0 ? (
                    offlineMapPacks
                      .slice()
                      .reverse()
                      .map((pack, index) => (
                        <span key={`${pack.id || pack.name || 'pack'}-${index}`}>
                          {pack.name || 'Saved map'} · {Number(pack.cachedTiles || 0)} tiles
                        </span>
                      ))
                  ) : (
                    <span>No map packs downloaded yet.</span>
                  )}
                </div>
              </div>
            ) : null}

            <div className="account-offline-actions">
              <button
                type="button"
                className="account-btn account-btn-primary"
                onClick={() => setOfflineModalOpen(true)}
              >
                Manage offline downloads
              </button>
              <button
                type="button"
                className="account-btn account-btn-secondary"
                onClick={async () => {
                  await clearAll()
                  await clearOfflineMapData()
                }}
              >
                Clear map data
              </button>
            </div>
            <button
              type="button"
              className="account-drawer-toggle"
              onClick={() => toggleDrawer('offline')}
            >
              {expandedDrawers.offline ? 'Hide' : 'Show all'}
            </button>
          </div>
        </section>

        <section className="account-section account-drawer">
          <h3 className="account-section-title">Local Trail Drafts</h3>
          {draftError ? (
            <div className="account-badges-box" style={{ color: '#fca5a5' }}>
              {draftError}
            </div>
          ) : null}
          <div className="account-drawer-surface">
            {!expandedDrawers.drafts ? (
              <>
                {draftTrails.length > 0 ? (
                  <div className="account-trail-carousel">
                    {draftTrails.map((trail) => (
                      <TrailCarouselCard
                        key={trail.localId}
                        trail={trail}
                        type="draft"
                        publishingDraftId={publishingDraftId}
                        onOpenDraft={handleOpenDraftOnMap}
                        onPublishDraft={handlePublishDraft}
                        onDiscardDraft={handleDiscardDraft}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="account-badges-box">
                    No local recorded trails waiting to publish.
                  </div>
                )}
                <button
                  type="button"
                  className="account-drawer-toggle"
                  onClick={() => toggleDrawer('drafts')}
                >
                  Show all
                </button>
              </>
            ) : (
              <div className="account-drawer-expand">
          <div className="my-trails-list">
            {draftTrails.length > 0 ? (
              draftTrails.map((trail) => (
                <div key={trail.localId} className="my-trail-item my-trail-draft">
                  <div className="my-trail-info">
                    <span className="my-trail-name">{trail.name}</span>
                    <span className="my-trail-meta">
                      Saved on device · {trail.difficulty || 'moderate'} ·{' '}
                      {trail.region || 'No region'}
                    </span>
                  </div>
                  <AccountTrailMap trail={trail} />
                  <TrailStatsStrip trail={trail} />
                  {Array.isArray(trail.trailMarks) && trail.trailMarks.length > 0 ? (
                    <div className="account-trail-mark-row">
                      {trail.trailMarks.map((segment, index) => (
                        <span
                          key={`${trail.localId}-mark-${index}`}
                          className="account-trail-mark-chip"
                        >
                          <i
                            style={{
                              background:
                                TRAIL_MARK_COLORS[segment.colourType] ||
                                TRAIL_MARK_COLORS.unmarked,
                            }}
                          />
                          {segment.name || `Sector ${index + 1}`}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="my-trail-actions">
                    <button
                      className="my-trail-save-btn"
                      onClick={() => handleOpenDraftOnMap(trail)}
                      disabled={publishingDraftId === trail.localId}
                    >
                      Open / Start
                    </button>
                    <button
                      className="my-trail-save-btn"
                      onClick={() => handlePublishDraft(trail)}
                      disabled={publishingDraftId === trail.localId}
                    >
                      {publishingDraftId === trail.localId
                        ? 'Publishing...'
                        : 'Publish'}
                    </button>
                    <button
                      className="my-trail-delete-btn"
                      onClick={() => handleDiscardDraft(trail.localId)}
                      disabled={publishingDraftId === trail.localId}
                    >
                      Discard
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="account-badges-box">
                No local recorded trails waiting to publish.
              </div>
            )}
          </div>
                <button
                  type="button"
                  className="account-drawer-toggle"
                  onClick={() => toggleDrawer('drafts')}
                >
                  Hide
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="account-section account-drawer">
          <h3 className="account-section-title">Published Trails</h3>
          <div className="account-drawer-surface">
            {!expandedDrawers.published ? (
              <>
                {myTrails.length > 0 ? (
                  <div className="account-trail-carousel">
                    {myTrails.map((trail) => (
                      <TrailCarouselCard
                        key={trail._id}
                        trail={trail}
                        type="published"
                        onOpenTrail={handleOpenPublishedOnMap}
                        onEditTrail={handleEditOpen}
                        onDeleteTrail={handleDeleteTrail}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="account-badges-box">
                    No trails loaded from the backend yet.
                  </div>
                )}
                <button
                  type="button"
                  className="account-drawer-toggle"
                  onClick={() => toggleDrawer('published')}
                >
                  Show all
                </button>
              </>
            ) : (
              <div className="account-drawer-expand">
          <div className="my-trails-list">
            {myTrails.length > 0 ? (
              myTrails.map((trail) => (
                <div key={trail._id} className="my-trail-item">
                  {editingTrail === trail._id ? (
                    <div className="my-trail-edit-form">
                      <label className="rbf-label">Name</label>
                      <input
                        className="rbf-input"
                        value={editForm.name}
                        onChange={(e) =>
                          setEditForm({ ...editForm, name: e.target.value })
                        }
                        placeholder="Trail name"
                      />
                      <label className="rbf-label">Region</label>
                      <input
                        className="rbf-input"
                        value={editForm.region}
                        onChange={(e) =>
                          setEditForm({ ...editForm, region: e.target.value })
                        }
                        placeholder="Region"
                      />
                      <label className="rbf-label">Difficulty</label>
                      <select
                        className="rbf-input"
                        value={editForm.difficulty}
                        onChange={(e) =>
                          setEditForm({
                            ...editForm,
                            difficulty: e.target.value,
                          })
                        }
                      >
                        <option value="easy">Easy</option>
                        <option value="moderate">Moderate</option>
                        <option value="hard">Hard</option>
                        <option value="extreme">Extreme</option>
                      </select>
                      <label className="rbf-label">Description</label>
                      <textarea
                        className="rbf-input"
                        value={editForm.description}
                        onChange={(e) =>
                          setEditForm({
                            ...editForm,
                            description: e.target.value,
                          })
                        }
                        placeholder="Description"
                        rows={2}
                      />
                      <label className="rbf-label">Equipment</label>
                      <input
                        className="rbf-input"
                        value={editForm.equipment}
                        onChange={(e) =>
                          setEditForm({
                            ...editForm,
                            equipment: e.target.value,
                          })
                        }
                        placeholder="Equipment"
                      />
                      <label className="rbf-label">Resources</label>
                      <input
                        className="rbf-input"
                        value={editForm.resources}
                        onChange={(e) =>
                          setEditForm({
                            ...editForm,
                            resources: e.target.value,
                          })
                        }
                        placeholder="Resources"
                      />

                      <div className="my-trail-mark-head">
                        <label className="rbf-label">Trail Marks</label>
                        <button
                          type="button"
                          className="my-trail-edit-btn"
                          onClick={handleAddTrailMark}
                        >
                          Add mark
                        </button>
                      </div>

                      {Array.isArray(editForm.trailMarks) &&
                      editForm.trailMarks.length > 0 ? (
                        <div className="my-trail-mark-list">
                          {editForm.trailMarks.map((segment, index) => (
                            <div key={`trail-mark-${index}`} className="my-trail-mark-item">
                              <input
                                className="rbf-input"
                                value={segment.name || ''}
                                onChange={(e) =>
                                  handleTrailMarkChange(index, 'name', e.target.value)
                                }
                                placeholder="Sector name"
                              />

                              <div className="my-trail-mark-grid">
                                <select
                                  className="rbf-input"
                                  value={segment.colourType || 'red'}
                                  onChange={(e) =>
                                    handleTrailMarkChange(
                                      index,
                                      'colourType',
                                      e.target.value
                                    )
                                  }
                                >
                                  {TRAIL_MARK_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>

                                <input
                                  className="rbf-input"
                                  type="number"
                                  min={0}
                                  max={Math.max(0, Number(editForm.maxPointIndex || 0))}
                                  value={Number.isFinite(segment.startIndex) ? segment.startIndex : 0}
                                  onChange={(e) =>
                                    handleTrailMarkChange(
                                      index,
                                      'startIndex',
                                      e.target.value
                                    )
                                  }
                                  placeholder="Start"
                                />

                                <input
                                  className="rbf-input"
                                  type="number"
                                  min={0}
                                  max={Math.max(0, Number(editForm.maxPointIndex || 0))}
                                  value={Number.isFinite(segment.endIndex) ? segment.endIndex : 0}
                                  onChange={(e) =>
                                    handleTrailMarkChange(
                                      index,
                                      'endIndex',
                                      e.target.value
                                    )
                                  }
                                  placeholder="End"
                                />

                                <button
                                  type="button"
                                  className="my-trail-delete-btn"
                                  onClick={() => handleRemoveTrailMark(index)}
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="my-trail-mark-empty">
                          No mark sectors for this trail.
                        </p>
                      )}

                      <div className="my-trail-edit-actions">
                        <button
                          className="my-trail-save-btn"
                          onClick={handleEditSave}
                          disabled={editSaving}
                        >
                          {editSaving ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          className="my-trail-cancel-btn"
                          onClick={() => setEditingTrail(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="my-trail-info">
                        <span className="my-trail-name">{trail.name}</span>
                        <span className="my-trail-meta">
                          {trail.difficulty} · {trail.region || 'No region'}
                        </span>
                      </div>
                      <AccountTrailMap trail={trail} />
                      <TrailStatsStrip trail={trail} />
                      {Array.isArray(trail.trailMarks) && trail.trailMarks.length > 0 ? (
                        <div className="account-trail-mark-row">
                          {trail.trailMarks.map((segment, index) => (
                            <span
                              key={`${trail._id}-mark-${index}`}
                              className="account-trail-mark-chip"
                            >
                              <i
                                style={{
                                  background:
                                    TRAIL_MARK_COLORS[segment.colourType] ||
                                    TRAIL_MARK_COLORS.unmarked,
                                }}
                              />
                              {segment.name || `Sector ${index + 1}`}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <div className="my-trail-actions">
                        <button
                          className="my-trail-edit-btn"
                          onClick={() => handleEditOpen(trail)}
                        >
                          Edit
                        </button>
                        <button
                          className="my-trail-delete-btn"
                          onClick={() => handleDeleteTrail(trail._id)}
                        >
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))
            ) : (
              <div className="account-badges-box">
                No trails loaded from the backend yet.
              </div>
            )}
          </div>
                <button
                  type="button"
                  className="account-drawer-toggle"
                  onClick={() => toggleDrawer('published')}
                >
                  Hide
                </button>
              </div>
            )}
          </div>
        </section>

        <div className="account-actions">
          <button className="account-btn-settings" onClick={handleOpenProfile}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Settings
          </button>

          <button
            className="account-btn-signout"
            onClick={() => setShowLogoutConfirm(true)}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Sign out
          </button>

          <button
            className="account-btn-delete"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
            Delete account
          </button>
        </div>
      </div>

      {showLogoutConfirm && (
        <div
          className="confirm-overlay"
          onClick={() => setShowLogoutConfirm(false)}
        >
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <p>Are you sure you want to sign out?</p>
            <div className="confirm-buttons">
              <button className="confirm-yes" onClick={handleLogout}>
                Yes, sign out
              </button>
              <button
                className="confirm-no"
                onClick={() => setShowLogoutConfirm(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div
          className="confirm-overlay"
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div
            className="confirm-dialog confirm-dialog-danger"
            onClick={(e) => e.stopPropagation()}
          >
            <p>
              Are you sure you want to delete your account? This action cannot
              be undone.
            </p>
            <div className="confirm-buttons">
              <button className="confirm-danger" onClick={handleDeleteAccount}>
                Delete account
              </button>
              <button
                className="confirm-no"
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <OfflineMapModal
        isOpen={offlineModalOpen}
        onClose={() => setOfflineModalOpen(false)}
        mode="account"
      />

      <BottomNav />
    </div>
  )
}
