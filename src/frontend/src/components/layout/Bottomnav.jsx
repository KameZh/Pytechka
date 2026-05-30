import { useNavigate, useLocation } from 'react-router-dom'
import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/clerk-react'

const NAV_ITEMS = [
  {
    id: 'explore',
    label: 'Explore',
    path: '/',
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
  },
  {
    id: 'maps',
    label: 'Maps',
    path: '/maps',
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
        <line x1="9" y1="3" x2="9" y2="18" />
        <line x1="15" y1="6" x2="15" y2="21" />
      </svg>
    ),
  },
  {
    id: 'record',
    label: 'Record',
    path: '/record',
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  {
    id: 'events',
    label: 'Events',
    path: '/events',
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    id: 'account',
    label: 'Account',
    path: '/account',
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
]

export default function BottomNav() {
  const navigate = useNavigate()
  const location = useLocation()

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  return (
    <nav id="bottom-nav" className="bottom-nav">
      {NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          id={`nav-item-${item.id}`}
          className={`nav-item ${isActive(item.path) ? 'nav-item-active' : 'nav-item-inactive'}`}
          onClick={() => navigate(item.path)}
        >
          {item.id === 'account' ? (
            <>
              <SignedOut>
                <span
                  id={`nav-icon-${item.id}`}
                  className={`nav-icon ${isActive(item.path) ? 'nav-icon-active' : 'nav-icon-inactive'}`}
                >
                  {item.icon}
                </span>
                <span
                  id={`nav-label-${item.id}`}
                  className={`nav-label ${isActive(item.path) ? 'nav-label-active' : 'nav-label-inactive'}`}
                >
                  Sign In
                </span>
              </SignedOut>
              <SignedIn>
                <UserButton afterSignOutUrl="/" />
                <span
                  id={`nav-label-${item.id}`}
                  className={`nav-label ${isActive(item.path) ? 'nav-label-active' : 'nav-label-inactive'}`}
                >
                  {item.label}
                </span>
              </SignedIn>
            </>
          ) : (
            <>
              <span
                id={`nav-icon-${item.id}`}
                className={`nav-icon ${isActive(item.path) ? 'nav-icon-active' : 'nav-icon-inactive'}`}
              >
                {item.icon}
              </span>
              <span
                id={`nav-label-${item.id}`}
                className={`nav-label ${isActive(item.path) ? 'nav-label-active' : 'nav-label-inactive'}`}
              >
                {item.label}
              </span>
            </>
          )}
        </button>
      ))}
    </nav>
  )
}
