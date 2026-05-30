import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const styles = {
  backdrop: {
    position: 'absolute',
    inset: 0,
    zIndex: 30,
    background: 'linear-gradient(180deg, transparent 42%, rgba(3,7,18,0.38))',
  },
  drawer: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 'calc(var(--app-bottom-nav-space, 86px) + 10px)',
    zIndex: 42,
    maxHeight:
      'min(68dvh, calc(100dvh - env(safe-area-inset-top, 0px) - var(--app-bottom-nav-space, 86px) - 118px))',
    borderRadius: 22,
    border: '1px solid rgba(126,176,206,0.24)',
    background:
      'linear-gradient(180deg, rgba(19, 31, 48, 0.99), rgba(10, 16, 26, 0.99))',
    boxShadow: '0 -18px 42px rgba(0, 1, 0, 0.45)',
    color: '#f8fafc',
    overflow: 'hidden',
    animation: 'hut-drawer-in 180ms ease-out both',
  },
  handle: {
    width: 46,
    height: 4,
    borderRadius: 999,
    background: 'rgba(148, 163, 184, 0.42)',
    margin: '10px auto 8px',
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    border: '1px solid rgba(148,163,184,0.24)',
    background: 'rgba(3,7,18,0.72)',
    color: '#e5e7eb',
    cursor: 'pointer',
    display: 'grid',
    placeItems: 'center',
  },
  content: {
    padding: '0 16px calc(env(safe-area-inset-bottom, 0px) + 16px)',
    overflowY: 'auto',
    maxHeight:
      'calc(min(68dvh, 100dvh - env(safe-area-inset-top, 0px) - var(--app-bottom-nav-space, 86px) - 118px) - 22px)',
  },
  head: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 12,
    alignItems: 'start',
  },
  tabs: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
    marginTop: 12,
    padding: 4,
    borderRadius: 17,
    background: 'rgba(2, 6, 23, 0.42)',
    border: '1px solid rgba(96, 165, 250, 0.18)',
  },
  tab: {
    minHeight: 40,
    borderRadius: 13,
    border: '1px solid transparent',
    background: 'transparent',
    color: '#9fb9d0',
    fontWeight: 850,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  activeTab: {
    background: 'linear-gradient(180deg, #2563eb, #1d4ed8)',
    color: '#fff',
    border: '1px solid rgba(191,219,254,0.34)',
    boxShadow: '0 8px 18px rgba(30, 64, 175, 0.28)',
  },
  scroll: {
    color: '#dbe7f0',
    fontSize: 13,
    marginTop: 12,
    lineHeight: 1.5,
    display: 'grid',
    gap: 9,
  },
  tag: {
    display: 'inline-flex',
    width: 'fit-content',
    borderRadius: 999,
    padding: '4px 9px',
    fontSize: 11,
    fontWeight: 850,
    background: 'rgba(34, 197, 94, 0.18)',
    color: '#86efac',
    border: '1px solid rgba(34,197,94,0.28)',
  },
  callGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
  },
  callButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    minHeight: 42,
    borderRadius: 12,
    border: '1px solid rgba(125, 211, 252, 0.34)',
    background: 'rgba(14, 165, 233, 0.14)',
    color: '#dff7ff',
    textDecoration: 'none',
    fontWeight: 800,
    fontSize: 12,
    textAlign: 'center',
    padding: '8px 10px',
  },
  contactCard: {
    display: 'grid',
    gap: 9,
    padding: 12,
    borderRadius: 16,
    border: '1px solid rgba(72, 169, 166, 0.28)',
    background:
      'linear-gradient(180deg, rgba(72, 169, 166, 0.13), rgba(15, 23, 42, 0.62))',
  },
  sectionCard: {
    padding: '10px 11px',
    borderRadius: 14,
    border: '1px solid rgba(126, 176, 206, 0.17)',
    background: 'rgba(15, 23, 42, 0.52)',
  },
  sectionLabel: {
    display: 'block',
    color: '#8de0dc',
    fontSize: 11,
    fontWeight: 900,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    marginBottom: 4,
  },
  sectionText: {
    color: '#dbe7f0',
    fontSize: 13,
    lineHeight: 1.48,
  },
  imageGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 8,
  },
  imageButton: {
    padding: 0,
    border: 0,
    borderRadius: 14,
    background: 'transparent',
    cursor: 'pointer',
    overflow: 'hidden',
    textAlign: 'left',
  },
  image: {
    width: '100%',
    aspectRatio: '1 / 0.75',
    objectFit: 'cover',
    borderRadius: 14,
    border: '1px solid rgba(148, 163, 184, 0.25)',
    background: 'rgba(15, 23, 42, 0.8)',
    display: 'block',
  },
  lightboxBackdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 2147483647,
    background: '#020617',
    display: 'flex',
    flexDirection: 'column',
    padding: 0,
    touchAction: 'none',
  },
  lightbox: {
    width: '100%',
    height: '100%',
    minHeight: 0,
    display: 'grid',
    gridTemplateRows: 'auto minmax(0, 1fr) auto',
  },
  lightboxTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding:
      'calc(env(safe-area-inset-top, 0px) + 12px) 14px 10px',
    color: '#e5f2ff',
    fontSize: 14,
    fontWeight: 800,
    background:
      'linear-gradient(180deg, rgba(2, 6, 23, 0.96), rgba(2, 6, 23, 0.72))',
  },
  lightboxTitle: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  lightboxImageWrap: {
    minHeight: 0,
    background: '#020617',
    overflow: 'hidden',
    display: 'grid',
    placeItems: 'center',
    touchAction: 'none',
    cursor: 'grab',
  },
  lightboxImage: {
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain',
    display: 'block',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    pointerEvents: 'none',
  },
  lightboxControls: {
    display: 'grid',
    gridTemplateColumns: '44px 44px 1fr 44px 44px',
    gap: 8,
    padding:
      '10px 14px calc(env(safe-area-inset-bottom, 0px) + 12px)',
    background:
      'linear-gradient(0deg, rgba(2, 6, 23, 0.96), rgba(2, 6, 23, 0.72))',
  },
  lightboxButton: {
    minHeight: 42,
    borderRadius: 14,
    border: '1px solid rgba(125, 211, 252, 0.28)',
    background: 'rgba(15, 23, 42, 0.82)',
    color: '#e5f2ff',
    fontWeight: 850,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '0 12px',
  },
  lightboxCloseButton: {
    width: 42,
    height: 42,
    flex: '0 0 auto',
    borderRadius: '50%',
    border: '1px solid rgba(226, 232, 240, 0.3)',
    background: 'rgba(15, 23, 42, 0.9)',
    color: '#f8fafc',
    cursor: 'pointer',
    display: 'grid',
    placeItems: 'center',
    fontSize: 21,
    fontWeight: 900,
    boxShadow: '0 12px 28px rgba(0, 0, 0, 0.35)',
  },
  lightboxZoomLabel: {
    minHeight: 42,
    borderRadius: 14,
    border: '1px solid rgba(148, 163, 184, 0.18)',
    background: 'rgba(15, 23, 42, 0.54)',
    color: '#cbd5e1',
    fontWeight: 800,
    display: 'grid',
    placeItems: 'center',
    fontSize: 12,
  },
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

