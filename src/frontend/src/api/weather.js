const OPENWEATHER_API_KEY = String(
  import.meta.env.VITE_OPENWEATHER_API_KEY || ''
).trim()

const OPENWEATHER_BASE_URL = 'https://api.openweathermap.org/data/2.5'

function assertWeatherApiKey() {
  if (!OPENWEATHER_API_KEY) {
    throw new Error('Missing VITE_OPENWEATHER_API_KEY')
  }
}

function buildQuery({ latitude, longitude, units = 'metric' }) {
  return new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
    units,
    appid: OPENWEATHER_API_KEY,
  })
}

export async function fetchCurrentWeather({ latitude, longitude }) {
  assertWeatherApiKey()

  const query = buildQuery({ latitude, longitude })
  const response = await fetch(`${OPENWEATHER_BASE_URL}/weather?${query}`)
  if (!response.ok) {
    throw new Error(`Weather request failed: ${response.status}`)
  }

  const payload = await response.json()
  return {
    temperature: Number(payload?.main?.temp ?? 0),
    feelsLike: Number(payload?.main?.feels_like ?? 0),
    windSpeed: Number(payload?.wind?.speed ?? 0),
    humidity: Number(payload?.main?.humidity ?? 0),
    condition: String(payload?.weather?.[0]?.main || 'Clear'),
    description: String(payload?.weather?.[0]?.description || ''),
    icon: String(payload?.weather?.[0]?.icon || ''),
    cityName: String(payload?.name || ''),
  }
}

export async function fetchWeatherForecast({ latitude, longitude, limit = 8 }) {
  assertWeatherApiKey()

  const query = buildQuery({ latitude, longitude })
  const response = await fetch(`${OPENWEATHER_BASE_URL}/forecast?${query}`)
  if (!response.ok) {
    throw new Error(`Forecast request failed: ${response.status}`)
  }

  const payload = await response.json()
  const items = Array.isArray(payload?.list) ? payload.list : []

  return items.slice(0, Math.max(1, limit)).map((entry) => ({
    timestamp: Number(entry?.dt || 0),
    temperature: Number(entry?.main?.temp ?? 0),
    windSpeed: Number(entry?.wind?.speed ?? 0),
    rainVolume: Number(entry?.rain?.['3h'] ?? 0),
    condition: String(entry?.weather?.[0]?.main || 'Clear'),
    description: String(entry?.weather?.[0]?.description || ''),
    icon: String(entry?.weather?.[0]?.icon || ''),
  }))
}

export function hasWeatherApiKey() {
  return Boolean(OPENWEATHER_API_KEY)
}
