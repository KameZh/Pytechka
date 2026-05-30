import { useState } from 'react'
import { useMapStore } from '../../store/mapStore'

const styles = {
  controlsWrap: {
    position: 'absolute',
    right: 12,
    top: 'calc(50% - 172px)',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    zIndex: 16,
  },
  buttonBase: {
    width: 44,
    height: 44,
    borderRadius: 13,
    border: '1px solid rgba(66, 129, 164, 0.4)',
    boxShadow: '0 10px 22px rgba(0, 1, 0, 0.32)',
    display: 'grid',
    placeItems: 'center',
    cursor: 'pointer',
    background: 'rgba(18, 26, 40, 0.9)',
    color: '#9fc9de',
  },
  zoomStack: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  settingsPanel: {
    position: 'fixed',
    left: 10,
    right: 10,
    bottom: 'calc(var(--app-bottom-nav-space, 86px) + env(safe-area-inset-bottom, 0px) + 12px)',
    maxHeight: 'min(68dvh, 520px)',
    overflowY: 'auto',
    borderRadius: 22,
    border: '1px solid rgba(66, 129, 164, 0.46)',
    background: 'rgba(17, 26, 40, 0.96)',
    color: '#e2e8f0',
    boxShadow: '0 18px 38px rgba(0, 1, 0, 0.38)',
    backdropFilter: 'blur(12px)',
    padding: '16px 14px 18px',
    display: 'grid',
    gap: 10,
    zIndex: 80,
  },
  settingsTitle: {
    margin: 0,
    fontSize: 13,
    fontWeight: 850,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  settingRow: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    alignItems: 'center',
    gap: 10,
    minHeight: 38,
  },
  settingLabel: {
    display: 'grid',
    gap: 2,
    fontSize: 13,
    fontWeight: 750,
  },
  settingHint: {
    color: '#8aa7b8',
    fontSize: 11,
    fontWeight: 600,
  },
  miniButton: {
    minHeight: 34,
    borderRadius: 10,
    border: '1px solid rgba(66, 129, 164, 0.36)',
    background: 'rgba(15, 23, 35, 0.72)',
    color: '#cfe8f3',
    fontSize: 12,
    fontWeight: 800,
    cursor: 'pointer',
    padding: '0 10px',
  },
}

function ToggleSwitch({ active, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      style={{
        width: 46,
        height: 26,
        borderRadius: 999,
        border: active
          ? '1px solid rgba(72, 169, 166, 0.85)'
          : '1px solid rgba(148, 163, 184, 0.34)',
        background: active
          ? 'linear-gradient(135deg, #48a9a6, #4281a4)'
          : 'rgba(15, 23, 35, 0.9)',
        cursor: 'pointer',
        padding: 3,
        display: 'flex',
        justifyContent: active ? 'flex-end' : 'flex-start',
      }}
    >
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: '#fbfef9',
          display: 'block',
        }}
      />
    </button>
  )
}

function IconSettings() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.9l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.9-.34 1.7 1.7 0 0 0-1 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.56 1.7 1.7 0 0 0-1.9.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.9 1.7 1.7 0 0 0-1.56-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1 1.7 1.7 0 0 0-.34-1.9l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.9.34H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.9-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.9V9c0 .68.4 1.29 1.02 1.56.2.09.42.14.65.14H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51.3z" />
    </svg>
  )
}

function IconCenter() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      <circle cx="12" cy="12" r="7" />
    </svg>
  )
}

function IconTarget() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  )
}

function IconDownload() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

function IconReset() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 12a9 9 0 1 0 3-6.708" />
      <path d="M3 4v5h5" />
    </svg>
  )
}

function IconZoomIn() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  )
}

function IconZoomOut() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  )
}

