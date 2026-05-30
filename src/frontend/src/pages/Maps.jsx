import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import MapView from '../components/map/MapView'
import BottomNav from '../components/layout/Bottomnav'
import { fetchMapTrails } from '../api/maps'
import { getSearchSuggestions } from '../utils/searchSuggestions'
import './Maps.css'

const MAPS_FALLBACK_TERMS = [
  'Hiking',
  'Running',
  'Forest',
  'Waterfall',
  'Mountain',
  'Eco',
]

export default function Maps() {
  const location = useLocation()
  const [searchQuery, setSearchQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [suggestionTrails, setSuggestionTrails] = useState([])
  const [hideTopBar, setHideTopBar] = useState(false)
  const [searchRequest, setSearchRequest] = useState(null)

  const initialStartFocus = useMemo(() => {
    const params = new URLSearchParams(location.search)
    const rawStartLng = params.get('startLng')
    const rawStartLat = params.get('startLat')
    const trailId = String(params.get('trailId') || '').trim()
    const draftId = String(params.get('draftId') || '').trim()

    if (draftId && rawStartLng == null && rawStartLat == null) {
      return {
        startCoordinates: null,
        trailId: null,
        draftId,
      }
    }

    if (rawStartLng == null || rawStartLat == null) {
      return null
    }

    const startLng = Number(rawStartLng)
    const startLat = Number(rawStartLat)

    if (!Number.isFinite(startLng) || !Number.isFinite(startLat)) {
      return null
    }

    if (Math.abs(startLng) > 180 || Math.abs(startLat) > 90) {
      return null
    }

    return {
      startCoordinates: [startLng, startLat],
      trailId: trailId || null,
      draftId: draftId || null,
    }
  }, [location.search])

  useEffect(() => {
    let active = true

    fetchMapTrails()
      .then((response) => {
        if (!active) return
        setSuggestionTrails(Array.isArray(response.data) ? response.data : [])
      })
      .catch(() => {
        if (!active) return
        setSuggestionTrails([])
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const previousHtmlOverflow = document.documentElement.style.overflow
    const previousBodyOverflow = document.body.style.overflow
    const previousHtmlOverscroll =
      document.documentElement.style.overscrollBehavior
    const previousBodyOverscroll = document.body.style.overscrollBehavior

    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overscrollBehavior = 'none'
    document.body.style.overscrollBehavior = 'none'

    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow
      document.body.style.overflow = previousBodyOverflow
      document.documentElement.style.overscrollBehavior = previousHtmlOverscroll
      document.body.style.overscrollBehavior = previousBodyOverscroll
    }
  }, [])

  const mapSearchSuggestions = useMemo(
    () =>
      getSearchSuggestions({
        query: searchQuery,
        trails: suggestionTrails,
        fallbackTerms: MAPS_FALLBACK_TERMS,
        limit: 9,
      }),
    [searchQuery, suggestionTrails]
  )

  const handleMapSearchSubmit = useCallback(
    (event) => {
      event.preventDefault()
      const query = searchQuery.trim()
      if (!query) return
      setSearchRequest({ id: Date.now(), query })
    },
    [searchQuery]
  )

  useEffect(() => {
    const query = searchQuery.trim()
    if (!query) return undefined
    const matchesSuggestion = mapSearchSuggestions.some(
      (suggestion) => suggestion.toLowerCase() === query.toLowerCase()
    )
    if (!matchesSuggestion) return undefined

    const timeout = window.setTimeout(() => {
      setSearchRequest({ id: Date.now(), query })
    }, 120)

    return () => window.clearTimeout(timeout)
  }, [mapSearchSuggestions, searchQuery])

  return (
    <div id="maps-page" className="maps-page">
      <div className="maps-layer">
        <MapView
          searchQuery={searchQuery}
          searchRequest={searchRequest}
          initialStartFocus={initialStartFocus}
          onTrailFlowVisibilityChange={setHideTopBar}
        />
      </div>

      {!hideTopBar ? (
        <div id="maps-topbar" className="maps-topbar">
          <div className="maps-panel">
            <form
              className={`maps-search ${searchFocused ? 'focused' : ''}`}
              onSubmit={handleMapSearchSubmit}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="maps-search-icon"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                id="maps-search-input"
                type="text"
                placeholder="Search peaks, lakes, places, and routes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                list="maps-search-suggestions"
                autoComplete="off"
                className="maps-search-input"
              />
              <datalist id="maps-search-suggestions">
                {mapSearchSuggestions.map((suggestion) => (
                  <option
                    key={`maps-suggestion-${suggestion.toLowerCase()}`}
                    value={suggestion}
                  />
                ))}
              </datalist>
              {searchQuery && (
                <button
                  type="button"
                  id="maps-search-clear"
                  onClick={() => setSearchQuery('')}
                  className="maps-clear-btn"
                  aria-label="Clear search"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </form>
          </div>
        </div>
      ) : null}

      <div className="maps-bottomnav-wrap">
        <BottomNav />
      </div>
    </div>
  )
}
