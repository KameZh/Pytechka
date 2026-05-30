import { useEffect, useRef } from 'react'

const REF_BADGE_COLORS = {
  E3: '#dc2626',
  E4: '#2563eb',
  E8: '#7c3aed',
}

const NETWORK_LABELS = {
  iwn: 'International',
  nwn: 'National',
  rwn: 'Regional',
  lwn: 'Local',
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
  actionButton: {
    border: 'none',
    borderRadius: 12,
    padding: '11px 14px',
    background: 'linear-gradient(135deg, #0ea5e9, #2563eb)',
    color: '#fff',
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
  const value = Number(trail?.elevation_gain)
  if (Number.isFinite(value) && value > 0) return Math.round(value)

  const statsValue = Number(trail?.stats?.elevationGain)
  if (Number.isFinite(statsValue) && statsValue > 0)
    return Math.round(statsValue)

  return 0
}

export default function OfficialTrailCard({
  trail,
  onClose,
  onStartNavigation,
  bottomOffset,
}) {
  const cardRef = useRef(null)

  useEffect(() => {
    if (!trail) return undefined

    const handler = (event) => {
      if (cardRef.current && !cardRef.current.contains(event.target)) {
        onClose?.()
      }
    }

    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [trail, onClose])

  if (!trail) return null

  const ref = String(trail.ref || '').toUpperCase()
  const badgeColor = REF_BADGE_COLORS[ref] || '#475569'
  const network = String(trail.network || '').toLowerCase()
  const networkLabel = NETWORK_LABELS[network] || 'Network not specified'

  return (
    <>
      <div style={styles.backdrop} aria-hidden="true" />

      <div
        ref={cardRef}
        style={{
          ...styles.cardWrap,
          ...(bottomOffset ? { bottom: bottomOffset } : {}),
        }}
      >
        <div style={styles.card}>
          <button
            type="button"
            onClick={onClose}
            style={styles.closeButton}
            aria-label="Close official route preview"
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
              OFFICIAL ROUTE
            </div>
            <h2 style={{ margin: 0, fontSize: 19, lineHeight: 1.2 }}>
              {trail.name_bg || trail.name || 'Official route'}
            </h2>
            {trail.name_en ? (
              <div style={{ marginTop: -2, color: '#94a3b8', fontSize: 13 }}>
                {trail.name_en}
              </div>
            ) : null}

            <div style={styles.badgeRow}>
              {ref ? (
                <span
                  style={{
                    background: badgeColor,
                    borderRadius: 999,
                    padding: '3px 10px',
                    fontSize: 12,
                    fontWeight: 800,
                    color: '#f8fafc',
                  }}
                >
                  {ref}
                </span>
              ) : null}
              <span
                style={{
                  borderRadius: 999,
                  border: '1px solid rgba(148,163,184,0.35)',
                  padding: '3px 10px',
                  fontSize: 12,
                  color: '#cbd5e1',
                }}
              >
                {networkLabel}
                {network ? ` (${network})` : ''}
              </span>
            </div>

            <div style={styles.statGrid}>
              <div style={styles.statBox}>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Distance</div>
                <div style={{ fontWeight: 700 }}>
                  {formatDistanceKm(trail)} km
                </div>
              </div>
              <div style={styles.statBox}>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Elevation</div>
                <div style={{ fontWeight: 700 }}>
                  +{formatElevation(trail)} m
                </div>
              </div>
              <div style={styles.statBox}>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Marking</div>
                <div style={{ fontWeight: 700 }}>
                  {trail.colour_type === 'unmarked'
                    ? 'Unmarked'
                    : trail.colour_type || 'Not available'}
                </div>
              </div>
            </div>

            <div style={{ fontSize: 12, lineHeight: 1.45, color: '#bfdbfe' }}>
              {trail.description ||
                'Official OSM route. Check markings and conditions before starting.'}
            </div>

            <button
              type="button"
              onClick={() => onStartNavigation?.(trail)}
              style={styles.actionButton}
            >
              Start navigation
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