function getPointerDistance(first, second) {
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY)
}

function toTelHref(phone) {
  return `tel:${String(phone || '').replace(/[^\d+]/g, '')}`
}

function toMailHref(email, hutName) {
  const subject = encodeURIComponent(`Question about ${hutName || 'the hut'}`)
  return `mailto:${email}?subject=${subject}`
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

function IconPhone() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6.6 3.8 8.9 3a1.7 1.7 0 0 1 2.1 1l1 2.4a1.7 1.7 0 0 1-.5 2l-1.1.9a10.8 10.8 0 0 0 4.3 4.3l.9-1.1a1.7 1.7 0 0 1 2-.5l2.4 1a1.7 1.7 0 0 1 1 2.1l-.8 2.3a2.3 2.3 0 0 1-2.3 1.6A15.5 15.5 0 0 1 4.9 6.1a2.3 2.3 0 0 1 1.7-2.3Z" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconMail() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" stroke="currentColor" strokeWidth="2.1" />
      <path d="m5 8 7 5 7-5" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconChevronLeft() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m15 18-6-6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconChevronRight() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m9 18 6-6-6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconMinus() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 12h12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  )
}

function IconPlus() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 6v12M6 12h12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  )
}

function extractPhoneNumbers(text) {
  if (!text) return []
  const phones = new Set()
  const phoneRegex = /(?:\+?\s*359|0)(?:[\s()./-]*\d){6,12}/g
  let match

  while ((match = phoneRegex.exec(text)) !== null) {
    const raw = match[0]
    const digits = raw.replace(/\D/g, '')
    if (digits.length < 7 || digits.length > 12) continue
    phones.add(digits.startsWith('359') ? `+${digits}` : raw.trim())
  }

  return Array.from(phones)
}

function extractEmails(text) {
  if (!text) return []
  const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)
  return Array.from(new Set(matches || []))
}

