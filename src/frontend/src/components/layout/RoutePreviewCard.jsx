import { useEffect, useRef } from 'react'
import { useMapStore } from '../../store/mapStore'

const DIFFICULTY_LABELS = {
  easy: 'Easy',
  moderate: 'Moderate',
  hard: 'Hard',
  extreme: 'Extreme',
}

const DIFFICULTY_BADGE_COLORS = {
  easy: '#22c55e',
  moderate: '#f59e0b',
  hard: '#ef4444',
  extreme: '#7f1d1d',
}

const styles = {
  backdrop: {
    position: 'absolute',
    inset: 0,
    zIndex: 20,
  },
  cardWrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 'max(124px, calc(env(safe-area-inset-bottom, 0px) + 112px))',
    zIndex: 30,
  },
  card: {
    borderRadius: 22,
    overflow: 'hidden',
    maxHeight:
      'calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 150px)',
    background: 'rgba(15, 23, 35, 0.95)',
    border: '1px solid rgba(56, 189, 248, 0.28)',
    boxShadow: '0 18px 36px rgba(0, 1, 0, 0.34)',
    color: '#f8fafc',
  },
  content: {
    padding: 14,
    display: 'grid',
    gap: 8,
  },
  closeButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: '50%',
    border: 'none',
    background: 'rgba(0,0,0,0.5)',
    color: '#fff',
    cursor: 'pointer',
    display: 'grid',
    placeItems: 'center',
  },
  badgeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  statGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 8,
  },
  statBox: {
    border: '1px solid rgba(71, 85, 105, 0.45)',
    borderRadius: 12,
    padding: '8px 10px',
    background: 'rgba(2, 6, 23, 0.52)',
  },
  actionRow: {
    display: 'grid',
    gap: 8,
  },
  startButton: {
    border: 'none',
    borderRadius: 12,
    padding: '11px 14px',
    background: 'linear-gradient(135deg, #0ea5e9, #2563eb)',
    color: '#fff',
    fontWeight: 700,
    cursor: 'pointer',
  },
  secondaryButton: {
    border: '1px solid rgba(148,163,184,0.35)',
    borderRadius: 12,
    padding: '10px 14px',
    background: 'rgba(15, 23, 35, 0.64)',
    color: '#cbd5e1',
    fontWeight: 700,
    cursor: 'pointer',
  },
}

function formatDistanceKm(trail) {
  const km = Number(trail?.distance)
  if (Number.isFinite(km) && km > 0) return km.toFixed(2)

  const meters = Number(trail?.stats?.distance)
  if (Number.isFinite(meters) && meters > 0) {
    return (meters / 1000).toFixed(2)
  }

  return '0.00'
}

function formatElevation(trail) {
  const direct = Number(trail?.elevation)
  if (Number.isFinite(direct) && direct > 0) return Math.round(direct)

  const statsValue = Number(trail?.stats?.elevationGain)
  if (Number.isFinite(statsValue) && statsValue > 0) {
    return Math.round(statsValue)
  }

  return 0
}

function resolveDifficulty(trail) {
  const normalized = String(trail?.difficulty || 'moderate').toLowerCase()
  if (DIFFICULTY_LABELS[normalized]) return normalized
  return 'moderate'
}

function toTitleCase(value) {
  const text = String(value || '').trim()
  if (!text) return 'Unknown'
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export default function RoutePreviewCard({
  onStartTrail,
  onScheduleTrail,
  bottomOffset,
  showScheduleButton = true,
}) {
  const { selectedTrail, setSelectedTrail } = useMapStore()
  const cardRef = useRef(null)

  const dismiss = () => setSelectedTrail(null)

  useEffect(() => {
    if (!selectedTrail) return undefined

    const handler = (event) => {
      if (cardRef.current && !cardRef.current.contains(event.target)) {
        dismiss()
      }
    }

    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [selectedTrail])

  if (!selectedTrail) return null

  const trail = selectedTrail
  const difficultyKey = resolveDifficulty(trail)
  const difficultyLabel = DIFFICULTY_LABELS[difficultyKey]
  const difficultyBadgeColor = DIFFICULTY_BADGE_COLORS[difficultyKey]
  const markingLabel =
    trail?.colour_type && trail.colour_type !== 'unmarked'
      ? toTitleCase(trail.colour_type)
      : 'Unmarked'

  return (
    <>
      <div
        id="route-preview-backdrop"
        style={styles.backdrop}
        aria-hidden="true"
      />

      <div
        ref={cardRef}
        id="route-preview-card"
        style={{
          ...styles.cardWrap,
          ...(bottomOffset ? { bottom: bottomOffset } : {}),
        }}
      >
        <div style={styles.card}>
          <button
            id="route-preview-close"
            type="button"
            onClick={dismiss}
            style={styles.closeButton}
            aria-label="Close route preview"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          <div style={styles.content}>
            <div style={{ fontSize: 11, letterSpacing: 0.6, color: '#7dd3fc' }}>
              USER ROUTE
            </div>
            <h2
              id="route-preview-name"
              style={{ margin: 0, fontSize: 19, lineHeight: 1.2 }}
            >
              {trail.name || 'Route'}
            </h2>

            <div style={styles.badgeRow}>
              <span
                style={{
                  borderRadius: 999,
                  border: '1px solid rgba(148,163,184,0.35)',
                  padding: '3px 10px',
                  fontSize: 12,
                  color: '#cbd5e1',
                }}
              >
                {trail.region || 'Unknown region'}
              </span>
              <span
                style={{
                  borderRadius: 999,
                  background: difficultyBadgeColor,
                  padding: '3px 10px',
                  fontSize: 12,
                  fontWeight: 800,
                  color: '#f8fafc',
                }}
              >
                {difficultyLabel}
              </span>
            </div>

            <div id="route-preview-stats" style={styles.statGrid}>
              <div id="route-preview-distance" style={styles.statBox}>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Distance</div>
                <div style={{ fontWeight: 700 }}>
                  {formatDistanceKm(trail)} km
                </div>
              </div>
              <div id="route-preview-elevation" style={styles.statBox}>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Elevation</div>
                <div style={{ fontWeight: 700 }}>
                  +{formatElevation(trail)} m
                </div>
              </div>
              <div id="route-preview-marking" style={styles.statBox}>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Marking</div>
                <div style={{ fontWeight: 700 }}>{markingLabel}</div>
              </div>
            </div>

            <div style={{ fontSize: 12, lineHeight: 1.45, color: '#bfdbfe' }}>
              {trail.description ||
                'User-created route. Review distance and terrain before starting.'}
            </div>

            <div style={styles.actionRow}>
              <button
                id="route-preview-start"
                style={styles.startButton}
                onClick={() => onStartTrail?.(trail)}
              >
                Start navigation
              </button>
              {showScheduleButton ? (
                <button
                  id="route-preview-schedule"
                  style={styles.secondaryButton}
                  onClick={() => onScheduleTrail?.(trail)}
                >
                  Schedule
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
