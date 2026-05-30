import { Link } from 'react-router-dom'

function extractLineCoordinates(geojson) {
  if (!geojson) return []

  const parsed = typeof geojson === 'string' ? JSON.parse(geojson) : geojson
  if (!parsed || typeof parsed !== 'object') return []

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

function resolveTrailStartCoordinates(trail) {
  const fromTrail = Array.isArray(trail?.startCoordinates)
    ? trail.startCoordinates
    : Array.isArray(trail?.stats?.startCoordinates)
      ? trail.stats.startCoordinates
      : null

  if (Array.isArray(fromTrail) && fromTrail.length === 2) {
    return [Number(fromTrail[0]), Number(fromTrail[1])]
  }

  try {
    const coords = extractLineCoordinates(trail?.geojson)
    if (!coords.length) return null
    return [Number(coords[0][0]), Number(coords[0][1])]
  } catch {
    return null
  }
}

function formatHighestPoint(value) {
  if (value == null) return '—'
  const text = String(value).trim()
  if (!text) return '—'
  return text
}

export default function TrailCard({ trail }) {
  const {
    id,
    _id,
    name,
    shortDescription,
    image,
    difficulty,
    activityType,
    distance,
    elevation,
    duration,
    region,
    tags,
    authorAvatar,
    authorName,
    photoCount,
    rating,
    ratingCount,
    description,
    stats,
    username,
    averageAccuracy,
    highestPoint,
  } = trail

  const trailId = id || _id
  const trailTags = tags || []
  const trailRating = rating ?? averageAccuracy ?? 0
  const trailRatingCount = ratingCount ?? 0
  const trailDistance =
    distance ?? (stats?.distance ? (stats.distance / 1000).toFixed(1) : '0')
  const trailElevation = elevation ?? stats?.elevationGain ?? 0
  const trailDuration =
    duration ??
    (stats?.duration ? `${Math.round(stats.duration / 60)} min` : '—')
  const trailDescription = shortDescription || description || ''
  const trailAuthorName = authorName || username || 'Unknown'
  const trailHighestPoint = formatHighestPoint(highestPoint)
  const trailStartCoordinates = resolveTrailStartCoordinates(trail)
  const trailIdQuery = trailId ? `&trailId=${encodeURIComponent(trailId)}` : ''
  const mapsStartHref = trailStartCoordinates
    ? `/maps?startLng=${encodeURIComponent(trailStartCoordinates[0])}&startLat=${encodeURIComponent(trailStartCoordinates[1])}${trailIdQuery}`
    : null

  const difficultyMap = {
    easy: { label: 'Easy', className: 'difficulty-badge-easy' },
    moderate: { label: 'Moderate', className: 'difficulty-badge-moderate' },
    hard: { label: 'Hard', className: 'difficulty-badge-hard' },
    extreme: { label: 'Extreme', className: 'difficulty-badge-extreme' },
  }

  const activityIconMap = {
    hiking: (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M13 4a1 1 0 1 0 2 0 1 1 0 0 0-2 0" />
        <path d="M7.5 22l2-7 3 3 2-4 3 8" />
        <path d="M11 11l-1-4 4 1 2 3-2 3" />
      </svg>
    ),
    running: (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="13" cy="4" r="1" />
        <path d="m7 21 3-6-2.5-3L11 6l4 4h3" />
        <path d="m14.5 18 1.5-3-3.5-4" />
      </svg>
    ),
    cycling: (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="18.5" cy="17.5" r="3.5" />
        <circle cx="5.5" cy="17.5" r="3.5" />
        <circle cx="15" cy="5" r="1" />
        <path d="M12 17.5V14l-3-3 4-3 2 3h2" />
      </svg>
    ),
  }

  const difficulty_info = difficultyMap[difficulty] || difficultyMap['moderate']

  return (
    <article id={`trail-card-${trailId}`} className="trail-card">
      {image && (
        <div
          id={`trail-card-image-wrapper-${trailId}`}
          className="trail-card-image-wrapper"
        >
          <img
            id={`trail-card-image-${trailId}`}
            src={image}
            alt={name}
            className="trail-card-image"
          />

          {activityType && (
            <div
              id={`trail-activity-badge-${trailId}`}
              className="trail-activity-badge"
            >
              <span className="trail-activity-icon">
                {activityIconMap[activityType]}
              </span>
              <span className="trail-activity-label">{activityType}</span>
            </div>
          )}
        </div>
      )}

      <div id={`trail-card-content-${trailId}`} className="trail-card-content">
        <div id={`trail-card-header-${trailId}`} className="trail-card-header">
          <h3 id={`trail-card-name-${trailId}`} className="trail-card-name">
            {name}
          </h3>
          <span
            id={`trail-difficulty-badge-${trailId}`}
            className={`difficulty-badge ${difficulty_info.className}`}
          >
            {difficulty_info.label}
          </span>
        </div>

        <div id={`trail-region-${trailId}`} className="trail-region">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          <span className="trail-region-label">{region}</span>
        </div>

        <p
          id={`trail-card-description-${trailId}`}
          className="trail-card-description"
        >
          {trailDescription}
        </p>

        <div id={`trail-stats-${trailId}`} className="trail-stats">
          <div className="trail-stat">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            <span className="trail-stat-value">{trailDistance}</span>
          </div>
          <div className="trail-stat-divider" />
          <div className="trail-stat">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
              <polyline points="17 6 23 6 23 12" />
            </svg>
            <span className="trail-stat-value">{trailElevation}</span>
          </div>
          <div className="trail-stat-divider" />
          <div className="trail-stat">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span className="trail-stat-value">{trailDuration}</span>
          </div>
        </div>

        <div id={`trail-card-footer-${trailId}`} className="trail-card-footer">
          <div
            id={`trail-highest-point-${trailId}`}
            className="trail-highest-point"
          >
            <span className="trail-highest-point-label">Highest point</span>
            <span className="trail-highest-point-value">
              {trailHighestPoint}
            </span>
          </div>

          {trailTags.length > 0 && (
            <div id={`trail-tags-${trailId}`} className="trail-tags">
              {trailTags.slice(0, 2).map((tag) => (
                <span key={tag} className="trail-tag">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {mapsStartHref ? (
            <Link
              to={mapsStartHref}
              className="trail-start-link"
              onClick={(event) => event.stopPropagation()}
            >
              Start position on map
            </Link>
          ) : null}
        </div>

        <div id={`trail-author-row-${trailId}`} className="trail-author-row">
          <div className="trail-author">
            {authorAvatar && (
              <img
                src={authorAvatar}
                alt={trailAuthorName}
                className="trail-author-avatar"
              />
            )}
            <span className="trail-author-name">{trailAuthorName}</span>

            <div id={`trail-rating-${trailId}`} className="trail-author-rating">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="trail-rating-star"
              >
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
              <span className="trail-rating-value">{trailRating}</span>
              <span className="trail-rating-count">({trailRatingCount})</span>
            </div>
          </div>
          {photoCount > 0 && (
            <div className="trail-photo-count">
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              <span>{photoCount} photos</span>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}
