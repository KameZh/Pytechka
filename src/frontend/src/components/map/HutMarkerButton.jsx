import './MapFloatingActions.css'

const mainStyle = {
  width: 34,
  height: 34,
  borderRadius: '50%',
  background: '#166534',
  color: '#f8fafc',
  display: 'grid',
  placeItems: 'center',
  border: '2px solid #bbf7d0',
  boxShadow: '0 6px 12px rgba(0,0,0,0.34)',
  cursor: 'pointer',
  fontSize: 18,
}

const actionStyle = {
  width: 31,
  height: 31,
  borderRadius: '50%',
  border: '1px solid rgba(186,230,253,0.72)',
  background: 'linear-gradient(180deg, #38bdf8, #2563eb)',
  color: '#fff',
  display: 'grid',
  placeItems: 'center',
  boxShadow: '0 8px 18px rgba(0,0,0,0.34)',
  cursor: 'pointer',
  fontSize: 14,
}

function IconHut() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 11.5 12 5l8 6.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.5 10.5V20h11v-9.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 20v-5h4v5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconInfo() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.2" />
      <path d="M12 10v6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M12 7h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

function IconPhoto() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="2.5" stroke="currentColor" strokeWidth="2.2" />
      <path d="m7 16 3.2-3.2a1.4 1.4 0 0 1 2 0L14 14.6l1.1-1.1a1.4 1.4 0 0 1 2 0L20 16.4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9" cy="9" r="1.2" fill="currentColor" />
    </svg>
  )
}

export default function HutMarkerButton({
  title,
  selected,
  activePanel = 'info',
  onToggle,
  onPanelChange,
}) {
  return (
    <div className={`hut-marker-shell ${selected ? 'is-selected' : ''}`}>
      <div className="hut-marker-actions">
        <button
          type="button"
          title="Hut info"
          aria-label="Show hut info"
          tabIndex={selected ? 0 : -1}
          onClick={(event) => {
            event.stopPropagation()
            onPanelChange?.('info')
          }}
          style={{
            ...actionStyle,
            opacity: activePanel === 'info' ? 1 : 0.72,
            transform: activePanel === 'info' ? 'scale(1.08)' : 'scale(1)',
          }}
        >
          <IconInfo />
        </button>
        <button
          type="button"
          title="Hut photos"
          aria-label="Show hut photos"
          tabIndex={selected ? 0 : -1}
          onClick={(event) => {
            event.stopPropagation()
            onPanelChange?.('images')
          }}
          style={{
            ...actionStyle,
            opacity: activePanel === 'images' ? 1 : 0.72,
            transform: activePanel === 'images' ? 'scale(1.08)' : 'scale(1)',
          }}
        >
          <IconPhoto />
        </button>
      </div>
      <button
        type="button"
        title={title}
        onClick={(event) => {
          event.stopPropagation()
          onToggle?.(event)
        }}
        style={mainStyle}
      >
        <IconHut />
      </button>
    </div>
  )
}
