export const SORT_OPTIONS = ['Popular', 'Newest', 'Nearest']

export const FILTER_DEFAULTS = {
  activity: 'All',
  difficulty: 'All',
  sort: 'Popular',
}

const BASE_ACTIVITY_OPTIONS = ['All', 'Hiking', 'Running', 'Cycling']
const BASE_DIFFICULTY_OPTIONS = ['All', 'Easy', 'Moderate', 'Hard', 'Extreme']
const ALL_LABEL = 'All'

function normalizeLabel(value) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized || null
}

function uniqueSorted(values) {
  return Array.from(new Set(values)).sort((a, b) =>
    a.localeCompare(b, 'bg', { sensitivity: 'base' })
  )
}

function mergeWithBase(baseValues, dynamicValues, selectedValue) {
  const withoutAll = uniqueSorted([
    ...baseValues.filter((value) => value !== ALL_LABEL),
    ...dynamicValues,
    ...(selectedValue && selectedValue !== ALL_LABEL ? [selectedValue] : []),
  ])

  return [ALL_LABEL, ...withoutAll]
}

function collectTrailActivities(trails) {
  return trails
    .map((trail) => normalizeLabel(trail.activity || trail.type || trail.sport))
    .filter(Boolean)
    .map((value) => value[0].toUpperCase() + value.slice(1))
}

function collectTrailDifficulties(trails) {
  return trails
    .map((trail) => normalizeLabel(trail.difficulty || trail.level))
    .filter(Boolean)
    .map((value) => value[0].toUpperCase() + value.slice(1))
}

export function buildExploreFilterOptions({
  trails = [],
  selectedActivity = FILTER_DEFAULTS.activity,
  selectedDifficulty = FILTER_DEFAULTS.difficulty,
} = {}) {
  const dynamicActivities = collectTrailActivities(trails)
  const dynamicDifficulties = collectTrailDifficulties(trails)

  return {
    activities: mergeWithBase(
      BASE_ACTIVITY_OPTIONS,
      dynamicActivities,
      selectedActivity
    ),
    difficulties: mergeWithBase(
      BASE_DIFFICULTY_OPTIONS,
      dynamicDifficulties,
      selectedDifficulty
    ),
    sorts: SORT_OPTIONS,
  }
}
