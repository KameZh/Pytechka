import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ClerkProvider } from '@clerk/clerk-react'
import { registerSW } from 'virtual:pwa-register'
import { getAuthRedirectOrigin } from './utils/authRedirect'
import './index.css'
import App from './App.jsx'

registerSW({ immediate: true })

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', color: 'red', background: '#fff', zIndex: 9999, position: 'relative' }}>
          <h2>Something went wrong.</h2>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{this.state.error?.toString()}</pre>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{this.state.error?.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
const AUTH_REDIRECT_URL = '/'
const AUTH_REDIRECT_ORIGIN = getAuthRedirectOrigin()
const ALLOWED_REDIRECT_ORIGINS = [
  window.location.origin,
  AUTH_REDIRECT_ORIGIN,
  'https://localhost',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost',
  'capacitor://localhost',
]

function MissingEnv() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: '#0f172a',
        color: '#e2e8f0',
        padding: 24,
        textAlign: 'center',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <div
        style={{
          maxWidth: 520,
          background: 'rgba(30, 41, 59, 0.7)',
          border: '1px solid rgba(148, 163, 184, 0.5)',
          borderRadius: 12,
          padding: 20,
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.35)',
        }}
      >
        <h2 style={{ margin: '0 0 12px 0', fontSize: 22 }}>
          Configuration needed
        </h2>
        <p style={{ margin: '0 0 12px 0', lineHeight: 1.6 }}>
          Add required environment variables before the app can start:
        </p>
        <ul
          style={{
            listStyle: 'disc',
            textAlign: 'left',
            margin: '0 auto',
            padding: '0 0 0 18px',
            lineHeight: 1.5,
          }}
        >
          <li>
            <code>VITE_CLERK_PUBLISHABLE_KEY</code> — Clerk frontend key
          </li>
          <li>
            <code>VITE_MAPBOX_TOKEN</code> — Mapbox access token (for maps)
          </li>
        </ul>
        <p style={{ margin: '12px 0 0 0', lineHeight: 1.5, color: '#cbd5e1' }}>
          Create a .env file in pytechka-frontend with these values, then
          restart <code>npm run dev -- --host</code>.
        </p>
      </div>
    </div>
  )
}

const root = document.getElementById('root')

createRoot(root).render(
  PUBLISHABLE_KEY ? (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      signInFallbackRedirectUrl={AUTH_REDIRECT_URL}
      signInForceRedirectUrl={AUTH_REDIRECT_URL}
      signUpFallbackRedirectUrl={AUTH_REDIRECT_URL}
      signUpForceRedirectUrl={AUTH_REDIRECT_URL}
      allowedRedirectOrigins={[...new Set(ALLOWED_REDIRECT_ORIGINS)]}
    >
      <ErrorBoundary>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ErrorBoundary>
    </ClerkProvider>
  ) : (
    <MissingEnv />
  )
)
