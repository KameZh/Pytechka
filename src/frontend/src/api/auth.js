import api from './client'

export async function getUserProfile() {
  const { data } = await api.get('/user/profile')
  return data
}

export async function updateUserProfile(updates) {
  const { data } = await api.put('/user/profile', updates)
  return data
}

export async function deleteAccount() {
  const { data } = await api.delete('/user/profile')
  return data
}

export async function signup(email, password) {
  const res = await fetch('/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error('Server returned an invalid response. Is the backend running?');
  }

  if (!res.ok) throw new Error(data.message || 'Signup failed');
  return data;
}

export async function login(email, password) {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error('Server returned an invalid response. Is the backend running?');
  }

  if (!res.ok) throw new Error(data.message || 'Login failed');
  return data;
}
