const requestCache = new Map()

function stableParams(params = {}) {
  return Object.keys(params || {})
    .filter((key) => params[key] !== undefined && params[key] !== null)
    .sort()
    .map((key) => {
      const value = params[key]
      return `${encodeURIComponent(key)}=${encodeURIComponent(
        Array.isArray(value) ? value.join(',') : String(value)
      )}`
    })
    .join('&')
}

export function getRequestCacheKey(url, params = {}) {
  const query = stableParams(params)
  return `${url}${query ? `?${query}` : ''}`
}

export function clearRequestCache(match) {
  if (!match) {
    requestCache.clear()
    return
  }

  for (const key of requestCache.keys()) {
    if (typeof match === 'string' ? key.startsWith(match) : match.test(key)) {
      requestCache.delete(key)
    }
  }
}

export function cachedGet(api, url, config = {}, { ttlMs = 300000 } = {}) {
  const params = config.params || {}
  const key = getRequestCacheKey(url, params)
  const now = Date.now()
  const cached = requestCache.get(key)

  if (cached?.value && cached.expiresAt > now) {
    return Promise.resolve(cached.value)
  }

  if (cached?.promise) {
    return cached.promise
  }

  const promise = api.get(url, config).then((response) => {
    requestCache.set(key, {
      value: response,
      expiresAt: Date.now() + ttlMs,
    })
    return response
  })

  requestCache.set(key, {
    promise,
    expiresAt: now + ttlMs,
  })

  promise.catch(() => {
    if (requestCache.get(key)?.promise === promise) {
      requestCache.delete(key)
    }
  })

  return promise
}
