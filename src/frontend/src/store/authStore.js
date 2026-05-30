import { create } from 'zustand'

const useAuthStore = create((set) => ({
  user: JSON.parse(localStorage.getItem('user')) || null,
  isAuthenticated: !!localStorage.getItem('user'),

  login: (userData) => {
    const user = {
      email: userData.email,
      userId: userData.userId,
      role: userData.role || 'user',
    }
    localStorage.setItem('user', JSON.stringify(user))
    set({ user, isAuthenticated: true })
  },

  logout: () => {
    localStorage.removeItem('user')
    localStorage.removeItem('token')
    set({ user: null, isAuthenticated: false })
  },

  hasRole: (role) => {
    const state = useAuthStore.getState()
    return state.user?.role === role
  },
}))

export default useAuthStore
