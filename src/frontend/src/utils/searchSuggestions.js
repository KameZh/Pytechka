const WORD_SPLIT_PATTERN = /[\s,./\\|_:-]+/
const MIN_TERM_LENGTH = 2

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

function registerTerm(store, value) {
  if (typeof value !== 'string') return

  const raw = value.trim()
  const normalized = normalizeText(raw)
  if (!normalized || normalized.length < MIN_TERM_LENGTH) return

  if (!store.has(normalized)) {
    store.set(normalized, raw)
  }
}

function registerStringAndWords(store, value) {
  if (typeof value !== 'string') return

  registerTerm(store, value)

  value
    .split(WORD_SPLIT_PATTERN)
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => registerTerm(store, part))
}

function registerUnknownValue(store, value) {
  if (!value) return

  if (Array.isArray(value)) {
    value.forEach((item) => registerUnknownValue(store, item))
    return
  }

  if (typeof value === 'string') {
    registerStringAndWords(store, value)
  }
}

function collectTrailTerms(trails) {
  const store = new Map()

  trails.forEach((trail) => {
    if (!trail || typeof trail !== 'object') return

    registerUnknownValue(store, trail.name)
    registerUnknownValue(store, trail.title)
    registerUnknownValue(store, trail.region)
    registerUnknownValue(store, trail.location)
    registerUnknownValue(store, trail.terrain)
    registerUnknownValue(store, trail.activity)
    registerUnknownValue(store, trail.difficulty)
    registerUnknownValue(store, trail.tags)
  })

  return store
}

function scoreTerm(term, normalizedQuery) {
  if (!normalizedQuery) return 3
  if (term === normalizedQuery) return 0
  if (term.startsWith(normalizedQuery)) return 1
  if (term.includes(normalizedQuery)) return 2
  return 4
}

export function getSearchSuggestions({
  query = '',
  trails = [],
  fallbackTerms = [],
  limit = 9,
} = {}) {
  const normalizedQuery = normalizeText(query)
  const safeLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(20, limit))
    : 9

  const store = collectTrailTerms(Array.isArray(trails) ? trails : [])
  registerUnknownValue(store, fallbackTerms)

  return Array.from(store.entries())
    .map(([normalized, label]) => ({ normalized, label }))
    .filter(({ normalized }) =>
      normalizedQuery ? normalized.includes(normalizedQuery) : true
    )
    .sort((a, b) => {
      const scoreDifference =
        scoreTerm(a.normalized, normalizedQuery) -
        scoreTerm(b.normalized, normalizedQuery)
      if (scoreDifference !== 0) return scoreDifference

      const lengthDifference = a.normalized.length - b.normalized.length
      if (lengthDifference !== 0) return lengthDifference

      return a.label.localeCompare(b.label)
    })
    .slice(0, safeLimit)
    .map(({ label }) => label)
}
