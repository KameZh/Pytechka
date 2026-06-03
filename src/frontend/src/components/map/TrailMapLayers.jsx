import { Layer, Source } from 'react-map-gl/mapbox'
import {
  getTrailLayerIds,
  normalizeTrailGeojsonCollection,
} from './trailMapLayerUtils'

export default function TrailMapLayers({
  data,
  sourceId = 'pytechka-trails',
  layerPrefix = sourceId,
}) {
  const layerIds = getTrailLayerIds(layerPrefix)
  const sourceData = normalizeTrailGeojsonCollection(data)

  return (
    <Source id={sourceId} type="geojson" data={sourceData}>
      <Layer
        id={`${layerIds.unmarked}-casing`}
        type="line"
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        filter={[
          'all',
          ['==', ['get', 'colour_type'], 'unmarked'],
          ['!=', ['get', 'source'], 'user'],
        ]}
        paint={{
          'line-color': '#0f172a',
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0,
            ['*', 5, 0.1],
            8,
            ['*', 5, 0.5],
            12,
            4.5,
            20,
            ['*', 5, 1.8],
          ],
          'line-opacity': 0.9,
        }}
      />
      <Layer
        id={layerIds.unmarked}
        type="line"
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        filter={[
          'all',
          ['==', ['get', 'colour_type'], 'unmarked'],
          ['!=', ['get', 'source'], 'user'],
        ]}
        paint={{
          'line-color': '#000000',
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0,
            ['*', 2.5, 0.05],
            8,
            ['*', 2.5, 0.4],
            12,
            2.25,
            20,
            ['*', 2.5, 1.8],
          ],
          'line-opacity': 0.7,
          'line-dasharray': [2, 2],
        }}
      />

      <Layer
        id={`${layerIds.yellow}-casing`}
        type="line"
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        filter={[
          'all',
          ['==', ['get', 'colour_type'], 'yellow'],
          ['!=', ['get', 'source'], 'user'],
        ]}
        paint={{
          'line-color': '#0f172a',
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0,
            ['*', 5, 0.1],
            8,
            ['*', 5, 0.5],
            12,
            4.5,
            20,
            ['*', 5, 1.8],
          ],
          'line-opacity': 0.9,
        }}
      />

      <Layer
        id={layerIds.yellow}
        type="line"
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        filter={[
          'all',
          ['==', ['get', 'colour_type'], 'yellow'],
          ['!=', ['get', 'source'], 'user'],
        ]}
        paint={{
          'line-color': '#FFD700',
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0,
            ['*', 3, 0.06],
            8,
            ['*', 3, 0.4],
            12,
            2.7,
            20,
            ['*', 3, 1.8],
          ],
          'line-opacity': 0.9,
        }}
      />

      <Layer
        id={`${layerIds.green}-casing`}
        type="line"
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        filter={[
          'all',
          ['==', ['get', 'colour_type'], 'green'],
          ['!=', ['get', 'source'], 'user'],
        ]}
        paint={{
          'line-color': '#0f172a',
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0,
            ['*', 5, 0.1],
            8,
            ['*', 5, 0.5],
            12,
            4.5,
            20,
            ['*', 5, 1.8],
          ],
          'line-opacity': 0.9,
        }}
      />

      <Layer
        id={layerIds.green}
        type="line"
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        filter={[
          'all',
          ['==', ['get', 'colour_type'], 'green'],
          ['!=', ['get', 'source'], 'user'],
        ]}
        paint={{
          'line-color': '#22c55e',
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0,
            ['*', 3, 0.06],
            8,
            ['*', 3, 0.4],
            12,
            2.7,
            20,
            ['*', 3, 1.8],
          ],
          'line-opacity': 0.9,
        }}
      />

      <Layer
        id={`${layerIds.blue}-casing`}
        type="line"
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        filter={[
          'all',
          ['==', ['get', 'colour_type'], 'blue'],
          ['!=', ['get', 'source'], 'user'],
        ]}
        paint={{
          'line-color': '#0f172a',
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            8,
            ['*', 5, 0.6],
            12,
            4.5,
            20,
            ['*', 5, 1.8],
          ],
          'line-opacity': 0.9,
        }}
      />

      <Layer
        id={layerIds.blue}
        type="line"
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        filter={[
          'all',
          ['==', ['get', 'colour_type'], 'blue'],
          ['!=', ['get', 'source'], 'user'],
        ]}
        paint={{
          'line-color': '#2563eb',
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            8,
            ['*', 3, 0.6],
            12,
            2.7,
            20,
            ['*', 3, 1.8],
          ],
          'line-opacity': 0.9,
        }}
      />

      <Layer
        id={layerIds.whiteCasing}
        type="line"
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        filter={[
          'all',
          ['==', ['get', 'colour_type'], 'white'],
          ['!=', ['get', 'source'], 'user'],
        ]}
        paint={{
          'line-color': '#0f172a',
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0,
            ['*', 6, 0.12],
            8,
            ['*', 6, 0.5],
            12,
            5.4,
            20,
            ['*', 6, 1.8],
          ],
          'line-opacity': 0.95,
        }}
      />

      <Layer
        id={layerIds.whiteMain}
        type="line"
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        filter={[
          'all',
          ['==', ['get', 'colour_type'], 'white'],
          ['!=', ['get', 'source'], 'user'],
        ]}
        paint={{
          'line-color': '#ffffff',
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0,
            ['*', 3.5, 0.07],
            8,
            ['*', 3.5, 0.45],
            12,
            3.15,
            20,
            ['*', 3.5, 1.8],
          ],
          'line-opacity': 0.95,
        }}
      />

      <Layer
        id={`${layerIds.black}-casing`}
        type="line"
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        filter={[
          'all',
          ['==', ['get', 'colour_type'], 'black'],
          ['!=', ['get', 'source'], 'user'],
        ]}
        paint={{
          'line-color': '#e2e8f0',
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0,
            ['*', 4, 0.08],
            8,
            ['*', 4, 0.45],
            12,
            3.6,
            20,
            ['*', 4, 1.8],
          ],
          'line-opacity': 0.8,
        }}
      />

      <Layer
        id={layerIds.black}
        type="line"
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        filter={[
          'all',
          ['==', ['get', 'colour_type'], 'black'],
          ['!=', ['get', 'source'], 'user'],
        ]}
        paint={{
          'line-color': '#0f172a',
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0,
            ['*', 4, 0.08],
            8,
            ['*', 4, 0.45],
            12,
            3.6,
            20,
            ['*', 4, 1.8],
          ],
          'line-opacity': 0.92,
        }}
      />

      <Layer
        id={`${layerIds.red}-casing`}
        type="line"
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        filter={[
          'all',
          ['==', ['get', 'colour_type'], 'red'],
          ['!=', ['get', 'source'], 'user'],
        ]}
        paint={{
          'line-color': '#0f172a',
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            8,
            ['*', 5, 0.6],
            12,
            4.5,
            20,
            ['*', 5, 1.8],
          ],
          'line-opacity': 0.9,
        }}
      />

      <Layer
        id={layerIds.red}
        type="line"
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        filter={[
          'all',
          ['==', ['get', 'colour_type'], 'red'],
          ['!=', ['get', 'source'], 'user'],
        ]}
        paint={{
          'line-color': '#dc2626',
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            8,
            ['*', 4, 0.6],
            12,
            3.6,
            20,
            ['*', 4, 1.8],
          ],
          'line-opacity': 0.92,
        }}
      />

      <Layer
        id={layerIds.featuredCasing}
        type="line"
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        filter={['==', ['get', 'source'], 'osm_featured']}
        paint={{
          'line-color': '#0f172a',
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0,
            ['*', 7, 0.14],
            8,
            ['*', 7, 0.5],
            12,
            6.3,
            20,
            ['*', 7, 1.8],
          ],
          'line-opacity': 0.95,
        }}
      />

      <Layer
        id={layerIds.featuredMain}
        type="line"
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        filter={['==', ['get', 'source'], 'osm_featured']}
        paint={{
          'line-color': [
            'match',
            ['upcase', ['get', 'ref']],
            'E3',
            '#dc2626',
            'E4',
            '#2563eb',
            'E8',
            '#7c3aed',
            '#dc2626',
          ],
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0,
            ['*', 4.5, 0.09],
            8,
            ['*', 4.5, 0.45],
            12,
            4.05,
            20,
            ['*', 4.5, 1.8],
          ],
          'line-opacity': 0.98,
        }}
      />

      <Layer
        id={`${layerIds.user}-casing`}
        type="line"
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        filter={['==', ['get', 'source'], 'user']}
        paint={{
          'line-color': '#0f172a',
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            8,
            ['*', 8, 0.6],
            12,
            8,
            20,
            ['*', 8, 1.8],
          ],
          'line-opacity': 0.9,
        }}
      />

      <Layer
        id={layerIds.user}
        type="line"
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        filter={['==', ['get', 'source'], 'user']}
        paint={{
          'line-color': [
            'match',
            ['get', 'difficulty'],
            'easy',
            '#22c55e',
            'moderate',
            '#f97316',
            'hard',
            '#ef4444',
            'extreme',
            '#7f1d1d',
            '#64748b',
          ],
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            8,
            ['*', 4.5, 0.6],
            12,
            4.5,
            20,
            ['*', 4.5, 1.8],
          ],
          'line-opacity': 0.94,
        }}
      />
    </Source>
  )
}
