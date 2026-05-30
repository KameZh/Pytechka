import { SignIn, useSignIn } from '@clerk/clerk-react'
import { buildAuthRedirectUrl } from '../utils/authRedirect'
import './Auth.css'

const clerkAppearance = {
  elements: {
    card: 'auth-clerk-root',
    headerTitle: 'auth-clerk-header-title',
    headerSubtitle: 'auth-clerk-header-subtitle',
    // Hide Clerk's own social buttons — we use our custom Google button instead
    // so the OAuth redirect always points to the current origin, not localhost.
    socialButtonsBlockButton: { display: 'none' },
    socialButtonsBlockButtonText: { display: 'none' },
    socialButtons: { display: 'none' },
    dividerRow: { display: 'none' },
    formButtonPrimary: 'auth-clerk-primary-btn',
    formFieldInput: 'auth-clerk-input',
    formFieldLabel: 'auth-clerk-label',
    footerActionLink: 'auth-clerk-link',
    dividerLine: 'auth-clerk-divider-line',
    dividerText: 'auth-clerk-divider-text',
    formFieldAction: 'auth-clerk-link',
  },
}

export default function Login() {
  const { isLoaded, signIn } = useSignIn()
  const authRedirectUrl =
    typeof window !== 'undefined' &&
    window.sessionStorage.getItem('pytechka.pendingPlannerRoute')
      ? '/maps'
      : '/'

  const handleGoogleSignIn = async () => {
    if (!isLoaded || !signIn) return

    try {
      await signIn.authenticateWithRedirect({
        strategy: 'oauth_google',
        redirectUrl: buildAuthRedirectUrl('/sso-callback'),
        redirectUrlComplete: buildAuthRedirectUrl(authRedirectUrl),
      })
    } catch (error) {
      console.error('Google sign-in redirect failed:', error)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-glow auth-glow-top" />
      <div className="auth-glow auth-glow-bottom" />

      <div className="auth-shell">
        <section className="auth-hero">
          <div className="auth-title-inline">
            <h1 className="auth-title">Welcome Back</h1>
            <span className="auth-badge">PYTECHKA ACCESS</span>
          </div>
          <p className="auth-subtitle">
            Log in to continue tracking routes, reviewing map layers, and saving
            your progress.
          </p>
        </section>

        <section className="auth-panel">
          {/* Custom Google button — uses window.location.origin so the OAuth
              callback always returns to this machine, not localhost. */}
          <button
            type="button"
            className="auth-google-direct-btn"
            onClick={handleGoogleSignIn}
            disabled={!isLoaded}
          >
            <svg className="auth-google-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>

          <SignIn
            routing="path"
            path="/login"
            signUpUrl="/signup"
            oauthFlow="redirect"
            fallbackRedirectUrl={authRedirectUrl}
            forceRedirectUrl={authRedirectUrl}
            signUpFallbackRedirectUrl="/signup"
            signUpForceRedirectUrl="/signup"
            appearance={clerkAppearance}
          />
        </section>
      </div>
    </div>
  )
}
