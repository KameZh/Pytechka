import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Map, { Layer, Marker, Source } from 'react-map-gl/mapbox'
import 'mapbox-gl/dist/mapbox-gl.css'
import {
  booleanPointInPolygon,
  center as turfCenter,
  circle as turfCircle,
} from '@turf/turf'
import BottomNav from '../components/layout/Bottomnav'
import TrailCard from '../components/explore/TrailCard'
import TrailDetailPopup from '../components/explore/TrailDetailPopup'
import {
  FILTER_DEFAULTS,
  buildExploreFilterOptions,
} from '../components/data/Explorerdata'
import { fetchTrails } from '../api/trails'
import { fetchMapTrailsGeojson } from '../api/maps'
import TrailMapLayers from '../components/map/TrailMapLayers'
import {
  EMPTY_TRAIL_FEATURE_COLLECTION,
  getInteractiveTrailLayerIds,
  normalizeTrailGeojsonCollection,
} from '../components/map/trailMapLayerUtils'
import { buildCenteredView } from '../utils/mapDefaults'
import { getSearchSuggestions } from '../utils/searchSuggestions'

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

const INITIAL_REGION_VIEW = buildCenteredView(6.6)
const TRAIL_VISIBILITY_MIN_ZOOM = 6
const TRAIL_LIST_BATCH = 48
const EXPLORE_TRAIL_LAYER_PREFIX = 'explore-trails'
const EXPLORE_INTERACTIVE_TRAIL_LAYER_IDS = getInteractiveTrailLayerIds(
  EXPLORE_TRAIL_LAYER_PREFIX
)

const EXPLORE_FALLBACK_TERMS = [
  'Hiking',
  'Running',
  'Forest',
  'Waterfall',
  'Mountain',
]

function SectionBlock({ title, subtitle, children }) {
  return (
    <section className="explore-section reveal-up">
      <header className="explore-section-head">
        <h2 className="explore-section-title">{title}</h2>
        {subtitle ? (
          <p className="explore-section-subtitle">{subtitle}</p>
        ) : null}
      </header>
      {children}
    </section>
  )
}

function getTrailCenterPoint(trail) {
  const storedCenter = Array.isArray(trail?.stats?.centerCoordinates)
    ? trail.stats.centerCoordinates
    : Array.isArray(trail?.centerCoordinates)
      ? trail.centerCoordinates
      : null

  if (storedCenter && storedCenter.length === 2) {
    const [longitude, latitude] = storedCenter.map(Number)
    if (Number.isFinite(longitude) && Number.isFinite(latitude)) {
      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [longitude, latitude],
        },
        properties: {},
      }
    }
  }

  if (!trail?.geojson) return null

  try {
    const parsed =
      typeof trail.geojson === 'string'
        ? JSON.parse(trail.geojson)
        : trail.geojson
    if (!parsed || typeof parsed !== 'object' || !parsed.type) return null

    const centered = turfCenter(parsed)
    if (!centered?.geometry?.coordinates) return null

    const [longitude, latitude] = centered.geometry.coordinates
    return {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [longitude, latitude],
      },
      properties: {},
    }
  } catch {
    return null
  }
}

