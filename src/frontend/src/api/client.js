import axios from 'axios'
import { Capacitor } from '@capacitor/core'
import { CapacitorHttp } from '@capacitor/core'

const nativeApiBaseUrl = 'http://10.0.2.2:5174/api'
const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL
const androidApiBaseUrl = import.meta.env.VITE_ANDROID_API_BASE_URL
const isLocalWebDev =
  !Capacitor.isNativePlatform() &&
  typeof window !== 'undefined' &&
  ['localhost', '127.0.0.1'].includes(window.location.hostname)

const apiBaseUrl = Capacitor.isNativePlatform()
  ? configuredApiBaseUrl || androidApiBaseUrl || nativeApiBaseUrl
  : isLocalWebDev
    ? '/api'
    : configuredApiBaseUrl || '/api'

const api = axios.create({
  baseURL: apiBaseUrl,
})

const shouldBypassNgrokWarning = /ngrok(-free)?\.(app|dev|io)/i.test(
  String(apiBaseUrl),
)

function buildRequestUrl(url) {
  if (!url) return apiBaseUrl
  if (/^https?:\/\//i.test(url)) return url
  return `${apiBaseUrl.replace(/\/$/, '')}/${String(url).replace(/^\//, '')}`
}

function normalizeHeaders(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers).filter(([, value]) => value != null),
  )
}

function shouldSkipAuth(method, url, skipAuth) {
  if (skipAuth) return true

  const requestMethod = String(method || 'get').toLowerCase()
  const requestPath = String(url || '')

  if (requestMethod !== 'get') return false
  return (
    /^\/?trails(?:\/|$)/.test(requestPath) ||
    /^\/?huts(?:\/|$)/.test(requestPath) ||
    /^\/?events(?:\/|$)/.test(requestPath)
  )
}

function createHttpError(response, config) {
  const error = new Error(
    response?.data?.error || `Request failed with status ${response?.status}`,
  )
  error.response = response
  error.config = config
  error.isAxiosError = true
  error.code = response?.status ? `HTTP_${response.status}` : 'ERR_NETWORK'
  return error
}

async function nativeRequest(
  method,
  url,
  { params, data, headers, skipAuth } = {}
) {
  const mergedHeaders = {
    ...normalizeHeaders(headers),
  }

  const hasBody = data !== undefined && data !== null
  if (hasBody && !mergedHeaders['Content-Type'] && !mergedHeaders['content-type']) {
    mergedHeaders['Content-Type'] = 'application/json'
  }
  if (!mergedHeaders.Accept && !mergedHeaders.accept) {
    mergedHeaders.Accept = 'application/json'
  }

  if (!shouldSkipAuth(method, url, skipAuth) && clerkTokenGetter) {
    try {
      const token = await clerkTokenGetter()
      if (token) mergedHeaders.Authorization = `Bearer ${token}`
    } catch {
    }
  }

  const mergedParams = {
    ...(params || {}),
    ...(shouldBypassNgrokWarning
      ? { 'ngrok-skip-browser-warning': 'true' }
      : {}),
  }

  const response = await CapacitorHttp.request({
    method,
    url: buildRequestUrl(url),
    params: mergedParams,
    data,
    headers: mergedHeaders,
  })

  if (response.status >= 400) {
    throw createHttpError(response, { method, url, params, data, headers })
  }

  return {
    data: response.data,
    status: response.status,
    headers: response.headers || {},
    config: { method, url, params, data, headers },
  }
}

const nativeApi = {
  get: (url, config = {}) => nativeRequest('GET', url, config),
  post: (url, data, config = {}) => nativeRequest('POST', url, { ...config, data }),
  put: (url, data, config = {}) => nativeRequest('PUT', url, { ...config, data }),
  patch: (url, data, config = {}) => nativeRequest('PATCH', url, { ...config, data }),
  delete: (url, config = {}) => nativeRequest('DELETE', url, config),
}

let clerkTokenGetter = null

export function setClerkTokenGetter(fn) {
  clerkTokenGetter = fn
}

api.interceptors.request.use(async (config) => {
  if (!Capacitor.isNativePlatform() && shouldBypassNgrokWarning) {
    config.params = {
      ...(config.params || {}),
      'ngrok-skip-browser-warning': 'true',
    }
  }

  if (
    !shouldSkipAuth(config.method, config.url, config.skipAuth) &&
    clerkTokenGetter
  ) {
    try {
      const token = await clerkTokenGetter()
      if (token) config.headers.Authorization = `Bearer ${token}`
    } catch {
    }
  }
  return config
})

export default Capacitor.isNativePlatform() ? nativeApi : api
