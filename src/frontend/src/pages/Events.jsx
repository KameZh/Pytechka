import { useCallback, useEffect, useMemo, useState } from 'react'
import { SignInButton, SignedIn, SignedOut, useUser } from '@clerk/clerk-react'
import 'mapbox-gl/dist/mapbox-gl.css'
import Map, { Layer, Marker, Source } from 'react-map-gl/mapbox'
import BottomNav from '../components/layout/Bottomnav'
import { fetchMapTrails } from '../api/maps'
import {
  listCleanupEvents,
  syncCleanupEventsFromTrails,
  toggleCleanupEventSignup,
} from '../api/events'
import { fetchClusters, voteClusterGone } from '../api/pings'
import { buildCenteredView } from '../utils/mapDefaults'
import './Events.css'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN
const MAPBOX_STYLE_URL = import.meta.env.VITE_MAPBOX_STYLE_URL
const OPENWEATHER_API_KEY = import.meta.env.VITE_OPENWEATHER_API_KEY

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

function toFeatureCollection(geojson) {
  if (!geojson) return null

  if (geojson.type === 'FeatureCollection') return geojson
  if (geojson.type === 'Feature') {
    return {
      type: 'FeatureCollection',
      features: [geojson],
    }
  }

  if (geojson.type === 'LineString' || geojson.type === 'MultiLineString') {
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: geojson,
          properties: {},
        },
      ],
    }
  }

  return null
}

async function fetchMapTrailsWithTimeout(timeoutMs = 2600) {
  return Promise.race([
    fetchMapTrails({ compact: true }),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Trails request timeout')), timeoutMs)
    }),
  ])
}

function formatSuggestedDate(dateIso) {
  if (!dateIso) return 'Date not available'

  try {
    const date = new Date(dateIso)
    return new Intl.DateTimeFormat('bg-BG', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)
  } catch {
    return 'Date not available'
  }
}