export default function Explore() {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeActivity, setActiveActivity] = useState(FILTER_DEFAULTS.activity)
  const [activeDifficulty, setActiveDifficulty] = useState(
    FILTER_DEFAULTS.difficulty
  )
  const [activeSort, setActiveSort] = useState(FILTER_DEFAULTS.sort)
  const [officialOnly, setOfficialOnly] = useState(false)
  const [unmarkedOnly, setUnmarkedOnly] = useState(false)
  const [regionMapView, setRegionMapView] = useState(INITIAL_REGION_VIEW)
  const [selectedAreaCenter, setSelectedAreaCenter] = useState(null)
  const [selectedAreaRadiusKm, setSelectedAreaRadiusKm] = useState(8)

  const [trails, setTrails] = useState([])
  const [trailsGeojson, setTrailsGeojson] = useState(
    EMPTY_TRAIL_FEATURE_COLLECTION
  )
  const [loadingTrails, setLoadingTrails] = useState(false)
  const [loadingMapTrails, setLoadingMapTrails] = useState(false)
  const [errorTrails, setErrorTrails] = useState(null)
  const [errorMapTrails, setErrorMapTrails] = useState(null)
  const [selectedTrailId, setSelectedTrailId] = useState(null)
  const [visibleTrailCount, setVisibleTrailCount] = useState(TRAIL_LIST_BATCH)

  const scrollContainerRef = useRef(null)
  const sentinelRef = useRef(null)

  const resolvedMapStyle =
    MAPBOX_STYLE_URL || 'mapbox://styles/mapbox/outdoors-v12'
  const hasVectorTileset =
    Boolean(MAPBOX_TILESET_URL) &&
    MAPBOX_TILESET_TYPE === 'vector' &&
    Boolean(MAPBOX_TILESET_SOURCE_LAYER)
  const hasRasterTileset =
    Boolean(MAPBOX_TILESET_URL) && MAPBOX_TILESET_TYPE === 'raster'

  const filterOptions = useMemo(
    () =>
      buildExploreFilterOptions({
        trails,
        selectedActivity: activeActivity,
        selectedDifficulty: activeDifficulty,
      }),
    [trails, activeActivity, activeDifficulty]
  )

  const restoreScrollPosition = useCallback((savedPosition) => {
    const restore = () => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = savedPosition.containerTop
      }
      window.scrollTo({
        top: savedPosition.windowTop,
        left: savedPosition.windowLeft,
        behavior: 'auto',
      })
    }

    requestAnimationFrame(() => {
      restore()
      requestAnimationFrame(() => {
        restore()
        window.setTimeout(() => {
          restore()
        }, 80)
      })
    })
  }, [])

  const restoreWindowPositionOnly = useCallback((savedPosition) => {
    requestAnimationFrame(() => {
      window.scrollTo({
        top: savedPosition.windowTop,
        left: savedPosition.windowLeft,
        behavior: 'auto',
      })
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = savedPosition.containerTop
        }
        window.scrollTo({
          top: savedPosition.windowTop,
          left: savedPosition.windowLeft,
          behavior: 'auto',
        })
      })
    })
  }, [])

  const captureScrollPosition = useCallback(
    () => ({
      containerTop: scrollContainerRef.current?.scrollTop || 0,
      windowTop: window.scrollY,
      windowLeft: window.scrollX,
    }),
    []
  )

  const appendVisibleTrails = useCallback(() => {
    const savedPosition = captureScrollPosition()
    setVisibleTrailCount((count) => count + TRAIL_LIST_BATCH)
    restoreWindowPositionOnly(savedPosition)
  }, [captureScrollPosition, restoreWindowPositionOnly])

  const loadTrails = useCallback(async () => {
    setLoadingTrails(true)
    setErrorTrails(null)

    const savedPosition = captureScrollPosition()

    try {
      const params = {
        ...(searchQuery && { search: searchQuery }),
        ...(activeActivity !== FILTER_DEFAULTS.activity && {
          activity: activeActivity.toLowerCase(),
        }),
        ...(activeDifficulty !== FILTER_DEFAULTS.difficulty && {
          difficulty: activeDifficulty.toLowerCase(),
        }),
        ...(officialOnly ? { officialOnly: true } : {}),
        ...(unmarkedOnly ? { unmarkedOnly: true } : {}),
        compact: true,
        sort: activeSort.toLowerCase().replace(' ', '_'),
      }

      const response = await fetchTrails(params)
      setTrails(Array.isArray(response.data) ? response.data : [])
      restoreScrollPosition(savedPosition)
    } catch {
      setErrorTrails('Could not load trails. Please try again.')
    } finally {
      setLoadingTrails(false)
      restoreScrollPosition(savedPosition)
    }
  }, [
    searchQuery,
    activeActivity,
    activeDifficulty,
    activeSort,
    officialOnly,
    unmarkedOnly,
    captureScrollPosition,
    restoreScrollPosition,
  ])

  useEffect(() => {
    loadTrails()
  }, [loadTrails])

  useEffect(() => {
    let active = true

    setLoadingMapTrails(true)
    setErrorMapTrails(null)

    fetchMapTrailsGeojson()
      .then((response) => {
        if (!active) return
        setTrailsGeojson(normalizeTrailGeojsonCollection(response.data))
      })
      .catch(() => {
        if (!active) return
        setTrailsGeojson(EMPTY_TRAIL_FEATURE_COLLECTION)
        setErrorMapTrails('Could not load map trail overlay.')
      })
      .finally(() => {
        if (active) setLoadingMapTrails(false)
      })

    return () => {
      active = false
    }
  }, [])

  // IntersectionObserver-based infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return undefined

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry?.isIntersecting && !loadingTrails) {
          appendVisibleTrails()
        }
      },
      { rootMargin: '200px' }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [appendVisibleTrails, loadingTrails])

  useEffect(() => {
    const savedPosition = captureScrollPosition()
    setVisibleTrailCount(TRAIL_LIST_BATCH)
    restoreScrollPosition(savedPosition)
  }, [
    searchQuery,
    activeActivity,
    activeDifficulty,
    activeSort,
    officialOnly,
    unmarkedOnly,
    selectedAreaCenter,
    selectedAreaRadiusKm,
    captureScrollPosition,
    restoreScrollPosition,
  ])

  const handleResetFilters = useCallback(() => {
    setSearchQuery('')
    setActiveActivity(FILTER_DEFAULTS.activity)
    setActiveDifficulty(FILTER_DEFAULTS.difficulty)
    setActiveSort(FILTER_DEFAULTS.sort)
    setOfficialOnly(false)
    setUnmarkedOnly(false)
    setSelectedAreaCenter(null)
  }, [])

  const hasActiveFilters = useMemo(
    () =>
      Boolean(searchQuery) ||
      activeActivity !== FILTER_DEFAULTS.activity ||
      activeDifficulty !== FILTER_DEFAULTS.difficulty ||
      activeSort !== FILTER_DEFAULTS.sort ||
      officialOnly ||
      unmarkedOnly ||
      Boolean(selectedAreaCenter),
    [
      searchQuery,
      activeActivity,
      activeDifficulty,
      activeSort,
      officialOnly,
      unmarkedOnly,
      selectedAreaCenter,
    ]
  )

  const selectedAreaFeature = useMemo(() => {
    if (!selectedAreaCenter) return null

    return turfCircle(selectedAreaCenter, selectedAreaRadiusKm, {
      units: 'kilometers',
      steps: 60,
    })
  }, [selectedAreaCenter, selectedAreaRadiusKm])

  const visibleTrails = useMemo(() => {
    if (!selectedAreaFeature) return trails

    return trails.filter((trail) => {
      const centerPoint = getTrailCenterPoint(trail)
      if (!centerPoint) return false
      return booleanPointInPolygon(centerPoint, selectedAreaFeature)
    })
  }, [trails, selectedAreaFeature])

  const visibleTrailSourceCollection = useMemo(
    () =>
      regionMapView.zoom >= TRAIL_VISIBILITY_MIN_ZOOM
        ? trailsGeojson
        : EMPTY_TRAIL_FEATURE_COLLECTION,
    [regionMapView.zoom, trailsGeojson]
  )

  const featuredTrails = visibleTrails
  const displayedFeaturedTrails = useMemo(
    () => featuredTrails.slice(0, visibleTrailCount),
    [featuredTrails, visibleTrailCount]
  )
  const hasMoreFeaturedTrails = displayedFeaturedTrails.length < featuredTrails.length
  const searchSuggestions = useMemo(
    () =>
      getSearchSuggestions({
        query: searchQuery,
        trails,
        fallbackTerms: EXPLORE_FALLBACK_TERMS,
        limit: 9,
      }),
    [searchQuery, trails]
  )

  return (
    <div id="explore-page" className="explore-page" ref={scrollContainerRef}>
      <div className="explore-shell">
        <main className="explore-main">
          <section className="explore-map-panel reveal-up">
            <div className="explore-map-head">
              {selectedAreaCenter ? (
                <button
                  type="button"
                  className="explore-ghost-btn"
                  onClick={() => setSelectedAreaCenter(null)}
                >
                  Clear area
                </button>
              ) : null}
            </div>

            <div className="explore-map-controls">
              <details className="explore-filter-panel">
                <summary className="explore-filter-summary">
                  <span>Filters</span>
                  <strong>
                    {hasActiveFilters ? 'Active filters' : 'All routes'}
                  </strong>
                </summary>
                <div className="explore-filter-grid">
                  <label className="explore-filter-field">
                    <span className="explore-filter-label">Activity</span>
                    <select
                      value={activeActivity}
                      onChange={(event) =>
                        setActiveActivity(event.target.value)
                      }
                      className="explore-select"
                    >
                      {filterOptions.activities.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="explore-filter-field">
                    <span className="explore-filter-label">Difficulty</span>
                    <select
                      value={activeDifficulty}
                      onChange={(event) =>
                        setActiveDifficulty(event.target.value)
                      }
                      className="explore-select"
                    >
                      {filterOptions.difficulties.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="explore-filter-field">
                    <span className="explore-filter-label">Sort</span>
                    <select
                      value={activeSort}
                      onChange={(event) => setActiveSort(event.target.value)}
                      className="explore-select"
                    >
                      {filterOptions.sorts.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="explore-chip-toggle-row">
                  <button
                    type="button"
                    onClick={() => setOfficialOnly((value) => !value)}
                    className={`explore-filter-chip-btn ${officialOnly ? 'active' : ''}`}
                  >
                    Official Routes
                  </button>
                  <button
                    type="button"
                    onClick={() => setUnmarkedOnly((value) => !value)}
                    className={`explore-filter-chip-btn ${unmarkedOnly ? 'active' : ''}`}
                  >
                    Unmarked
                  </button>
                </div>

                {hasActiveFilters ? (
                  <div className="explore-active-summary">
                    {searchQuery ? (
                      <span className="explore-chip">
                        Search: {searchQuery}
                      </span>
                    ) : null}
                    {activeActivity !== FILTER_DEFAULTS.activity ? (
                      <span className="explore-chip">
                        Activity: {activeActivity}
                      </span>
                    ) : null}
                    {activeDifficulty !== FILTER_DEFAULTS.difficulty ? (
                      <span className="explore-chip">
                        Difficulty: {activeDifficulty}
                      </span>
                    ) : null}
                    {activeSort !== FILTER_DEFAULTS.sort ? (
                      <span className="explore-chip">Sort: {activeSort}</span>
                    ) : null}
                    {officialOnly ? (
                      <span className="explore-chip">Official routes</span>
                    ) : null}
                    {unmarkedOnly ? (
                      <span className="explore-chip">Unmarked sections</span>
                    ) : null}
                    {selectedAreaCenter ? (
                      <span className="explore-chip">
                        Area: {selectedAreaRadiusKm} km
                      </span>
                    ) : null}

                    <button
                      type="button"
                      className="explore-reset-link"
                      onClick={handleResetFilters}
                    >
                      Reset all
                    </button>
                  </div>
                ) : null}
              </details>

              <div className="explore-action-grid explore-action-grid-map">
                <button
                  type="button"
                  className="explore-action-card"
                  onClick={() => {
                    setActiveSort('Nearest')
                  }}
                >
                  <p className="explore-action-title">Nearest Routes</p>
                </button>

                <button
                  type="button"
                  className="explore-action-card"
                  onClick={() => {
                    setActiveSort('Popular')
                  }}
                >
                  <p className="explore-action-title">Top Rated</p>
                </button>

                <button
                  type="button"
                  className="explore-action-card"
                  onClick={() => {
                    setActiveActivity('Hiking')
                    setActiveDifficulty('Easy')
                    setActiveSort('Popular')
                  }}
                >
                  <p className="explore-action-title">Easy Trails</p>
                </button>
              </div>

              <div className="explore-search-row explore-search-row-map">
                <input
                  id="explore-search-input"
                  type="text"
                  placeholder="Search routes, mountain ranges, or terrain..."
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  list="explore-search-suggestions"
                  autoComplete="off"
                  className="explore-search-input"
                />
                <datalist id="explore-search-suggestions">
                  {searchSuggestions.map((suggestion) => (
                    <option
                      key={`explore-suggestion-${suggestion.toLowerCase()}`}
                      value={suggestion}
                    />
                  ))}
                </datalist>
                {searchQuery ? (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="explore-ghost-btn"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </div>

            {MAPBOX_TOKEN ? (
              <Map
                {...regionMapView}
                mapboxAccessToken={MAPBOX_TOKEN}
                mapStyle={resolvedMapStyle}
                style={{ width: '100%', height: 340 }}
                onMove={(event) => setRegionMapView(event.viewState)}
                onClick={(event) => {
                  const map = event.target
                  const layerIds = EXPLORE_INTERACTIVE_TRAIL_LAYER_IDS.filter(
                    (id) => map.getLayer(id)
                  )
                  const trailFeatures = layerIds.length
                    ? map.queryRenderedFeatures(event.point, {
                        layers: layerIds,
                      })
                    : []

                  if (trailFeatures.length) {
                    const trailId = String(
                      trailFeatures[0]?.properties?.id || ''
                    )
                    if (trailId) {
                      setSelectedTrailId(trailId)
                      return
                    }
                  }

                  const { lng, lat } = event.lngLat
                  setSelectedAreaCenter([lng, lat])
                }}
                attributionControl={false}
              >
                <TrailMapLayers
                  sourceId="explore-trails-source"
                  layerPrefix={EXPLORE_TRAIL_LAYER_PREFIX}
                  data={visibleTrailSourceCollection}
                />

                {hasVectorTileset ? (
                  <Source
                    id="explore-custom-tileset-source"
                    type="vector"
                    url={MAPBOX_TILESET_URL}
                  >
                    <Layer
                      id="explore-custom-tileset-layer"
                      type="line"
                      source="explore-custom-tileset-source"
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
                    id="explore-custom-tileset-source"
                    type="raster"
                    url={MAPBOX_TILESET_URL}
                  >
                    <Layer
                      id="explore-custom-tileset-raster-layer"
                      type="raster"
                      paint={{ 'raster-opacity': 0.9 }}
                    />
                  </Source>
                ) : null}

                {selectedAreaFeature ? (
                  <Source
                    id="explore-selected-area"
                    type="geojson"
                    data={selectedAreaFeature}
                  >
                    <Layer
                      id="explore-selected-area-fill"
                      type="fill"
                      paint={{
                        'fill-color': '#48a9a6',
                        'fill-opacity': 0.22,
                      }}
                    />
                    <Layer
                      id="explore-selected-area-line"
                      type="line"
                      paint={{
                        'line-color': '#4281a4',
                        'line-width': 2.5,
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
                    <div className="explore-map-marker" />
                  </Marker>
                ) : null}
              </Map>
            ) : (
              <div className="explore-state-box">
                Missing VITE_MAPBOX_TOKEN. Area map is unavailable.
              </div>
            )}

            <div className="explore-radius-controls">
              <span className="explore-radius-label">Radius</span>
              <input
                type="range"
                min={2}
                max={40}
                step={1}
                value={selectedAreaRadiusKm}
                onChange={(event) =>
                  setSelectedAreaRadiusKm(Number(event.target.value))
                }
                className="explore-radius-input"
              />
              <span className="explore-radius-value">
                {selectedAreaRadiusKm} km
              </span>
              <span className="explore-badge">TRAILS</span>
            </div>
            {(loadingMapTrails || errorMapTrails) && (
              <div className="explore-map-load-state">
                {loadingMapTrails ? 'Loading trail overlay...' : errorMapTrails}
              </div>
            )}
          </section>

          <SectionBlock
            title={
              searchQuery
                ? `Featured tracks for "${searchQuery}"`
                : 'Featured Tracks'
            }
            subtitle={
              selectedAreaCenter
                ? `${featuredTrails.length} tracks match your filters in the selected area`
                : `${featuredTrails.length} tracks match your active filters`
            }
          >
            {loadingTrails && trails.length === 0 ? (
              <div className="explore-state-box">Loading routes...</div>
            ) : errorTrails && trails.length === 0 ? (
              <div className="explore-state-box">
                <p>{errorTrails}</p>
                <button
                  type="button"
                  onClick={loadTrails}
                  className="explore-primary-btn"
                >
                  Retry
                </button>
              </div>
            ) : featuredTrails.length > 0 ? (
              <div className="explore-cards-stack">
                {errorTrails ? (
                  <div className="explore-inline-error" aria-live="polite">
                    {errorTrails}
                  </div>
                ) : null}

                {loadingTrails ? (
                  <div className="explore-inline-loading" aria-live="polite">
                    Refreshing trail results...
                  </div>
                ) : null}

                {displayedFeaturedTrails.map((trail) => (
                  <div
                    key={trail._id || trail.id}
                    className="explore-card-shell card-enter"
                    onClick={() => setSelectedTrailId(trail._id || trail.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <TrailCard trail={trail} />
                  </div>
                ))}

                {hasMoreFeaturedTrails ? (
                  <div
                    ref={sentinelRef}
                    className="explore-scroll-sentinel"
                    aria-hidden="true"
                  />
                ) : null}
              </div>
            ) : (
              <div className="explore-state-box">
                No routes found for current filters and selected area.
              </div>
            )}
          </SectionBlock>
        </main>
      </div>

      {selectedTrailId && (
        <TrailDetailPopup
          trailId={selectedTrailId}
          trail={
            displayedFeaturedTrails.find(
              (trail) => String(trail._id || trail.id) === String(selectedTrailId)
            ) || null
          }
          onClose={() => setSelectedTrailId(null)}
        />
      )}

      <BottomNav />
    </div>
  )
}
