const configuredAppUrl = import.meta.env.VITE_APP_BASE_URL

function cleanOrigin(value) {
  const raw = String(value || '').trim().replace(/\/api\/?$/, '')
  if (!raw) return ''

  try {
    return new URL(raw).origin
  } catch {
    return raw.replace(/\/$/, '')
  }
}

export function getAuthRedirectOrigin() {
  const appOrigin = cleanOrigin(configuredAppUrl)
  if (appOrigin) return appOrigin

  const currentOrigin =
    typeof window !== 'undefined' ? cleanOrigin(window.location.origin) : ''
  return currentOrigin || '/'
}

export function buildAuthRedirectUrl(path = '/') {
  const suffix = String(path || '/').startsWith('/') ? path : `/${path}`
  return suffix
}
