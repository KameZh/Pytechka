import { AuthenticateWithRedirectCallback, useAuth } from '@clerk/clerk-react'
import { useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import { setClerkTokenGetter } from './api/client'
import { getUserProfile } from './api/auth'
import Signup from './pages/Signup'
import Login from './pages/Login'
import Home from './pages/Home'
import Explore from './pages/Explore'
import Maps from './pages/Maps'
import Record from './pages/Record'
import Events from './pages/Events'
import { useRecordingStore } from './store/recordingStore'

function App() {
  const { getToken, isSignedIn } = useAuth()
  const ensureWakeLock = useRecordingStore((state) => state.ensureWakeLock)
  const authReturnPath =
    typeof window !== 'undefined' &&
    window.sessionStorage.getItem('pytechka.pendingPlannerRoute')
      ? '/maps'
      : '/'

  setClerkTokenGetter(getToken)

  useEffect(() => {
    if (isSignedIn) {
      getUserProfile().catch((err) => console.error('User sync failed:', err))
    }
  }, [isSignedIn, getToken])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') ensureWakeLock()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [ensureWakeLock])

  return (
    <Routes>
      <Route path="/" element={<Explore />} />
      <Route path="/explore" element={<Explore />} />
      <Route path="/maps" element={<Maps />} />
      <Route path="/record" element={<Record />} />
      <Route path="/events" element={<Events />} />
      <Route path="/account" element={<Home />} />
      <Route path="/home" element={<Home />} />
      <Route
        path="/sso-callback"
        element={
          <AuthenticateWithRedirectCallback
            signInUrl="/login"
            signUpUrl="/signup"
            signInFallbackRedirectUrl={authReturnPath}
            signInForceRedirectUrl={authReturnPath}
            signUpFallbackRedirectUrl={authReturnPath}
            signUpForceRedirectUrl={authReturnPath}
          />
        }
      />
      <Route
        path="/login/sso-callback"
        element={
          <AuthenticateWithRedirectCallback
            signInUrl="/login"
            signUpUrl="/signup"
            signInFallbackRedirectUrl={authReturnPath}
            signInForceRedirectUrl={authReturnPath}
            signUpFallbackRedirectUrl={authReturnPath}
            signUpForceRedirectUrl={authReturnPath}
          />
        }
      />
      <Route
        path="/signup/sso-callback"
        element={
          <AuthenticateWithRedirectCallback
            signInUrl="/login"
            signUpUrl="/signup"
            signInFallbackRedirectUrl={authReturnPath}
            signInForceRedirectUrl={authReturnPath}
            signUpFallbackRedirectUrl={authReturnPath}
            signUpForceRedirectUrl={authReturnPath}
          />
        }
      />
      <Route path="/signup/*" element={<Signup />} />
      <Route path="/login/*" element={<Login />} />
    </Routes>
  )
}

export default App
