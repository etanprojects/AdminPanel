import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts'
import type { AppConfig } from './types'

/**
 * Logowanie przez serwer OpenID Connect (Authorization Code + PKCE).
 * Wymaga, żeby w konfiguracji klienta na serwerze OIDC był zarejestrowany redirect URI
 * (origin tej aplikacji z "/") oraz dozwolony CORS dla tego originu (discovery + token endpoint).
 */
let manager: UserManager | null = null
let authEnabled = false

export function initAuth(config: AppConfig) {
  authEnabled = config.auth.enabled
  if (!authEnabled) return
  const redirect = window.location.origin + '/'
  manager = new UserManager({
    authority: config.auth.authority,
    client_id: config.auth.clientId,
    scope: config.auth.scope,
    redirect_uri: redirect,
    silent_redirect_uri: redirect,
    post_logout_redirect_uri: redirect,
    response_type: 'code',
    automaticSilentRenew: true,
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  })
}

/** Zwraca zalogowanego użytkownika albo przekierowuje na stronę logowania (wtedy zwraca null). */
export async function ensureLoggedIn(): Promise<User | null> {
  if (!manager) return null

  // odpowiedź z iframe przy cichym odnawianiu tokenu
  if (window.self !== window.top) {
    await manager.signinSilentCallback()
    return null
  }

  const params = new URLSearchParams(window.location.search)
  if (params.has('code') && params.has('state')) {
    const user = await manager.signinRedirectCallback()
    const target = typeof user.state === 'string' ? user.state : '/'
    window.history.replaceState({}, document.title, target)
    return user
  }
  if (params.has('error')) {
    throw new Error(`Logowanie nieudane: ${params.get('error')} ${params.get('error_description') ?? ''}`)
  }

  const user = await manager.getUser()
  if (user && !user.expired) return user

  await manager.signinRedirect({ state: window.location.pathname + window.location.search })
  return null
}

export async function getAccessToken(forceRenew = false): Promise<string | null> {
  if (!authEnabled || !manager) return null
  let user = await manager.getUser()
  if (forceRenew || !user || user.expired || (user.expires_in ?? 0) < 60) {
    try {
      user = await manager.signinSilent()
    } catch {
      await manager.signinRedirect({ state: window.location.pathname })
      return null
    }
  }
  return user?.access_token ?? null
}

export async function getUserName(): Promise<string | null> {
  if (!manager) return null
  const u = await manager.getUser()
  return (u?.profile.name as string) ?? (u?.profile.preferred_username as string) ?? u?.profile.sub ?? null
}

export async function logout() {
  await manager?.signoutRedirect()
}

export const isAuthEnabled = () => authEnabled
