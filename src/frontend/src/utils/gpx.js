function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function normalizeTrackPoint(point) {
  const latitude = Number(point?.latitude ?? point?.[1])
  const longitude = Number(point?.longitude ?? point?.[0])
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null

  const elevation = Number(point?.elevation ?? point?.altitude ?? point?.[2])
  const recordedAt = point?.recordedAt || point?.time || point?.timestamp

  return {
    latitude,
    longitude,
    elevation: Number.isFinite(elevation) ? elevation : null,
    recordedAt,
  }
}

export function buildGpx(points = [], name = 'Pytechka activity') {
  const normalized = points.map(normalizeTrackPoint).filter(Boolean)
  if (normalized.length < 2) return ''

  const trackPoints = normalized
    .map((point) => {
      const ele =
        point.elevation != null ? `\n        <ele>${point.elevation}</ele>` : ''
      const time = point.recordedAt
        ? `\n        <time>${new Date(point.recordedAt).toISOString()}</time>`
        : ''
      return `      <trkpt lat="${point.latitude}" lon="${point.longitude}">${ele}${time}\n      </trkpt>`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Pytechka" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(name)}</name>
    <time>${new Date().toISOString()}</time>
  </metadata>
  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${trackPoints}
    </trkseg>
  </trk>
</gpx>
`
}

export function downloadGpx(points, name) {
  const gpx = buildGpx(points, name)
  if (!gpx) return false

  const blob = new Blob([gpx], {
    type: 'application/gpx+xml;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const safeName = String(name || 'pytechka-activity')
    .trim()
    .replace(/[^a-z0-9а-я_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()

  link.href = url
  link.download = `${safeName || 'pytechka-activity'}.gpx`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
  return true
}
