/**
 * Google Identity Services loader.
 *
 * The popup flow is used rather than a redirect: on Android and iOS a redirect
 * to accounts.google.com kicks an installed PWA out of standalone mode and the
 * user never comes back to the app window.
 */

interface CredentialResponse {
  credential: string
}

interface GoogleAccountsId {
  initialize: (config: {
    client_id: string
    callback: (response: CredentialResponse) => void
    ux_mode?: 'popup' | 'redirect'
    auto_select?: boolean
    cancel_on_tap_outside?: boolean
    use_fedcm_for_prompt?: boolean
  }) => void
  renderButton: (
    parent: HTMLElement,
    options: {
      type?: 'standard' | 'icon'
      theme?: 'outline' | 'filled_blue' | 'filled_black'
      size?: 'small' | 'medium' | 'large'
      shape?: 'rectangular' | 'pill'
      text?: 'signin_with' | 'signup_with' | 'continue_with'
      locale?: string
      width?: number
    },
  ) => void
  disableAutoSelect: () => void
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } }
  }
}

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client'
let scriptPromise: Promise<GoogleAccountsId> | null = null

export function loadGoogleIdentity(): Promise<GoogleAccountsId> {
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve(window.google.accounts.id)
      return
    }

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`)
    const script = existing ?? document.createElement('script')

    const onLoad = (): void => {
      if (window.google?.accounts?.id) resolve(window.google.accounts.id)
      else reject(new Error('Google Identity Services loaded without accounts.id'))
    }

    script.addEventListener('load', onLoad, { once: true })
    script.addEventListener(
      'error',
      () => {
        scriptPromise = null
        reject(new Error('failed to load Google Identity Services'))
      },
      { once: true },
    )

    if (!existing) {
      script.src = SCRIPT_SRC
      script.async = true
      script.defer = true
      document.head.appendChild(script)
    }
  })

  return scriptPromise
}

export function signOutOfGoogle(): void {
  try {
    window.google?.accounts.id.disableAutoSelect()
  } catch {
    // The library may not be loaded; nothing to clear in that case.
  }
}
