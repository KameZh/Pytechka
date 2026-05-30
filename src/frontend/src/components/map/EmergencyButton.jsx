import { useState } from 'react'
import './MapFloatingActions.css'

const PSS_NUMBERS = [
  { label: 'Emergency 112', phone: '112' },
  { label: 'PSS 1470', phone: '1470' },
  { label: 'PSS central post', phone: '02 963 2000' },
  { label: 'Advice 1471', phone: '1471' },
]

function toTelHref(phone) {
  return `tel:${String(phone || '').replace(/[^\d+]/g, '')}`
}

export default function EmergencyButton({
  top = 'calc(env(safe-area-inset-top, 0px) + 106px)',
  left = 20,
  zIndex = 25,
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className={`map-emergency-button ${open ? 'is-open' : ''}`}
        style={{ top, left, zIndex }}
        onClick={() => setOpen((value) => !value)}
        aria-label="Mountain rescue contacts"
        aria-expanded={open}
      >
        <span className="pss-logo-mark" aria-hidden="true">
          <span className="pss-logo-flower" />
          <span className="pss-logo-cross" />
          <span className="pss-logo-text">ПСС</span>
        </span>
      </button>

      {open ? (
        <div
          className="map-emergency-drawer"
          style={{ zIndex: zIndex + 6 }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="map-emergency-handle" />
          <div className="map-emergency-head">
            <div className="map-emergency-badge">
              <span className="pss-logo-mark" aria-hidden="true">
                <span className="pss-logo-flower" />
                <span className="pss-logo-cross" />
                <span className="pss-logo-text">ПСС</span>
              </span>
            </div>
            <div>
              <h3>Mountain Rescue</h3>
              <p>Fast call buttons for urgent mountain help.</p>
            </div>
            <button
              type="button"
              className="map-emergency-close"
              onClick={() => setOpen(false)}
              aria-label="Close rescue contacts"
            >
              ×
            </button>
          </div>
          <div className="map-emergency-grid">
            {PSS_NUMBERS.map((entry) => (
              <a key={entry.label} href={toTelHref(entry.phone)}>
                {entry.label}
              </a>
            ))}
          </div>
        </div>
      ) : null}
    </>
  )
}
