import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Map, { Layer, Marker, Source } from 'react-map-gl/mapbox'
import { lineString, nearestPointOnLine, point as turfPoint } from '@turf/turf'
import { publishTrail } from '../../api/trails'
import './RouteBuilderForm.css'

const DIFFICULTY_OPTIONS = [
  { value: 'easy', label: 'Easy' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'hard', label: 'Hard' },
  { value: 'extreme', label: 'Extreme' },
]

const TRAIL_MARK_OPTIONS = [
  { value: 'red', label: 'Red', color: '#ef4444' },
  { value: 'blue', label: 'Blue', color: '#3b82f6' },
  { value: 'green', label: 'Green', color: '#22c55e' },
  { value: 'yellow', label: 'Yellow', color: '#eab308' },
  { value: 'white', label: 'White', color: '#e2e8f0' },
  { value: 'black', label: 'Black', color: '#0f172a' },
  { value: 'unmarked', label: 'Unmarked', color: '#6b7280' },
]

const TRAIL_MARK_COLORS = TRAIL_MARK_OPTIONS.reduce((acc, entry) => {
  acc[entry.value] = entry.color
  return acc
}, {})

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN
const MAPBOX_STYLE_URL =
  import.meta.env.VITE_MAPBOX_STYLE_URL || 'mapbox://styles/mapbox/outdoors-v12'

function parseLineCoordinates(geojson) {
  if (!geojson || typeof geojson !== 'object') return []

  if (geojson.type === 'LineString') {
    return Array.isArray(geojson.coordinates)
      ? geojson.coordinates
          .map((point) => [Number(point?.[0]), Number(point?.[1])])
          .filter(
            (point) => Number.isFinite(point[0]) && Number.isFinite(point[1])
          )
      : []
  }

  if (geojson.type === 'MultiLineString') {
    return Array.isArray(geojson.coordinates)
      ? geojson.coordinates
          .flatMap((line) => (Array.isArray(line) ? line : []))
          .map((point) => [Number(point?.[0]), Number(point?.[1])])
          .filter(
            (point) => Number.isFinite(point[0]) && Number.isFinite(point[1])
          )
      : []
  }

  if (geojson.type === 'Feature') {
    return parseLineCoordinates(geojson.geometry)
  }

  if (geojson.type === 'FeatureCollection') {
    return Array.isArray(geojson.features)
      ? geojson.features.flatMap((feature) =>
          parseLineCoordinates(feature?.geometry)
        )
      : []
  }

  return []
}