function initialsFromName(name) {
  if (!name) return 'U'
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

export default function Events() {
  const { isSignedIn, user } = useUser()
  const [events, setEvents] = useState([])
  const [selectedEventId, setSelectedEventId] = useState(null)
  const [selectedClusterId, setSelectedClusterId] = useState(null)
  const [detailMapReady, setDetailMapReady] = useState(false)
  const [clusterDetailMapReady, setClusterDetailMapReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [pendingSignupEventId, setPendingSignupEventId] = useState(null)

  const [clusters, setClusters] = useState([])
  const [clusterVoting, setClusterVoting] = useState(null)

  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selectedEventId) || null,
    [events, selectedEventId]
  )

  const selectedCluster = useMemo(
    () =>
      clusters.find(
        (cluster) => String(cluster._id) === String(selectedClusterId)
      ) || null,
    [clusters, selectedClusterId]
  )

  const selectedGeometry = useMemo(() => {
    const parsed = parseTrailGeojson(selectedEvent?.trailSnapshot?.geojson)
    return toFeatureCollection(parsed)
  }, [selectedEvent])

  const selectedCenter = useMemo(() => {
    const center = selectedEvent?.centerCoordinates
    if (Array.isArray(center) && center.length === 2) {
      return {
        longitude: Number(center[0]),
        latitude: Number(center[1]),
        zoom: 11,
      }
    }

    return buildCenteredView(7)
  }, [selectedEvent])

  const selectedClusterCenter = useMemo(() => {
    const coordinates = selectedCluster?.coordinates
    if (Array.isArray(coordinates) && coordinates.length === 2) {
      return {
        longitude: Number(coordinates[0]),
        latitude: Number(coordinates[1]),
        zoom: 13,
      }
    }

    return buildCenteredView(7)
  }, [selectedCluster])

  const selectedClusterGeometry = useMemo(() => {
    const coordinates = selectedCluster?.coordinates
    if (!Array.isArray(coordinates) || coordinates.length < 2) return null

    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [Number(coordinates[0]), Number(coordinates[1])],
          },
          properties: {},
        },
      ],
    }
  }, [selectedCluster])

  const selectedClusterVoters = useMemo(() => {
    if (!selectedCluster) return []

    const currentUserDisplayName =
      user?.fullName ||
      user?.username ||
      user?.primaryEmailAddress?.emailAddress ||
      'You'

    const resolveDisplayName = (voterUserId, fallbackName) => {
      if (user && String(voterUserId) === String(user.id)) {
        return currentUserDisplayName
      }
      return fallbackName
    }

    if (
      Array.isArray(selectedCluster.voterProfiles) &&
      selectedCluster.voterProfiles.length > 0
    ) {
      return selectedCluster.voterProfiles.map((profile, index) => ({
        key: `${profile.userId || 'unknown'}-${index}`,
        name: resolveDisplayName(
          profile.userId,
          profile.name || `User ${String(profile.userId || '').slice(0, 6)}`
        ),
      }))
    }

    if (
      Array.isArray(selectedCluster.goneVotes) &&
      selectedCluster.goneVotes.length > 0
    ) {
      return selectedCluster.goneVotes.map((userId, index) => ({
        key: `${String(userId)}-${index}`,
        name: resolveDisplayName(userId, `User ${String(userId).slice(0, 6)}`),
      }))
    }

    return []
  }, [selectedCluster, user])

  const eventClusters = useMemo(
    () => clusters.filter((cluster) => cluster.level === 'event'),
    [clusters]
  )

  const clutterClusters = useMemo(
    () => clusters.filter((cluster) => cluster.level === 'clutter'),
    [clusters]
  )

  const hasAnyCards =
    eventClusters.length > 0 || clutterClusters.length > 0 || events.length > 0

  const loadAndSync = useCallback(async () => {
    setLoading(true)

    try {
      const res = await fetchMapTrailsWithTimeout(2600)
      const liveTrails = Array.isArray(res?.data) ? res.data : []
      const synced = await syncCleanupEventsFromTrails({
        trails: liveTrails,
        weatherApiKey: OPENWEATHER_API_KEY,
      })
      setEvents(synced)
    } catch {
      setEvents(listCleanupEvents())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const localEvents = listCleanupEvents()
    setEvents(localEvents)

    loadAndSync()
  }, [loadAndSync])

  useEffect(() => {
    fetchClusters()
      .then((res) => setClusters(Array.isArray(res.data) ? res.data : []))
      .catch(() => setClusters([]))
  }, [])

  const handleClusterVote = useCallback(async (clusterId) => {
    setClusterVoting(clusterId)
    try {
      const res = await voteClusterGone(clusterId)
      if (res.data.resolved) {
        setClusters((prev) => prev.filter((c) => c._id !== clusterId))
      } else {
        setClusters((prev) =>
          prev.map((c) => (c._id === clusterId ? res.data : c))
        )
      }
    } catch (err) {
      console.error('Cluster vote error:', err)
    } finally {
      setClusterVoting(null)
    }
  }, [])

  useEffect(() => {
    setDetailMapReady(false)
  }, [selectedEventId])

  useEffect(() => {
    setClusterDetailMapReady(false)
  }, [selectedClusterId])

  const handleToggleSignup = useCallback(
    async (eventId) => {
      if (!isSignedIn || !user) return

      try {
        setPendingSignupEventId(eventId)

        const updated = toggleCleanupEventSignup({
          eventId,
          userProfile: {
            userId: user.id,
            name:
              user.fullName ||
              user.username ||
              user.primaryEmailAddress?.emailAddress,
            imageUrl: user.imageUrl,
          },
        })

        setEvents((prev) =>
          prev.map((event) => (event.id === eventId ? updated : event))
        )
      } catch {
      } finally {
        setPendingSignupEventId(null)
      }
    },
    [isSignedIn, user]
  )

  return (
    <div id="events-page" className="events-page">
      <div className="events-shell">
        <main className="events-main">
          {loading ? (
            <div className="events-empty">Loading cleanup events...</div>
          ) : !hasAnyCards ? (
            <div className="events-empty">
              No cleanup events yet. An event appears automatically when a route
              passes 3 issue reports.
            </div>
          ) : (
            <section className="events-grid">
              {eventClusters.map((cluster) => (
                <article
                  key={`cluster-event-${cluster._id}`}
                  className="events-card events-cluster-card events-cluster-card-event card-enter"
                >
                  <div className="events-card-head">
                    <div className="events-cluster-heading">
                      <span className="events-cluster-badge events-cluster-badge-event">
                        E
                      </span>
                      <div>
                        <h2 className="events-card-title">Cleanup Event</h2>
                        <p className="events-card-region">
                          {cluster.pingCount} trash reports in this area
                        </p>
                      </div>
                    </div>
                    <span className="events-date-badge events-date-badge-event">
                      EVENT
                    </span>
                  </div>

                  <p className="events-purpose">
                    {cluster.description ||
                      'Multiple reports have been detected and this area needs a cleanup action.'}
                  </p>

                  <div className="events-chip-row">
                    <span className="events-chip">
                      Pings: {cluster.pingCount}
                    </span>
                    <span className="events-chip">
                      Votes: {cluster.goneVotes?.length || 0}/5
                    </span>
                    <span className="events-chip">Status: active</span>
                  </div>

                  <p className="events-weather-text">
                    Community signal generated from clustered trash reports.
                  </p>

                  <div className="events-card-actions">
                    <button
                      type="button"
                      className="events-ghost-btn"
                      onClick={() => {
                        setSelectedEventId(null)
                        setSelectedClusterId(cluster._id)
                      }}
                    >
                      View details
                    </button>

                    <SignedOut>
                      <SignInButton mode="modal">
                        <button type="button" className="events-primary-btn">
                          Mark as cleaned
                        </button>
                      </SignInButton>
                    </SignedOut>

                    <SignedIn>
                      <button
                        type="button"
                        className="events-primary-btn"
                        onClick={() => handleClusterVote(cluster._id)}
                        disabled={clusterVoting === cluster._id}
                      >
                        {clusterVoting === cluster._id
                          ? 'Voting...'
                          : 'Mark as cleaned'}
                      </button>
                    </SignedIn>
                  </div>
                </article>
              ))}

              {clutterClusters.map((cluster) => (
                <article
                  key={`cluster-clutter-${cluster._id}`}
                  className="events-card events-cluster-card events-cluster-card-clutter card-enter"
                >
                  <div className="events-card-head">
                    <div className="events-cluster-heading">
                      <span className="events-cluster-badge events-cluster-badge-clutter">
                        C
                      </span>
                      <div>
                        <h2 className="events-card-title">Clutter Warning</h2>
                        <p className="events-card-region">
                          {cluster.pingCount} trash reports in this area
                        </p>
                      </div>
                    </div>
                    <span className="events-date-badge events-date-badge-warning">
                      WARNING
                    </span>
                  </div>

                  <p className="events-purpose">
                    {cluster.description ||
                      'Trash is accumulating in this area and needs verification and cleanup.'}
                  </p>

                  <div className="events-chip-row">
                    <span className="events-chip">
                      Pings: {cluster.pingCount}
                    </span>
                    <span className="events-chip">
                      Votes: {cluster.goneVotes?.length || 0}/3
                    </span>
                    <span className="events-chip">Status: warning</span>
                  </div>

                  <p className="events-weather-text">
                    Monitoring signal from repeated clutter reports.
                  </p>

                  <div className="events-card-actions">
                    <button
                      type="button"
                      className="events-ghost-btn"
                      onClick={() => {
                        setSelectedEventId(null)
                        setSelectedClusterId(cluster._id)
                      }}
                    >
                      View details
                    </button>

                    <SignedOut>
                      <SignInButton mode="modal">
                        <button type="button" className="events-primary-btn">
                          Mark as cleaned
                        </button>
                      </SignInButton>
                    </SignedOut>

                    <SignedIn>
                      <button
                        type="button"
                        className="events-primary-btn"
                        onClick={() => handleClusterVote(cluster._id)}
                        disabled={clusterVoting === cluster._id}
                      >
                        {clusterVoting === cluster._id
                          ? 'Voting...'
                          : 'Mark as cleaned'}
                      </button>
                    </SignedIn>
                  </div>
                </article>
              ))}

              {events.map((event) => {
                const participantCount = Array.isArray(event.participants)
                  ? event.participants.length
                  : 0
                const isJoined = Boolean(
                  user &&
                  Array.isArray(event.participants) &&
                  event.participants.some(
                    (participant) =>
                      String(participant.userId) === String(user.id)
                  )
                )

                return (
                  <article key={event.id} className="events-card card-enter">
                    <div className="events-card-head">
                      <div>
                        <h2 className="events-card-title">{event.routeName}</h2>
                        <p className="events-card-region">{event.region}</p>
                      </div>
                      <span className="events-date-badge">{event.aiBadge}</span>
                    </div>

                    <p className="events-purpose">{event.purpose}</p>

                    <div className="events-chip-row">
                      <span className="events-chip">
                        Issues: {event.issueCount}
                      </span>
                      <span className="events-chip">
                        Volunteers: {participantCount}
                      </span>
                      <span className="events-chip">{event.status}</span>
                    </div>

                    <p className="events-weather-text">
                      {event.weatherSummary}
                    </p>

                    <div className="events-card-actions">
                      <button
                        type="button"
                        className="events-ghost-btn"
                        onClick={() => {
                          setSelectedClusterId(null)
                          setSelectedEventId(event.id)
                        }}
                      >
                        View details
                      </button>

                      <SignedOut>
                        <SignInButton mode="modal">
                          <button type="button" className="events-primary-btn">
                            Join
                          </button>
                        </SignInButton>
                      </SignedOut>

                      <SignedIn>
                        <button
                          type="button"
                          className="events-primary-btn"
                          onClick={() => handleToggleSignup(event.id)}
                          disabled={pendingSignupEventId === event.id}
                        >
                          {pendingSignupEventId === event.id
                            ? 'Updating...'
                            : isJoined
                              ? 'Leave'
                              : 'Join'}
                        </button>
                      </SignedIn>
                    </div>
                  </article>
                )
              })}
            </section>
          )}
        </main>
      </div>

      {selectedEvent ? (
        <>
          <div
            className="events-detail-backdrop"
            onClick={() => setSelectedEventId(null)}
            aria-hidden="true"
          />

          <section className="events-detail-sheet">
            <header className="events-detail-header">
              <div>
                <h3 className="events-detail-title">
                  {selectedEvent.routeName}
                </h3>
                <p className="events-detail-date">
                  {formatSuggestedDate(selectedEvent.suggestedDateISO)}
                </p>
              </div>

              <button
                type="button"
                className="events-close-btn"
                onClick={() => setSelectedEventId(null)}
                aria-label="Close details"
              >
                ×
              </button>
            </header>

            <p className="events-detail-purpose">{selectedEvent.purpose}</p>

            <div className="events-detail-meta">
              <span className="events-chip">
                Issue reports: {selectedEvent.issueCount}
              </span>
              <span className="events-chip">
                Status: {selectedEvent.status}
              </span>
              <span className="events-chip">{selectedEvent.aiBadge}</span>
            </div>

            <div className="events-mini-map-wrap">
              {MAPBOX_TOKEN && selectedGeometry ? (
                <Map
                  key={`events-detail-map-${selectedEvent.id}`}
                  initialViewState={selectedCenter}
                  mapboxAccessToken={MAPBOX_TOKEN}
                  mapStyle={
                    MAPBOX_STYLE_URL || 'mapbox://styles/mapbox/outdoors-v12'
                  }
                  style={{ width: '100%', height: '100%' }}
                  interactive={false}
                  attributionControl={false}
                  onLoad={() => setDetailMapReady(true)}
                >
                  {detailMapReady ? (
                    <Source
                      id={`events-detail-route-${selectedEvent.id}`}
                      type="geojson"
                      data={selectedGeometry}
                    >
                      <Layer
                        id={`events-detail-route-layer-${selectedEvent.id}`}
                        type="line"
                        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                        paint={{
                          'line-color': '#48a9a6',
                          'line-width': 4,
                          'line-opacity': 0.9,
                        }}
                      />
                    </Source>
                  ) : null}
                </Map>
              ) : (
                <div className="events-mini-map-fallback">
                  Map preview is unavailable. Add VITE_MAPBOX_TOKEN to enable
                  route map.
                </div>
              )}
            </div>

            <div className="events-volunteers-block">
              <h4 className="events-volunteers-title">Registered volunteers</h4>

              {Array.isArray(selectedEvent.participants) &&
              selectedEvent.participants.length > 0 ? (
                <div className="events-volunteers-list">
                  {selectedEvent.participants.map((participant) => (
                    <div
                      key={participant.userId}
                      className="events-volunteer-item"
                    >
                      {participant.imageUrl ? (
                        <img
                          src={participant.imageUrl}
                          alt={participant.name}
                          className="events-volunteer-avatar"
                        />
                      ) : (
                        <div className="events-volunteer-avatar events-volunteer-fallback">
                          {initialsFromName(participant.name)}
                        </div>
                      )}
                      <span className="events-volunteer-name">
                        {participant.name}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="events-empty-volunteers">
                  No volunteers yet. Be the first to join.
                </p>
              )}
            </div>

            <div className="events-join-row">
              <SignedOut>
                <SignInButton mode="modal">
                  <button
                    type="button"
                    className="events-primary-btn events-join-btn"
                  >
                    Sign in to join this cleanup
                  </button>
                </SignInButton>
              </SignedOut>

              <SignedIn>
                <button
                  type="button"
                  className="events-primary-btn events-join-btn"
                  onClick={() => handleToggleSignup(selectedEvent.id)}
                  disabled={pendingSignupEventId === selectedEvent.id}
                >
                  {pendingSignupEventId === selectedEvent.id
                    ? 'Updating...'
                    : Array.isArray(selectedEvent.participants) &&
                        user &&
                        selectedEvent.participants.some(
                          (participant) =>
                            String(participant.userId) === String(user.id)
                        )
                      ? 'Leave cleanup'
                      : 'Join cleanup'}
                </button>
              </SignedIn>
            </div>
          </section>
        </>
      ) : null}

      {selectedCluster ? (
        <>
          <div
            className="events-detail-backdrop"
            onClick={() => setSelectedClusterId(null)}
            aria-hidden="true"
          />

          <section className="events-detail-sheet">
            <header className="events-detail-header">
              <div className="events-cluster-heading">
                <span
                  className={`events-cluster-badge ${
                    selectedCluster.level === 'event'
                      ? 'events-cluster-badge-event'
                      : 'events-cluster-badge-clutter'
                  }`}
                >
                  {selectedCluster.level === 'event' ? 'E' : 'C'}
                </span>
                <div>
                  <h3 className="events-detail-title">
                    {selectedCluster.level === 'event'
                      ? 'Cleanup Event Area'
                      : 'Clutter Warning Area'}
                  </h3>
                  <p className="events-detail-date">Live report summary</p>
                </div>
              </div>

              <button
                type="button"
                className="events-close-btn"
                onClick={() => setSelectedClusterId(null)}
                aria-label="Close details"
              >
                ×
              </button>
            </header>

            <p className="events-detail-purpose">
              {selectedCluster.description ||
                'This area has repeated reports and requires validation and cleanup action.'}
            </p>

            <div className="events-detail-meta">
              <span className="events-chip">
                Reports: {selectedCluster.pingCount || 0}
              </span>
              <span className="events-chip">
                Votes: {selectedCluster.goneVotes?.length || 0}/
                {selectedCluster.level === 'event' ? 5 : 3}
              </span>
              <span className="events-chip">
                Status:{' '}
                {selectedCluster.level === 'event' ? 'active event' : 'warning'}
              </span>
            </div>

            <div className="events-mini-map-wrap">
              {MAPBOX_TOKEN && selectedClusterGeometry ? (
                <Map
                  key={`events-cluster-map-${selectedCluster._id}`}
                  initialViewState={selectedClusterCenter}
                  mapboxAccessToken={MAPBOX_TOKEN}
                  mapStyle={
                    MAPBOX_STYLE_URL || 'mapbox://styles/mapbox/outdoors-v12'
                  }
                  style={{ width: '100%', height: '100%' }}
                  interactive={false}
                  attributionControl={false}
                  onLoad={() => setClusterDetailMapReady(true)}
                >
                  {clusterDetailMapReady ? (
                    <Source
                      id={`events-cluster-point-${selectedCluster._id}`}
                      type="geojson"
                      data={selectedClusterGeometry}
                    >
                      <Layer
                        id={`events-cluster-point-layer-${selectedCluster._id}`}
                        type="circle"
                        paint={{
                          'circle-radius': 8,
                          'circle-color':
                            selectedCluster.level === 'event'
                              ? '#ef4444'
                              : '#f59e0b',
                          'circle-stroke-color': '#fbfef9',
                          'circle-stroke-width': 2,
                          'circle-opacity': 0.95,
                        }}
                      />
                    </Source>
                  ) : null}
                  <Marker
                    longitude={selectedClusterCenter.longitude}
                    latitude={selectedClusterCenter.latitude}
                    anchor="center"
                  >
                    <span
                      className={`events-cluster-badge events-map-cluster-badge ${
                        selectedCluster.level === 'event'
                          ? 'events-cluster-badge-event'
                          : 'events-cluster-badge-clutter'
                      }`}
                    >
                      {selectedCluster.level === 'event' ? 'E' : 'C'}
                    </span>
                  </Marker>
                </Map>
              ) : (
                <div className="events-mini-map-fallback">
                  Map preview is unavailable. Add VITE_MAPBOX_TOKEN to enable
                  route map.
                </div>
              )}
            </div>

            <div className="events-volunteers-block">
              <h4 className="events-volunteers-title">Cleanup votes</h4>

              {selectedClusterVoters.length > 0 ? (
                <div className="events-volunteers-list">
                  {selectedClusterVoters.map((voter) => (
                    <div key={voter.key} className="events-volunteer-item">
                      <div className="events-volunteer-avatar events-volunteer-fallback">
                        {initialsFromName(voter.name)}
                      </div>
                      <span className="events-volunteer-name">
                        {voter.name}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="events-empty-volunteers">No cleanup votes yet.</p>
              )}
            </div>

            <div className="events-join-row">
              <SignedOut>
                <SignInButton mode="modal">
                  <button
                    type="button"
                    className="events-primary-btn events-join-btn"
                  >
                    Sign in to vote cleanup status
                  </button>
                </SignInButton>
              </SignedOut>

              <SignedIn>
                <button
                  type="button"
                  className="events-primary-btn events-join-btn"
                  onClick={() => handleClusterVote(selectedCluster._id)}
                  disabled={clusterVoting === selectedCluster._id}
                >
                  {clusterVoting === selectedCluster._id
                    ? 'Voting...'
                    : 'Mark as cleaned'}
                </button>
              </SignedIn>
            </div>
          </section>
        </>
      ) : null}

      <BottomNav />
    </div>
  )
}