function getDescriptionPoints(description) {
  let processedDesc = description || ''
  if (processedDesc) {
    const headers = [
      'Местоположение',
      'GPS',
      'Описание',
      'Изходни пунктове',
      'Изходен пункт',
      'Съседни туристически обекти',
      'Съседни обекти',
      'Съседен обект',
      'Стопанин',
      'За контакт',
    ]
    headers.forEach((header) => {
      const re = new RegExp(`(${header}\\s*[:\\-]?\\s*)`, 'gi')
      processedDesc = processedDesc.replace(re, '||SPLIT||$1')
    })
  }

  return processedDesc
    .split(/(?:\|\|SPLIT\|\||\n)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5)
}

export default function HutPreviewCard({
  hut,
  onClose,
  panel = 'info',
  onPanelChange,
}) {
  const drawerRef = useRef(null)
  const pointersRef = useRef(new Map())
  const gestureRef = useRef(null)
  const [expandedPhotoIndex, setExpandedPhotoIndex] = useState(null)
  const [photoTransform, setPhotoTransform] = useState({ scale: 1, x: 0, y: 0 })
  const imageUrls = Array.isArray(hut?.imageUrls) ? hut.imageUrls : []
  const expandedPhoto =
    expandedPhotoIndex !== null ? imageUrls[expandedPhotoIndex] : null

  useEffect(() => {
    if (!hut) return
    const handler = (event) => {
      if (expandedPhotoIndex !== null) return
      if (drawerRef.current && !drawerRef.current.contains(event.target)) {
        onClose?.()
      }
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [expandedPhotoIndex, hut, onClose])

  useEffect(() => {
    setExpandedPhotoIndex(null)
  }, [hut?._id])

  useEffect(() => {
    setPhotoTransform({ scale: 1, x: 0, y: 0 })
    pointersRef.current.clear()
    gestureRef.current = null
  }, [expandedPhotoIndex])

  const descriptionPoints = useMemo(
    () => getDescriptionPoints(hut?.description),
    [hut?.description]
  )

  const phoneNumbers = useMemo(() => {
    const stored = Array.isArray(hut?.phoneNumbers) ? hut.phoneNumbers : []
    return Array.from(
      new Set([...stored, ...extractPhoneNumbers(hut?.contacts || '')])
    ).filter(Boolean)
  }, [hut?.contacts, hut?.phoneNumbers])

  const emails = useMemo(() => {
    return extractEmails(`${hut?.contacts || ''} ${hut?.description || ''}`)
  }, [hut?.contacts, hut?.description])

  const rawContacts = String(hut?.contacts || '').trim()
  const hasContactDetails =
    phoneNumbers.length > 0 || emails.length > 0 || rawContacts.length > 0

  if (!hut) return null

  const openPhoto = (index) => {
    setExpandedPhotoIndex(index)
  }

  const closePhoto = () => {
    setExpandedPhotoIndex(null)
  }

  const updateZoom = (nextScale) => {
    setPhotoTransform((current) => {
      const scale = clamp(nextScale, 1, 4)
      if (scale === 1) return { scale: 1, x: 0, y: 0 }
      const limit = 280 * (scale - 1)
      return {
        scale,
        x: clamp(current.x, -limit, limit),
        y: clamp(current.y, -limit, limit),
      }
    })
  }

  const resetZoom = () => {
    setPhotoTransform({ scale: 1, x: 0, y: 0 })
  }

  const zoomIn = () => {
    updateZoom(photoTransform.scale + 0.5)
  }

  const zoomOut = () => {
    updateZoom(photoTransform.scale - 0.5)
  }

  const handlePhotoWheel = (event) => {
    updateZoom(photoTransform.scale + (event.deltaY < 0 ? 0.25 : -0.25))
  }

  const handlePhotoDoubleClick = () => {
    if (photoTransform.scale > 1) {
      resetZoom()
    } else {
      setPhotoTransform({ scale: 2.25, x: 0, y: 0 })
    }
  }

  const handlePhotoPointerDown = (event) => {
    event.currentTarget.setPointerCapture?.(event.pointerId)
    pointersRef.current.set(event.pointerId, {
      clientX: event.clientX,
      clientY: event.clientY,
    })

    const pointers = Array.from(pointersRef.current.values())
    if (pointers.length === 1) {
      gestureRef.current = {
        mode: 'pan',
        startX: event.clientX,
        startY: event.clientY,
        transform: photoTransform,
      }
    }

    if (pointers.length === 2) {
      gestureRef.current = {
        mode: 'pinch',
        startDistance: getPointerDistance(pointers[0], pointers[1]),
        transform: photoTransform,
      }
    }
  }

  const handlePhotoPointerMove = (event) => {
    if (!pointersRef.current.has(event.pointerId)) return
    pointersRef.current.set(event.pointerId, {
      clientX: event.clientX,
      clientY: event.clientY,
    })

    const pointers = Array.from(pointersRef.current.values())
    const gesture = gestureRef.current

    if (gesture?.mode === 'pinch' && pointers.length >= 2) {
      const distance = getPointerDistance(pointers[0], pointers[1])
      const ratio = distance / Math.max(gesture.startDistance, 1)
      const scale = clamp(gesture.transform.scale * ratio, 1, 4)
      const limit = 280 * (scale - 1)
      setPhotoTransform({
        scale,
        x: clamp(gesture.transform.x, -limit, limit),
        y: clamp(gesture.transform.y, -limit, limit),
      })
      return
    }

    if (gesture?.mode === 'pan' && photoTransform.scale > 1 && pointers.length === 1) {
      const limit = 280 * (photoTransform.scale - 1)
      setPhotoTransform({
        scale: photoTransform.scale,
        x: clamp(gesture.transform.x + event.clientX - gesture.startX, -limit, limit),
        y: clamp(gesture.transform.y + event.clientY - gesture.startY, -limit, limit),
      })
    }
  }

  const handlePhotoPointerEnd = (event) => {
    const gesture = gestureRef.current
    pointersRef.current.delete(event.pointerId)

    if (
      gesture?.mode === 'pan' &&
      photoTransform.scale === 1 &&
      imageUrls.length > 1
    ) {
      const deltaX = event.clientX - gesture.startX
      const deltaY = event.clientY - gesture.startY
      if (Math.abs(deltaX) > 56 && Math.abs(deltaX) > Math.abs(deltaY) * 1.4) {
        if (deltaX < 0) {
          showNextPhoto()
        } else {
          showPreviousPhoto()
        }
      }
    }

    if (pointersRef.current.size === 0) {
      gestureRef.current = null
    }
  }

  const showPreviousPhoto = () => {
    setExpandedPhotoIndex((current) => {
      if (current === null || imageUrls.length === 0) return null
      return (current - 1 + imageUrls.length) % imageUrls.length
    })
  }

  const showNextPhoto = () => {
    setExpandedPhotoIndex((current) => {
      if (current === null || imageUrls.length === 0) return null
      return (current + 1) % imageUrls.length
    })
  }

  const photoViewer =
    expandedPhoto && typeof document !== 'undefined'
      ? createPortal(
          <div style={styles.lightboxBackdrop} onClick={closePhoto}>
            <div
              style={styles.lightbox}
              role="dialog"
              aria-modal="true"
              aria-label={`${hut.name} photo viewer`}
              onClick={(event) => event.stopPropagation()}
            >
              <div style={styles.lightboxTop}>
                <span style={styles.lightboxTitle}>
                  {hut.name} - {expandedPhotoIndex + 1} / {imageUrls.length}
                </span>
                <button
                  type="button"
                  onClick={closePhoto}
                  style={styles.lightboxCloseButton}
                  aria-label="Close photo viewer"
                >
                  ×
                </button>
              </div>
              <div
                style={{
                  ...styles.lightboxImageWrap,
                  cursor: photoTransform.scale > 1 ? 'grab' : 'zoom-in',
                }}
                onWheel={handlePhotoWheel}
                onDoubleClick={handlePhotoDoubleClick}
                onPointerDown={handlePhotoPointerDown}
                onPointerMove={handlePhotoPointerMove}
                onPointerUp={handlePhotoPointerEnd}
                onPointerCancel={handlePhotoPointerEnd}
              >
                <img
                  src={expandedPhoto}
                  alt={`${hut.name} photo ${expandedPhotoIndex + 1}`}
                  draggable="false"
                  style={{
                    ...styles.lightboxImage,
                    transform: `translate3d(${photoTransform.x}px, ${photoTransform.y}px, 0) scale(${photoTransform.scale})`,
                  }}
                />
              </div>
              <div style={styles.lightboxControls}>
                {imageUrls.length > 1 ? (
                  <button
                    type="button"
                    onClick={showPreviousPhoto}
                    style={styles.lightboxButton}
                    aria-label="Previous photo"
                  >
                    <IconChevronLeft />
                  </button>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  onClick={zoomOut}
                  style={styles.lightboxButton}
                  aria-label="Zoom out"
                >
                  <IconMinus />
                </button>
                <button
                  type="button"
                  onClick={resetZoom}
                  style={styles.lightboxZoomLabel}
                >
                  {Math.round(photoTransform.scale * 100)}%
                </button>
                <button
                  type="button"
                  onClick={zoomIn}
                  style={styles.lightboxButton}
                  aria-label="Zoom in"
                >
                  <IconPlus />
                </button>
                {imageUrls.length > 1 ? (
                  <button
                    type="button"
                    onClick={showNextPhoto}
                    style={styles.lightboxButton}
                    aria-label="Next photo"
                  >
                    <IconChevronRight />
                  </button>
                ) : (
                  <span />
                )}
              </div>
            </div>
          </div>,
          document.body
        )
      : null

  return (
    <>
      <div style={styles.backdrop} aria-hidden="true" />
      <div ref={drawerRef} style={styles.drawer}>
        <style>{`
          @keyframes hut-drawer-in {
            from { opacity: 0; transform: translateY(24px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}</style>
        <div style={styles.handle} />
        <div style={styles.content}>
          <div style={styles.head}>
            <div>
              <span style={styles.tag}>Mountain Hut</span>
              <h2
                style={{
                  margin: '8px 0 0',
                  fontSize: 20,
                  lineHeight: 1.15,
                  fontWeight: 900,
                }}
              >
                {hut.name}
              </h2>
              {hut.elevation ? (
                <p style={{ margin: '4px 0 0', color: '#9fb9d0', fontSize: 12 }}>
                  Elevation: {hut.elevation} m
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              style={styles.closeButton}
              aria-label="Close hut drawer"
            >
              ×
            </button>
          </div>

          <div style={styles.tabs}>
            <button
              type="button"
              style={{ ...styles.tab, ...(panel === 'info' ? styles.activeTab : {}) }}
              onClick={() => onPanelChange?.('info')}
            >
              <IconInfo />
              Info
            </button>
            <button
              type="button"
              style={{ ...styles.tab, ...(panel === 'images' ? styles.activeTab : {}) }}
              onClick={() => onPanelChange?.('images')}
            >
              <IconPhoto />
              Photos
            </button>
          </div>

          {panel === 'info' ? (
            <div style={styles.scroll}>
              {hasContactDetails ? (
                <div style={styles.contactCard}>
                  <div>
                    <span style={styles.sectionLabel}>Contact the hut</span>
                    <span style={{ ...styles.sectionText, color: '#b7c9d6' }}>
                      Call or send an email directly from your phone.
                    </span>
                  </div>
                  {(phoneNumbers.length > 0 || emails.length > 0) ? (
                    <div style={styles.callGrid}>
                      {phoneNumbers.map((phone) => (
                        <a key={phone} href={toTelHref(phone)} style={styles.callButton}>
                          <IconPhone />
                          {phone}
                        </a>
                      ))}
                      {emails.map((email) => (
                        <a
                          key={email}
                          href={toMailHref(email, hut.name)}
                          style={styles.callButton}
                        >
                          <IconMail />
                          Email
                        </a>
                      ))}
                    </div>
                  ) : null}
                  {rawContacts && phoneNumbers.length === 0 && emails.length === 0 ? (
                    <div style={styles.sectionText}>{rawContacts}</div>
                  ) : null}
                </div>
              ) : null}

              {descriptionPoints.length > 0 ? (
                descriptionPoints.map((point, index) => {
                  let text = point
                  if (!text.endsWith('.') && !text.endsWith('!')) text += '.'
                  const colonIndex = text.indexOf(':')
                  if (colonIndex > 0 && colonIndex < 35) {
                    return (
                      <div key={index} style={styles.sectionCard}>
                        <strong style={styles.sectionLabel}>
                          {text.substring(0, colonIndex + 1)}
                        </strong>
                        <div style={styles.sectionText}>
                          {text.substring(colonIndex + 1).trim()}
                        </div>
                      </div>
                    )
                  }
                  return (
                    <div key={index} style={styles.sectionCard}>
                      <div style={styles.sectionText}>{text}</div>
                    </div>
                  )
                })
              ) : (
                <p>No description available.</p>
              )}
            </div>
          ) : (
            <div style={styles.scroll}>
              {imageUrls.length > 0 ? (
                <div style={styles.imageGrid}>
                  {imageUrls.map((url, index) => (
                    <button
                      key={url}
                      type="button"
                      onClick={() => openPhoto(index)}
                      style={styles.imageButton}
                      aria-label={`Open hut photo ${index + 1}`}
                    >
                      <img
                        src={url}
                        alt={hut.name}
                        loading="lazy"
                        style={styles.image}
                      />
                    </button>
                  ))}
                </div>
              ) : (
                <p>No hut photos saved yet. Run the hut scraper to import BTS photos.</p>
              )}
            </div>
          )}
        </div>
      </div>
      {photoViewer}
    </>
  )
}
