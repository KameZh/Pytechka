import { useState, useEffect } from 'react'
import './PhotoCaptureModal.css'

const PHOTO_CATEGORIES = [
  { id: 'viewpoint', label: 'Viewpoint' },
  { id: 'trail_condition', label: 'Trail condition' },
  { id: 'marking', label: 'Trail mark' },
  { id: 'water_source', label: 'Water source' },
  { id: 'hazard', label: 'Hazard' },
  { id: 'memory', label: 'Memory' },
]

export default function PhotoCaptureModal({
  photo,
  isOpen,
  onClose,
  onSubmit,
}) {
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('viewpoint')
  const [location, setLocation] = useState(null)
  const [locationError, setLocationError] = useState(null)
  const [submitError, setSubmitError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!isOpen) return undefined

    let active = true
    queueMicrotask(() => {
      if (!active) return
      setDescription('')
      setCategory('viewpoint')
      setLocation(null)
      setLocationError(null)
      setSubmitError('')
    })

    getCurrentLocation({
      onSuccess: (coords) => {
        if (active) setLocation(coords)
      },
      onError: (message) => {
        if (active) setLocationError(message)
      },
    })

    return () => {
      active = false
    }
  }, [isOpen])

  const getCurrentLocation = ({ onSuccess, onError }) => {
    if (!navigator.geolocation) {
      onError('Geolocation is not supported by your browser')
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        onSuccess({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        })
      },
      (error) => {
        console.error('Geolocation error:', error)
        onError('Unable to get your current location')
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    )
  }

  const handleSubmit = async () => {
    setSubmitError('')
    if (!location) {
      setLocationError('Location is required to submit a photo')
      return
    }

    setIsSubmitting(true)
    try {
      const photoUrl = photo?.dataUrl || photo?.webPath || photo?.path || ''
      await onSubmit({
        photoPath: photo?.path || '',
        photoUrl,
        webPath: photoUrl,
        description: description.trim(),
        photoCategory: category,
        coordinates: [location.longitude, location.latitude],
      })
      onClose()
    } catch (error) {
      console.error('Submit error:', error)
      const responseData = error?.response?.data
      const responseText =
        typeof responseData === 'string'
          ? responseData.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
          : ''
      const status = error?.response?.status
      setSubmitError(
        responseData?.error ||
          responseData?.message ||
          (responseText
            ? responseText.slice(0, 120)
            : `Could not save this photo${status ? ` (${status})` : ''}.`)
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="photo-capture-modal-overlay" onClick={onClose}>
      <div
        className="photo-capture-modal-content"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="photo-capture-modal-header">
          <h3>Add Trail Photo</h3>
          <button className="close-btn" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="photo-preview-container">
          {photo?.dataUrl || photo?.webPath ? (
            <img
              src={photo.dataUrl || photo.webPath}
              alt="Captured photo"
              className="photo-preview"
            />
          ) : (
            <div className="photo-placeholder">No photo available</div>
          )}
        </div>

        <div className="photo-form-group">
          <label>What does this photo show?</label>
          <div className="photo-category-grid">
            {PHOTO_CATEGORIES.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`photo-category-btn ${
                  category === item.id ? 'active' : ''
                }`}
                onClick={() => setCategory(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="photo-form-group">
          <label htmlFor="photo-description">
            Note
          </label>
          <input
            id="photo-description"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short useful detail..."
            maxLength={200}
          />
        </div>

        <div className="location-info">
          {location ? (
            <div className="location-success">
              <span className="location-icon">📍</span>
              <span>
                Location: {location.latitude.toFixed(6)},{' '}
                {location.longitude.toFixed(6)}
              </span>
            </div>
          ) : locationError ? (
            <div className="location-error">
              <span className="location-icon">⚠️</span>
              <span>{locationError}</span>
            </div>
          ) : (
            <div className="location-loading">
              <span className="loading-spinner"></span>
              <span>Getting your location...</span>
            </div>
          )}
        </div>

        {submitError ? (
          <div className="photo-submit-error">{submitError}</div>
        ) : null}

        <div className="modal-actions">
          <button
            className="cancel-btn"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            className="submit-btn"
            onClick={handleSubmit}
            disabled={isSubmitting || !location}
          >
            {isSubmitting ? 'Submitting...' : 'Add to Map'}
          </button>
        </div>
      </div>
    </div>
  )
}