export default function MapControls({
  onCenterMe,
  onZoomIn,
  onZoomOut,
  onResetView,
  onTogglePitch,
  showResetViewButton = true,
  onToggleAreaInsights,
  areaInsightsEnabled = false,
  showAreaInsightsButton = false,
  onToggleOffline,
  showOfflineButton = false,
  onOverlayOpen,
  children,
}) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const {
    mapStyle,
    terrain3D,
    hillshadeRelief,
    toggleMapStyle,
    toggleTerrain,
    toggleHillshadeRelief,
  } = useMapStore()

  return (
    <div id="map-controls" style={styles.controlsWrap}>
      <button
        id="map-settings-toggle"
        title="Map settings"
        onClick={() => {
          setSettingsOpen((open) => {
            const next = !open
            if (next) onOverlayOpen?.('settings')
            return next
          })
        }}
        style={{
          ...styles.buttonBase,
          background: settingsOpen
            ? 'linear-gradient(180deg, #48a9a6, #4281a4)'
            : styles.buttonBase.background,
          color: settingsOpen ? '#fbfef9' : styles.buttonBase.color,
        }}
        aria-label="Open map settings"
        aria-expanded={settingsOpen}
      >
        <IconSettings />
      </button>

      {settingsOpen ? (
        <div id="map-settings-panel" style={styles.settingsPanel}>
          <h3 style={styles.settingsTitle}>Map settings</h3>

          <div style={styles.settingRow}>
            <div style={styles.settingLabel}>
              <span>Satellite map</span>
              <span style={styles.settingHint}>
                {mapStyle === 'outdoors-v12'
                  ? 'Outdoors active'
                  : 'Satellite active'}
              </span>
            </div>
            <ToggleSwitch
              active={mapStyle !== 'outdoors-v12'}
              onClick={toggleMapStyle}
              label="Toggle satellite map"
            />
          </div>

          <div style={styles.settingRow}>
            <div style={styles.settingLabel}>
              <span>Relief shading</span>
              <span style={styles.settingHint}>Makes terrain easier to read</span>
            </div>
            <ToggleSwitch
              active={hillshadeRelief}
              onClick={toggleHillshadeRelief}
              label="Toggle relief shading"
            />
          </div>

          <div style={styles.settingRow}>
            <div style={styles.settingLabel}>
              <span>3D terrain</span>
              <span style={styles.settingHint}>Shows mountain shape</span>
            </div>
            <ToggleSwitch
              active={terrain3D}
              onClick={toggleTerrain}
              label="Toggle 3D terrain"
            />
          </div>

          {onTogglePitch ? (
            <div style={styles.settingRow}>
              <div style={styles.settingLabel}>
                <span>Tilted view</span>
                <span style={styles.settingHint}>Quick perspective angle</span>
              </div>
              <button
                type="button"
                onClick={() => onTogglePitch?.()}
                style={styles.miniButton}
              >
                Toggle
              </button>
            </div>
          ) : null}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: 8,
            }}
          >
            {showOfflineButton ? (
              <button
                type="button"
                onClick={() => onToggleOffline?.()}
                style={styles.miniButton}
              >
                Offline area
              </button>
            ) : null}
            {showResetViewButton ? (
              <button
                type="button"
                onClick={() => onResetView?.()}
                style={styles.miniButton}
              >
                Reset view
              </button>
            ) : null}
            {showAreaInsightsButton ? (
              <button
                type="button"
                onClick={() => onToggleAreaInsights?.()}
                style={{
                  ...styles.miniButton,
                  gridColumn:
                    showOfflineButton || showResetViewButton
                      ? '1 / -1'
                      : undefined,
                  border: areaInsightsEnabled
                    ? '1px solid rgba(72, 169, 166, 0.72)'
                    : styles.miniButton.border,
                  color: areaInsightsEnabled ? '#a7f3d0' : '#cfe8f3',
                }}
              >
                {areaInsightsEnabled ? 'Hide area insights' : 'Show area insights'}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <button
        id="map-center-me"
        title="Center on my location"
        onClick={onCenterMe}
        style={styles.buttonBase}
        aria-label="Center on my location"
      >
        <IconCenter />
      </button>

      {showAreaInsightsButton ? (
        <button
          id="map-area-insights-toggle"
          title={
            areaInsightsEnabled
              ? 'Hide area insights panel'
              : 'Show area insights panel'
          }
          onClick={() => onToggleAreaInsights?.()}
          style={{
            ...styles.buttonBase,
            background: areaInsightsEnabled
              ? 'linear-gradient(180deg, #48a9a6, #4281a4)'
              : styles.buttonBase.background,
            color: areaInsightsEnabled ? '#fbfef9' : styles.buttonBase.color,
          }}
          aria-label="Toggle area insights panel"
        >
          <IconTarget />
        </button>
      ) : null}

      {showOfflineButton ? (
        <button
          id="map-offline-toggle"
          title="Download area offline"
          onClick={() => onToggleOffline?.()}
          style={styles.buttonBase}
          aria-label="Download offline maps"
        >
          <IconDownload />
        </button>
      ) : null}

      {showResetViewButton ? (
        <button
          id="map-reset-view"
          title="Reset map view"
          onClick={() => onResetView?.()}
          style={styles.buttonBase}
          aria-label="Reset map view"
        >
          <IconReset />
        </button>
      ) : null}

      <div style={styles.zoomStack}>
        <button
          id="map-zoom-in"
          title="Zoom in"
          onClick={() => onZoomIn?.()}
          style={styles.buttonBase}
          aria-label="Zoom in"
        >
          <IconZoomIn />
        </button>

        <button
          id="map-zoom-out"
          title="Zoom out"
          onClick={() => onZoomOut?.()}
          style={styles.buttonBase}
          aria-label="Zoom out"
        >
          <IconZoomOut />
        </button>
      </div>

      {children}
    </div>
  )
}
