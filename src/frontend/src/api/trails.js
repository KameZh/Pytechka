import api from './client'

export const fetchTrails = (params = {}) => {
  return api.get('/trails', { params, skipAuth: true })
}

export const fetchMyTrails = () => {
  return api.get('/trails/mine')
}

export const fetchTrailById = (id) => {
  return api.get(`/trails/${id}`, { skipAuth: true })
}

export const publishTrail = (data) => {
  return api.post('/trails', data)
}

export const updateTrail = (id, data) => {
  return api.put(`/trails/${id}`, data)
}

export const deleteTrail = (id) => {
  return api.delete(`/trails/${id}`)
}

export const addTrailReview = (id, review) => {
  return api.post(`/trails/${id}/reviews`, review)
}

export const fetchTrailReviews = (id) => {
  return api.get(`/trails/${id}/reviews`)
}

export const fetchTrailConditions = (id) => {
  return api.get(`/trails/${id}/conditions`)
}

export const addTrailCondition = (id, report) => {
  return api.post(`/trails/${id}/conditions`, report)
}
