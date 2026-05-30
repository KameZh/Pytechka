import { useEffect, useState } from 'react'
import { useOfflineStore } from '../../store/offlineStore'
import {
  fetchHuts,
  fetchMapTrails,
  fetchMapTrailsByArea,
  fetchMapTrailsGeojson,
} from '../../api/maps'
import { fetchClusters, fetchPings } from '../../api/pings'
import { listCleanupEvents } from '../../api/events'
import {
  downloadBulgariaOverviewTiles,
  downloadMapTilesForTrail,
} from '../../utils/offlineMapTiles'
import './OfflineMapModal.css'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN
const BULGARIA_CENTER = [25.4858, 42.7339]

function normalizeOfflineTrail(trail) {
  if (!trail || typeof trail !== 'object') return trail
  return {
    ...trail,
    geojson: trail.geojson || trail.geom || trail.mapGeometry || null,
  }
}

function mergeTrailGeometry(trails, geojson) {
  const geometryById = new Map()
  if (geojson?.type === 'FeatureCollection' && Array.isArray(geojson.features)) {
    geojson.features.forEach((feature) => {
      const id = String(feature?.properties?.id || '')
      if (id && feature?.geometry && !geometryById.has(id)) {
        geometryById.set(id, feature.geometry)
      }
    })
  }

  return trails.map((trail) => {
    const id = String(trail?._id || trail?.id || '')
    return normalizeOfflineTrail({
      ...trail,
      geojson: trail.geojson || trail.geom || trail.mapGeometry || geometryById.get(id),
    })
  })
}

const DATA_OPTIONS = [
  ['huts', 'Huts'],
  ['photos', 'Photos and pings'],
  ['clusters', 'Events and reports'],
  ['mapTiles', 'Bulgaria map tiles'],
]

