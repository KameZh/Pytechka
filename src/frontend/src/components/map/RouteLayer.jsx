import { Source, Layer } from 'react-map-gl/mapbox'

const DIFFICULTY_COLOR = {
  easy: '#22c55e',
  moderate: '#f97316',
  hard: '#ef4444',
  extreme: '#7f1d1d',
}

export default function RouteLayer({ trails = [] }) {
  return trails.map((trail) => {
    if (!trail.geojson) return null

    const color = DIFFICULTY_COLOR[trail.difficulty] ?? '#6b7280'

    const geojson =
      typeof trail.geojson === 'string'
        ? JSON.parse(trail.geojson)
        : trail.geojson

    return (
      <Source
        key={trail.id}
        id={`trail-source-${trail.id}`}
        type="geojson"
        data={geojson}
      >
        <Layer
          id={`trail-hit-${trail.id}`}
          type="line"
          paint={{
            'line-color': color,
            'line-width': 16,
            'line-opacity': 0,
          }}
        />
        <Layer
          id={`trail-line-${trail.id}`}
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{
            'line-color': color,
            'line-width': 4,
            'line-opacity': 0.85,
          }}
        />
      </Source>
    )
  })
}
