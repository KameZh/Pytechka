export const BULGARIA_CENTER = Object.freeze({
  longitude: 25.4858,
  latitude: 42.7339,
})

export const BULGARIA_CENTER_COORDINATES = Object.freeze([
  BULGARIA_CENTER.longitude,
  BULGARIA_CENTER.latitude,
])

export function buildCenteredView(zoom = 7) {
  return {
    longitude: BULGARIA_CENTER.longitude,
    latitude: BULGARIA_CENTER.latitude,
    zoom,
  }
}