const OfflineMapModal = ({ isOpen, onClose, mapCenter = null, mode = 'account' }) => {
  const {
    offlineTrails,
    offlineHuts,
    offlinePings,
    offlineClusters,
    offlineEvents,
    offlineMapPacks,
    offlineDeviceInfo,
    loadOfflineTrails,
    loadOfflineMapData,
    saveMultipleTrails,
    removeMultipleTrails,
    saveOfflineMapData,
  } = useOfflineStore()

  const [selectedIds, setSelectedIds] = useState(new Set())
  const [trailsList, setTrailsList] = useState([])
  const [loading, setLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveProgressText, setSaveProgressText] = useState('')
  const [error, setError] = useState(null)
  const [saveSummary, setSaveSummary] = useState(null)
  const [scope, setScope] = useState(mode === 'map' ? 'area' : 'bulgaria')
  const [includeData, setIncludeData] = useState({
    huts: true,
    photos: true,
    clusters: true,
    mapTiles: false,
  })

  useEffect(() => {
    if (!isOpen) return

    let active = true
    setLoading(true)
    setError(null)
    setSaveSummary(null)
    loadOfflineTrails()
    loadOfflineMapData()

    const lng = mapCenter?.longitude ?? mapCenter?.lng ?? BULGARIA_CENTER[0]
    const lat = mapCenter?.latitude ?? mapCenter?.lat ?? BULGARIA_CENTER[1]

    Promise.allSettled([
      scope === 'area'
        ? fetchMapTrailsByArea({
            center: [lng, lat],
            radiusKm: 60,
            proximityMode: 'center',
          })
        : fetchMapTrails({ includeGeometry: true }),
      fetchMapTrailsGeojson(),
    ])
      .then(([trailsResult, geojsonResult]) => {
        if (!active) return

        if (trailsResult.status !== 'fulfilled') {
          throw trailsResult.reason
        }

        const fetchedTrails = Array.isArray(trailsResult.value?.data)
          ? trailsResult.value.data
          : []
        const merged = mergeTrailGeometry(
          fetchedTrails,
          geojsonResult.status === 'fulfilled' ? geojsonResult.value?.data : null
        )
        const currentDownloadedIds = new Set(
          useOfflineStore
            .getState()
            .offlineTrails.map((trail) => String(trail._id || trail.id))
        )

        setTrailsList(merged)
        setSelectedIds(
          new Set(
            merged
              .filter((trail) =>
                currentDownloadedIds.has(String(trail._id || trail.id))
              )
              .map((trail) => String(trail._id || trail.id))
          )
        )
      })
      .catch((err) => {
        if (!active) return
        setError(err?.response?.data?.error || err?.message || String(err))
        setTrailsList([])
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [
    isOpen,
    scope,
    mapCenter,
    loadOfflineMapData,
    loadOfflineTrails,
  ])

  const handleToggle = (id) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  const handleToggleAll = () => {
    if (selectedIds.size === trailsList.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(trailsList.map((t) => String(t._id || t.id))))
    }
  }

  const handleDataToggle = (key) => {
    setIncludeData((current) => ({ ...current, [key]: !current[key] }))
  }

  const handleDownload = async () => {
    setIsSaving(true)
    setError(null)
    setSaveSummary(null)
    try {
      const trailsToSave = trailsList
        .filter((trail) => selectedIds.has(String(trail._id || trail.id)))
        .map(normalizeOfflineTrail)
      const failedParts = []

      const trailsToRemove =
        mode === 'map'
          ? trailsList.filter((trail) => !selectedIds.has(String(trail._id || trail.id)))
          : []

      if (
        trailsToSave.length === 0 &&
        !Object.values(includeData).some(Boolean)
      ) {
        throw new Error('Choose at least one trail or map data type to save.')
      }

      setSaveProgressText('Saving selected trails...')
      await saveMultipleTrails(trailsToSave)
      if (trailsToRemove.length) {
        await removeMultipleTrails(trailsToRemove.map((t) => String(t._id || t.id)))
      }

      const payload = {}
      const summary = {
        trails: trailsToSave.length,
        huts: 0,
        pings: 0,
        clusters: 0,
        events: 0,
        mapTiles: 0,
        failedParts,
      }

      if (includeData.huts) {
        setSaveProgressText('Saving huts...')
        try {
          const huts = await fetchHuts()
          payload.huts = Array.isArray(huts.data) ? huts.data : []
          summary.huts = payload.huts.length
        } catch (err) {
          failedParts.push('huts')
        }
      }
      if (includeData.photos) {
        setSaveProgressText('Saving photos and pings...')
        try {
          const pings = await fetchPings()
          payload.pings = Array.isArray(pings.data) ? pings.data : []
          summary.pings = payload.pings.length
        } catch (err) {
          failedParts.push('photos/pings')
        }
      }
      if (includeData.clusters) {
        setSaveProgressText('Saving events and reports...')
        try {
          const clusters = await fetchClusters()
          payload.clusters = Array.isArray(clusters.data) ? clusters.data : []
          payload.events = listCleanupEvents()
          summary.clusters = payload.clusters.length
          summary.events = Array.isArray(payload.events) ? payload.events.length : 0
        } catch (err) {
          failedParts.push('events/reports')
        }
      }

      let cachedTiles = 0
      if (includeData.mapTiles) {
        if (!MAPBOX_TOKEN) {
          failedParts.push('map tiles')
        } else {
          setSaveProgressText('Caching Bulgaria overview tiles...')
          cachedTiles += await downloadBulgariaOverviewTiles(
            MAPBOX_TOKEN,
            ({ completed, total, cached }) => {
              setSaveProgressText(
                `Caching Bulgaria map tiles ${completed}/${total} (${cached} saved)...`
              )
            }
          )

          for (const [index, trail] of trailsToSave.slice(0, 30).entries()) {
            const trailName = trail.name || trail.name_bg || `Trail ${index + 1}`
            cachedTiles += await downloadMapTilesForTrail(trail, MAPBOX_TOKEN, {
              onProgress: ({ completed, total, cached }) => {
                setSaveProgressText(
                  `Caching ${trailName} ${completed}/${total} (${cached} saved)...`
                )
              },
            })
          }
        }
      }

      if (includeData.mapTiles && MAPBOX_TOKEN) {
        summary.mapTiles = cachedTiles
        payload.mapPack = {
          id: `bulgaria-${scope}`,
          name:
            scope === 'area'
              ? 'Current area map pack'
              : 'Bulgaria overview map pack',
          scope,
          trailsCount: trailsToSave.length,
          cachedTiles,
          deviceId: offlineDeviceInfo?.id,
          deviceName: offlineDeviceInfo?.name,
        }
      }

      if (Object.keys(payload).length) {
        setSaveProgressText('Saving map data...')
        await saveOfflineMapData(payload)
      }

      await loadOfflineTrails()
      await loadOfflineMapData()
      setSaveSummary(summary)
    } catch (err) {
      setError(err?.message || 'Could not save offline data.')
    } finally {
      setIsSaving(false)
      setSaveProgressText('')
    }
  }

  if (!isOpen) return null

  return (
    <div className="offline-modal-backdrop">
      <div className="offline-modal">
        <div className="offline-modal-head">
          <div>
            <h2 className="offline-modal-title">Offline Maps</h2>
            <p className="offline-modal-subtitle">
              Save trails and useful map data on this device before going into
              low-connectivity areas.
            </p>
            <p className="offline-device-note">
              Stored locally on: <strong>{offlineDeviceInfo?.name || 'this device'}</strong>
            </p>
          </div>
          <button
            onClick={onClose}
            className="offline-modal-close"
            disabled={isSaving}
            aria-label="Close offline download"
          >
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="offline-scope-row">
          <button
            type="button"
            className={scope === 'bulgaria' ? 'active' : ''}
            onClick={() => setScope('bulgaria')}
            disabled={loading || isSaving}
          >
            Bulgaria
          </button>
          <button
            type="button"
            className={scope === 'area' ? 'active' : ''}
            onClick={() => setScope('area')}
            disabled={loading || isSaving}
          >
            Current area
          </button>
        </div>

        <div className="offline-data-grid">
          {DATA_OPTIONS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={includeData[key] ? 'active' : ''}
              onClick={() => handleDataToggle(key)}
              disabled={isSaving}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="offline-modal-toolbar">
          <span className="offline-modal-count">
            {loading
              ? 'Finding trails...'
              : `${trailsList.length} trail${trailsList.length === 1 ? '' : 's'} found`}
          </span>
          <button
            onClick={handleToggleAll}
            disabled={loading || trailsList.length === 0 || isSaving}
            className="offline-modal-link"
          >
            {selectedIds.size === trailsList.length && trailsList.length > 0
              ? 'Clear selection'
              : 'Select all'}
          </button>
        </div>

        <div className="offline-modal-body">
          {loading ? (
            <div className="offline-modal-state">
              <div>
                <div className="offline-spinner" />
                Scanning available trails...
              </div>
            </div>
          ) : error ? (
            <div className="offline-modal-state">
              <div>
                <strong>Could not load offline data.</strong>
                <br />
                {error}
              </div>
            </div>
          ) : trailsList.length === 0 ? (
            <div className="offline-modal-state">
              No trails found for this offline scope.
            </div>
          ) : (
            <ul className="offline-trail-list">
              {trailsList.map((trail) => {
                const id = String(trail._id || trail.id)
                const isSelected = selectedIds.has(id)
                const isDownloaded = offlineTrails.some(
                  (t) => String(t._id || t.id) === id
                )
                const distanceKm = trail.stats?.distance
                  ? (trail.stats.distance / 1000).toFixed(1)
                  : trail.distance
                    ? Number(trail.distance).toFixed(1)
                    : 0

                return (
                  <li key={id}>
                    <label
                      className={`offline-trail-row ${isSelected ? 'is-selected' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggle(id)}
                        disabled={isSaving}
                        className="sr-only"
                      />
                      <div className="offline-check">
                        {isSelected ? <span aria-hidden="true" /> : null}
                      </div>

                      <div>
                        <div className="offline-trail-title">
                          {trail.name || trail.name_bg || 'Unnamed Trail'}
                        </div>
                        <div className="offline-trail-meta">
                          {distanceKm} km · {trail.difficulty || 'moderate'}
                        </div>
                      </div>

                      {isDownloaded && <span className="offline-saved">SAVED</span>}
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="offline-summary">
          <span>{offlineTrails.length} trails</span>
          <span>{offlineHuts.length} huts</span>
          <span>{offlinePings.length} photos/pings</span>
          <span>{offlineClusters.length + offlineEvents.length} reports/events</span>
          <span>{offlineMapPacks.length} map packs</span>
        </div>

        {saveSummary ? (
          <div className="offline-save-result">
            <strong>Offline data saved on this device.</strong>
            <small>
              Device: {offlineDeviceInfo?.name || 'this device'}. Offline data
              stays in this browser/app storage and is not synced to another
              phone or computer.
            </small>
            <span>
              {saveSummary.trails} trails, {saveSummary.huts} huts,{' '}
              {saveSummary.pings} photos/pings,{' '}
              {saveSummary.clusters + saveSummary.events} reports/events,{' '}
              {saveSummary.mapTiles} map tiles.
            </span>
            {saveSummary.failedParts.length > 0 ? (
              <small>
                Could not save: {saveSummary.failedParts.join(', ')}.
              </small>
            ) : null}
          </div>
        ) : null}

        <div className="offline-modal-footer">
          <button
            onClick={saveSummary ? onClose : handleDownload}
            disabled={loading || isSaving}
            className="offline-primary"
          >
            {saveSummary
              ? 'Done'
              : isSaving
                ? saveProgressText || 'Saving offline data...'
                : `Save ${selectedIds.size} selected trail${
                    selectedIds.size === 1 ? '' : 's'
                  }`}
          </button>
        </div>
      </div>
    </div>
  )
}

export default OfflineMapModal
