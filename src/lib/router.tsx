import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * Minimal history-API router. The app has four screens, so a full routing
 * library would be more surface than it earns.
 */

export type Route =
  | { name: 'library' }
  | { name: 'reader'; bookId: string }
  | { name: 'settings' }

interface RouterValue {
  route: Route
  navigate: (route: Route, opts?: { replace?: boolean }) => void
}

const RouterContext = createContext<RouterValue | null>(null)

export function pathOf(route: Route): string {
  switch (route.name) {
    case 'library':
      return '/'
    case 'reader':
      return `/read/${encodeURIComponent(route.bookId)}`
    case 'settings':
      return '/settings'
  }
}

export function parsePath(pathname: string): Route {
  const read = /^\/read\/([^/]+)\/?$/.exec(pathname)
  if (read) return { name: 'reader', bookId: decodeURIComponent(read[1]) }
  if (pathname.replace(/\/$/, '') === '/settings') return { name: 'settings' }
  return { name: 'library' }
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(() => parsePath(window.location.pathname))

  useEffect(() => {
    const onPop = () => setRoute(parsePath(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback((next: Route, opts?: { replace?: boolean }) => {
    const path = pathOf(next)
    if (opts?.replace) window.history.replaceState({}, '', path)
    else window.history.pushState({}, '', path)
    setRoute(next)
    window.scrollTo(0, 0)
  }, [])

  const value = useMemo(() => ({ route, navigate }), [route, navigate])
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}

export function useRouter(): RouterValue {
  const ctx = useContext(RouterContext)
  if (!ctx) throw new Error('useRouter must be used inside RouterProvider')
  return ctx
}