function buildTrailMarkFeatureCollection(pathCoordinates, trailMarks) {
  if (!Array.isArray(pathCoordinates) || pathCoordinates.length < 2) return null
  if (!Array.isArray(trailMarks) || !trailMarks.length) return null

  const maxIndex = pathCoordinates.length - 1
  const features = trailMarks
    .map((segment, index) => {
      const startIndex = Math.max(
        0,
        Math.min(maxIndex, Number(segment?.startIndex || 0))
      )
      const endIndex = Math.max(
        startIndex,
        Math.min(maxIndex, Number(segment?.endIndex || maxIndex))
      )

      const coordinates = pathCoordinates.slice(startIndex, endIndex + 1)
      if (coordinates.length < 2) return null

      return {
        type: 'Feature',
        properties: {
          id: String(index),
          name: String(segment?.name || `Sector ${index + 1}`),
          colour_type: String(segment?.colourType || 'unmarked'),
        },
        geometry: {
          type: 'LineString',
          coordinates,
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

function findNearestRoutePointIndex(pathCoordinates, longitude, latitude) {
  try {
    const snapped = nearestPointOnLine(
      lineString(pathCoordinates),
      turfPoint([longitude, latitude]),
      { units: 'meters' }
    )
    const nearestIndex = Number(snapped?.properties?.index)
    if (Number.isFinite(nearestIndex)) {
      return Math.max(
        0,
        Math.min(pathCoordinates.length - 1, Math.round(nearestIndex))
      )
    }
  } catch {
    // Use direct distance fallback when turf snapping fails.
  }

  let index = 0
  let minDistanceSq = Infinity
  for (let i = 0; i < pathCoordinates.length; i += 1) {
    const candidate = pathCoordinates[i]
    const dLon = Number(candidate[0]) - Number(longitude)
    const dLat = Number(candidate[1]) - Number(latitude)
    const distSq = dLon * dLon + dLat * dLat
    if (distSq < minDistanceSq) {
      minDistanceSq = distSq
      index = i
    }
  }

  return index
}

export default function RouteBuilderForm({
  geojson,
  onSuccess,
  onCancel,
  publishOnSubmit = true,
  title = 'Publish Trail',
  submitLabel,
  initialValues = {},
  storageKey,
}) {
  const [name, setName] = useState(() => initialValues.name || '')
  const [region, setRegion] = useState(() => initialValues.region || '')
  const [difficulty, setDifficulty] = useState(
    () => initialValues.difficulty || 'moderate'
  )
  const [description, setDescription] = useState(
    () => initialValues.description || ''
  )
  const [equipment, setEquipment] = useState(
    () => initialValues.equipment || ''
  )
  const [resources, setResources] = useState(
    () => initialValues.resources || ''
  )
  const [trailMarks, setTrailMarks] = useState(() =>
    Array.isArray(initialValues.trailMarks) ? initialValues.trailMarks : []
  )
  const [markEditorOpen, setMarkEditorOpen] = useState(false)
  const [markDraft, setMarkDraft] = useState([])
  const [selectedMarkColor, setSelectedMarkColor] = useState('red')
  const [pendingStartIndex, setPendingStartIndex] = useState(null)
  const [markEditorError, setMarkEditorError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const pathCoordinates = useMemo(() => parseLineCoordinates(geojson), [geojson])
  const autosaveLoadedRef = useRef(false)

  const formStorageKey = useMemo(() => {
    if (storageKey) return storageKey
    const first = pathCoordinates[0] || []
    const last = pathCoordinates[pathCoordinates.length - 1] || []
    return [
      'pytechka.route-form',
      title,
      pathCoordinates.length,
      Number(first[0] || 0).toFixed(5),
      Number(first[1] || 0).toFixed(5),
      Number(last[0] || 0).toFixed(5),
      Number(last[1] || 0).toFixed(5),
    ].join(':')
  }, [pathCoordinates, storageKey, title])

  useEffect(() => {
    if (autosaveLoadedRef.current || typeof window === 'undefined') return
    autosaveLoadedRef.current = true
    try {
      const raw = window.localStorage.getItem(formStorageKey)
      const saved = raw ? JSON.parse(raw) : null
      if (!saved || typeof saved !== 'object') return
      setName(saved.name ?? name)
      setRegion(saved.region ?? region)
      setDifficulty(saved.difficulty ?? difficulty)
      setDescription(saved.description ?? description)
      setEquipment(saved.equipment ?? equipment)
      setResources(saved.resources ?? resources)
      if (Array.isArray(saved.trailMarks)) setTrailMarks(saved.trailMarks)
    } catch {
      /* Autosave restore is best-effort. */
    }
  }, [description, difficulty, equipment, formStorageKey, name, region, resources])

  useEffect(() => {
    if (!autosaveLoadedRef.current || typeof window === 'undefined') return
    try {
      window.localStorage.setItem(
        formStorageKey,
        JSON.stringify({
          name,
          region,
          difficulty,
          description,
          equipment,
          resources,
          trailMarks,
          savedAt: new Date().toISOString(),
        })
      )
    } catch {
      /* Autosave is best-effort. */
    }
  }, [
    description,
    difficulty,
    equipment,
    formStorageKey,
    name,
    region,
    resources,
    trailMarks,
  ])

  const routeFeatureCollection = useMemo(() => {
    if (!Array.isArray(pathCoordinates) || pathCoordinates.length < 2) return null

    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: pathCoordinates,
          },
        },
      ],
    }
  }, [pathCoordinates])

  const markPreviewFeatureCollection = useMemo(
    () => buildTrailMarkFeatureCollection(pathCoordinates, markDraft),
    [pathCoordinates, markDraft]
  )

  const initialMapView = useMemo(() => {
    const first = pathCoordinates[0]
    return {
      longitude: Number(first?.[0] || 25.2),
      latitude: Number(first?.[1] || 42.7),
      zoom: 16.2,
    }
  }, [pathCoordinates])

  const [markMapView, setMarkMapView] = useState(initialMapView)

  const normalizeTrailMarksForSave = (segments) => {
    const maxIndex = Math.max(0, pathCoordinates.length - 1)

    return (Array.isArray(segments) ? segments : [])
      .map((segment, index) => {
        const colourType = String(segment?.colourType || '').toLowerCase()
        if (!TRAIL_MARK_COLORS[colourType]) return null

        const startIndex = Math.max(
          0,
          Math.min(maxIndex, Number(segment?.startIndex || 0))
        )
        const endIndex = Math.max(
          startIndex,
          Math.min(maxIndex, Number(segment?.endIndex || maxIndex))
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

  const openMarkEditor = () => {
    setMarkDraft(normalizeTrailMarksForSave(trailMarks))
    setMarkEditorOpen(true)
    setPendingStartIndex(null)
    setMarkEditorError('')
    setMarkMapView(initialMapView)
  }

  const closeMarkEditor = () => {
    setMarkEditorOpen(false)
    setPendingStartIndex(null)
    setMarkEditorError('')
  }

  const saveMarksFromEditor = () => {
    setTrailMarks(normalizeTrailMarksForSave(markDraft))
    closeMarkEditor()
  }

  const handleMarkMapClick = (event) => {
    if (!Array.isArray(pathCoordinates) || pathCoordinates.length < 2) {
      setMarkEditorError('Route geometry is not valid for mark splitting.')
      return
    }

    const clickedIndex = findNearestRoutePointIndex(
      pathCoordinates,
      event.lngLat.lng,
      event.lngLat.lat
    )

    if (pendingStartIndex == null) {
      setPendingStartIndex(clickedIndex)
      setMarkEditorError('')
      return
    }

    const startIndex = Math.min(pendingStartIndex, clickedIndex)
    const endIndex = Math.max(pendingStartIndex, clickedIndex)
    if (endIndex - startIndex < 1) {
      setMarkEditorError('Pick a second point farther on the trail.')
      return
    }

    const option =
      TRAIL_MARK_OPTIONS.find((entry) => entry.value === selectedMarkColor) ||
      TRAIL_MARK_OPTIONS[0]
    const sameColorCount = markDraft.filter(
      (entry) => String(entry.colourType) === selectedMarkColor
    ).length

    setMarkDraft((prev) =>
      normalizeTrailMarksForSave([
        ...prev,
        {
          name: `${option.label} sector ${sameColorCount + 1}`,
          description: '',
          colourType: selectedMarkColor,
          startIndex,
          endIndex,
        },
      ])
    )
    setPendingStartIndex(null)
    setMarkEditorError('')
  }

  const removeDraftMark = (index) => {
    setMarkDraft((prev) => prev.filter((_, idx) => idx !== index))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Trail name is required')
      return
    }
    setSubmitting(true)
    setError('')

    try {
      const payload = {
        geojson,
        name: name.trim(),
        region: region.trim(),
        difficulty,
        description: description.trim(),
        equipment: equipment.trim(),
        resources: resources.trim(),
        stats: initialValues.stats,
        trailMarks: normalizeTrailMarksForSave(trailMarks),
      }

      if (publishOnSubmit) {
        const res = await publishTrail(payload)
        window.localStorage?.removeItem(formStorageKey)
        onSuccess?.(res.data)
      } else {
        window.localStorage?.removeItem(formStorageKey)
        onSuccess?.(payload)
      }
    } catch (err) {
      setError(
        err.response?.data?.error ||
          (publishOnSubmit
            ? 'Failed to publish trail. Please try again.'
            : 'Failed to save trail locally. Please try again.')
      )
    } finally {
      setSubmitting(false)
    }
  }

  const formContent = (
    <div className="rbf-overlay" onClick={onCancel}>
      <div className="rbf-panel" onClick={(e) => e.stopPropagation()}>
        <div className="rbf-header">
          <h2 className="rbf-title">{title}</h2>
          <button className="rbf-close-btn" onClick={onCancel} aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form className="rbf-form" onSubmit={handleSubmit}>
          <label className="rbf-field">
            <span className="rbf-label">Trail Name *</span>
            <input
              className="rbf-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Musala Peak Trail"
              maxLength={120}
            />
          </label>

          <label className="rbf-field">
            <span className="rbf-label">Region</span>
            <input
              className="rbf-input"
              type="text"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder="e.g. Rila, Pirin, Rhodopes"
              maxLength={100}
            />
          </label>

          <label className="rbf-field">
            <span className="rbf-label">Difficulty</span>
            <select
              className="rbf-select"
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
            >
              {DIFFICULTY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="rbf-field">
            <span className="rbf-label">Description</span>
            <textarea
              className="rbf-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the trail, notable landmarks, scenery..."
              rows={3}
              maxLength={2000}
            />
          </label>

          <label className="rbf-field">
            <span className="rbf-label">Equipment</span>
            <textarea
              className="rbf-textarea"
              value={equipment}
              onChange={(e) => setEquipment(e.target.value)}
              placeholder="Recommended gear: hiking boots, poles, rain jacket..."
              rows={2}
              maxLength={1000}
            />
          </label>

          <label className="rbf-field">
            <span className="rbf-label">Resources</span>
            <textarea
              className="rbf-textarea"
              value={resources}
              onChange={(e) => setResources(e.target.value)}
              placeholder="Water sources, huts, shelters, phone signal..."
              rows={2}
              maxLength={1000}
            />
          </label>

          <section className="rbf-marks-section">
            <div className="rbf-marks-head">
              <span className="rbf-label">Trail Marks</span>
              <button
                type="button"
                className="rbf-mark-editor-btn"
                onClick={openMarkEditor}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="4" y1="6" x2="20" y2="6" />
                  <line x1="4" y1="12" x2="20" y2="12" />
                  <line x1="4" y1="18" x2="20" y2="18" />
                </svg>
                Split Trail On Marks
              </button>
            </div>
            <p className="rbf-marks-help">
              Split your trail into color-marked sectors by clicking two points
              on the route.
            </p>
            <p className="rbf-marks-count">
              {trailMarks.length} mark sector{trailMarks.length === 1 ? '' : 's'}
            </p>
            {trailMarks.length > 0 ? (
              <div className="rbf-marks-list">
                {trailMarks.map((segment, index) => {
                  const color =
                    TRAIL_MARK_COLORS[String(segment.colourType || 'unmarked')] ||
                    TRAIL_MARK_COLORS.unmarked

                  return (
                    <div className="rbf-mark-pill" key={`${segment.name}-${index}`}>
                      <span
                        className="rbf-mark-pill-color"
                        style={{ background: color }}
                      />
                      <span className="rbf-mark-pill-text">
                        {segment.name} ({segment.startIndex}-{segment.endIndex})
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : null}
          </section>

          {error && <p className="rbf-error">{error}</p>}

          <div className="rbf-actions">
            <button
              type="button"
              className="rbf-btn rbf-btn-cancel"
              onClick={onCancel}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rbf-btn rbf-btn-publish"
              disabled={submitting}
            >
              {submitting
                ? publishOnSubmit
                  ? 'Publishing...'
                  : 'Saving...'
                : submitLabel || (publishOnSubmit ? 'Publish' : 'Save locally')}
            </button>
          </div>
        </form>
      </div>

      {markEditorOpen ? createPortal(
        <div className="rbf-mark-editor-overlay" onClick={closeMarkEditor}>
            <div
              className="rbf-mark-editor-panel"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="rbf-mark-editor-top">
                <div className="rbf-mark-editor-heading">
                  <h3 className="rbf-mark-editor-title">Trail Mark Split</h3>
                  <p className="rbf-mark-editor-subtitle">
                    Choose a trail color, then click the first and last point of
                    that marked sector.
                  </p>
                </div>
                <div className="rbf-mark-editor-actions">
                  <button
                    type="button"
                    className="rbf-btn rbf-btn-cancel"
                    onClick={closeMarkEditor}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    className="rbf-btn rbf-btn-publish"
                    onClick={saveMarksFromEditor}
                  >
                    Save Marks
                  </button>
                </div>
              </div>

              {markEditorError ? (
                <p className="rbf-error">{markEditorError}</p>
              ) : null}

              <div className="rbf-mark-workspace">
                <div className="rbf-mark-map-column">
                  {MAPBOX_TOKEN && routeFeatureCollection ? (
                    <div className="rbf-mark-map-shell">
                      <Map
                        {...markMapView}
                        onMove={(event) => setMarkMapView(event.viewState)}
                        onClick={handleMarkMapClick}
                        onLoad={(event) => event.target.resize()}
                        mapboxAccessToken={MAPBOX_TOKEN}
                        mapStyle={MAPBOX_STYLE_URL}
                        style={{ width: '100%', height: '100%' }}
                        attributionControl={false}
                      >
                        <Source
                          id="rbf-mark-route-source"
                          type="geojson"
                          data={routeFeatureCollection}
                        >
                          <Layer
                            id="rbf-mark-route-shadow"
                            type="line"
                            layout={{
                              'line-cap': 'round',
                              'line-join': 'round',
                            }}
                            paint={{
                              'line-color': '#020617',
                              'line-width': 10,
                              'line-opacity': 0.62,
                            }}
                          />
                          <Layer
                            id="rbf-mark-route-base"
                            type="line"
                            layout={{
                              'line-cap': 'round',
                              'line-join': 'round',
                            }}
                            paint={{
                              'line-color': '#7dd3fc',
                              'line-width': 6,
                              'line-opacity': 0.96,
                            }}
                          />
                        </Source>

                        {markPreviewFeatureCollection ? (
                      <Source
                        id="rbf-mark-segments-source"
                        type="geojson"
                        data={markPreviewFeatureCollection}
                      >
                        <Layer
                          id="rbf-mark-segments-layer"
                          type="line"
                          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                          paint={{
                            'line-color': [
                              'match',
                              ['get', 'colour_type'],
                              'red',
                              TRAIL_MARK_COLORS.red,
                              'blue',
                              TRAIL_MARK_COLORS.blue,
                              'green',
                              TRAIL_MARK_COLORS.green,
                              'yellow',
                              TRAIL_MARK_COLORS.yellow,
                              'white',
                              TRAIL_MARK_COLORS.white,
                              'black',
                              TRAIL_MARK_COLORS.black,
                              TRAIL_MARK_COLORS.unmarked,
                            ],
                            'line-width': 8,
                            'line-opacity': 0.98,
                          }}
                        />
                      </Source>
                        ) : null}

                        {pathCoordinates[0] ? (
                          <Marker
                            longitude={Number(pathCoordinates[0][0])}
                            latitude={Number(pathCoordinates[0][1])}
                            anchor="center"
                          >
                            <div className="rbf-route-endpoint rbf-route-start">
                              Start
                            </div>
                          </Marker>
                        ) : null}

                        {pathCoordinates[pathCoordinates.length - 1] ? (
                          <Marker
                            longitude={Number(
                              pathCoordinates[pathCoordinates.length - 1][0]
                            )}
                            latitude={Number(
                              pathCoordinates[pathCoordinates.length - 1][1]
                            )}
                            anchor="center"
                          >
                            <div className="rbf-route-endpoint rbf-route-end">
                              End
                            </div>
                          </Marker>
                        ) : null}

                        {pendingStartIndex != null &&
                        pathCoordinates[pendingStartIndex] ? (
                          <Marker
                            longitude={Number(
                              pathCoordinates[pendingStartIndex][0]
                            )}
                            latitude={Number(
                              pathCoordinates[pendingStartIndex][1]
                            )}
                            anchor="center"
                          >
                            <div className="rbf-mark-pending-marker">S</div>
                          </Marker>
                        ) : null}
                      </Map>
                    </div>
                  ) : (
                    <div className="rbf-mark-editor-fallback">
                      {!MAPBOX_TOKEN
                        ? 'Map is unavailable. Set VITE_MAPBOX_TOKEN to use click-to-split trail marks.'
                        : 'Route does not have enough coordinates to split into marks. Record a longer trail.'}
                    </div>
                  )}

                  <div className="rbf-mark-editor-help">
                    {pendingStartIndex != null
                      ? `Start index ${pendingStartIndex} selected. Click the sector end point.`
                      : 'Click the trail near the beginning of a marked sector.'}
                  </div>
                </div>

                <aside className="rbf-mark-side-panel">
                  <div className="rbf-mark-side-section">
                    <span className="rbf-mark-side-label">Mark color</span>
                    <div className="rbf-mark-legend">
                      {TRAIL_MARK_OPTIONS.map((entry) => (
                        <button
                          key={entry.value}
                          type="button"
                          className={`rbf-mark-color-btn ${
                            selectedMarkColor === entry.value ? 'active' : ''
                          }`}
                          onClick={() => setSelectedMarkColor(entry.value)}
                        >
                          <span
                            className="rbf-mark-color-dot"
                            style={{ background: entry.color }}
                          />
                          {entry.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rbf-mark-side-section">
                    <span className="rbf-mark-side-label">Sectors</span>
                    <div className="rbf-mark-editor-list">
                      {markDraft.length ? (
                        markDraft.map((segment, index) => (
                          <div
                            className="rbf-mark-editor-item"
                            key={`${segment.name}-${index}`}
                          >
                            <div className="rbf-mark-editor-item-main">
                              <span
                                className="rbf-mark-pill-color"
                                style={{
                                  background:
                                    TRAIL_MARK_COLORS[
                                      String(segment.colourType || 'unmarked')
                                    ] || TRAIL_MARK_COLORS.unmarked,
                                }}
                              />
                              <span>
                                {segment.name}
                                <small>
                                  {segment.startIndex}-{segment.endIndex}
                                </small>
                              </span>
                            </div>
                            <button
                              type="button"
                              className="rbf-mark-remove-btn"
                              onClick={() => removeDraftMark(index)}
                            >
                              Remove
                            </button>
                          </div>
                        ))
                      ) : (
                        <p className="rbf-mark-empty">
                          No sectors yet. Click two points on the route.
                        </p>
                      )}
                    </div>
                  </div>
                </aside>
              </div>
            </div>
          </div>,
        document.body
      ) : null}
    </div>
  )

  return createPortal(formContent, document.body)
}
