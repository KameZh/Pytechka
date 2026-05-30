import { useEffect, useMemo, useState } from 'react'

const normalizeDegrees = (value) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return ((number % 360) + 360) % 360
}

const shortestDelta = (from, to) => {
  const delta = normalizeDegrees(to) - normalizeDegrees(from)
  return ((delta + 540) % 360) - 180
}

const styles = {
  wrap: {
    position: 'absolute',
    top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
    left: 12,
    width: 74,
    height: 94,
    zIndex: 24,
    pointerEvents: 'none',
    display: 'grid',
    justifyItems: 'center',
    gap: 4,
    color: '#fbfef9',
    filter: 'drop-shadow(0 12px 22px rgba(0, 1, 0, 0.38))',
  },
  dial: {
    position: 'relative',
    width: 66,
    height: 66,
    borderRadius: '50%',
    border: '1px solid rgba(126, 176, 206, 0.46)',
    background:
      'radial-gradient(circle at 50% 50%, rgba(18, 26, 40, 0.66), rgba(7, 12, 20, 0.88))',
    backdropFilter: 'blur(9px)',
    boxShadow: 'inset 0 0 18px rgba(126, 176, 206, 0.16)',
  },
  rose: {
    position: 'absolute',
    inset: 0,
    transition: 'transform 160ms linear',
  },
  cardinal: {
    position: 'absolute',
    color: 'rgba(251, 254, 249, 0.72)',
    fontSize: 11,
    fontWeight: 900,
    lineHeight: 1,
  },
  northCardinal: {
    left: '50%',
    top: 5,
    transform: 'translateX(-50%)',
    color: '#f87171',
  },
  eastCardinal: {
    right: 6,
    top: '50%',
    transform: 'translateY(-50%)',
  },
  southCardinal: {
    left: '50%',
    bottom: 5,
    transform: 'translateX(-50%)',
  },
  westCardinal: {
    left: 6,
    top: '50%',
    transform: 'translateY(-50%)',
  },
  needle: {
    position: 'absolute',
    inset: 8,
    transformOrigin: '50% 50%',
    transition: 'transform 160ms linear',
  },
  northNeedle: {
    position: 'absolute',
    left: '50%',
    top: 0,
    width: 0,
    height: 0,
    borderLeft: '6px solid transparent',
    borderRight: '6px solid transparent',
    borderBottom: '25px solid #ef4444',
    transform: 'translateX(-50%)',
  },
  southNeedle: {
    position: 'absolute',
    left: '50%',
    bottom: 0,
    width: 0,
    height: 0,
    borderLeft: '5px solid transparent',
    borderRight: '5px solid transparent',
    borderTop: '22px solid rgba(226, 232, 240, 0.9)',
    transform: 'translateX(-50%)',
  },
  centerDot: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#fbfef9',
    transform: 'translate(-50%, -50%)',
    boxShadow: '0 0 0 3px rgba(15, 23, 42, 0.75)',
  },
  footer: {
    minWidth: 56,
    borderRadius: 999,
    border: '1px solid rgba(126, 176, 206, 0.32)',
    background: 'rgba(7, 12, 20, 0.72)',
    backdropFilter: 'blur(8px)',
    padding: '3px 8px',
    display: 'flex',
    justifyContent: 'center',
    gap: 5,
    fontSize: 10,
    fontWeight: 800,
    lineHeight: 1.2,
    fontVariantNumeric: 'tabular-nums',
  },
  source: {
    color: 'rgba(188, 227, 239, 0.78)',
  },
}

export default function LiveCompass({
  mapBearing = 0,
  movementHeading = null,
  liveEnabled = true,
  top = styles.wrap.top,
  left = styles.wrap.left,
  zIndex = styles.wrap.zIndex,
}) {
  const [deviceHeading, setDeviceHeading] = useState(null)

  useEffect(() => {
    if (!liveEnabled) {
      return undefined
    }

    if (typeof window === 'undefined') return undefined

    const updateHeading = (event) => {
      let nextHeading = null

      if (Number.isFinite(event.webkitCompassHeading)) {
        nextHeading = event.webkitCompassHeading
      } else if (Number.isFinite(event.alpha)) {
        nextHeading = 360 - event.alpha
      }

      if (!Number.isFinite(nextHeading)) return

      const normalized = normalizeDegrees(nextHeading)
      setDeviceHeading((current) => {
        if (!Number.isFinite(current)) return normalized
        return Math.abs(shortestDelta(current, normalized)) >= 1
          ? normalized
          : current
      })
    }

    window.addEventListener('deviceorientationabsolute', updateHeading, true)
    window.addEventListener('deviceorientation', updateHeading, true)

    return () => {
      window.removeEventListener('deviceorientationabsolute', updateHeading, true)
      window.removeEventListener('deviceorientation', updateHeading, true)
    }
  }, [liveEnabled])

  const activeDeviceHeading = liveEnabled ? deviceHeading : null

  const heading = Number.isFinite(activeDeviceHeading)
    ? activeDeviceHeading
    : Number.isFinite(movementHeading)
      ? movementHeading
      : 0

  const source = Number.isFinite(activeDeviceHeading)
    ? 'LIVE'
    : Number.isFinite(movementHeading)
      ? 'GPS'
      : 'MAP'

  const { dialRotation, needleRotation, label } = useMemo(
    () => ({
      dialRotation: normalizeDegrees(-mapBearing),
      needleRotation: normalizeDegrees(heading - mapBearing),
      label: Math.round(normalizeDegrees(heading)).toString().padStart(3, '0'),
    }),
    [heading, mapBearing]
  )

  return (
    <div
      style={{ ...styles.wrap, top, left, zIndex }}
      aria-label={`Compass heading ${label} degrees`}
      role="img"
    >
      <div style={styles.dial}>
        <div
          style={{
            ...styles.rose,
            transform: `rotate(${dialRotation}deg)`,
          }}
        >
          <span style={{ ...styles.cardinal, ...styles.northCardinal }}>N</span>
          <span style={{ ...styles.cardinal, ...styles.eastCardinal }}>E</span>
          <span style={{ ...styles.cardinal, ...styles.southCardinal }}>S</span>
          <span style={{ ...styles.cardinal, ...styles.westCardinal }}>W</span>
        </div>
        <div
          style={{
            ...styles.needle,
            transform: `rotate(${needleRotation}deg)`,
          }}
        >
          <span style={styles.northNeedle} />
          <span style={styles.southNeedle} />
        </div>
        <span style={styles.centerDot} />
      </div>
      <div style={styles.footer}>
        <span>{label}</span>
        <span style={styles.source}>{source}</span>
      </div>
    </div>
  )
}
