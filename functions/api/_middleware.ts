import type { Api } from '../lib/env'
import { HttpError, errorResponse } from '../lib/http'
import { SESSION_COOKIE, readCookie, verifySessionToken } from '../lib/session'

/**
 * Resolves the session for every /api request and turns thrown HttpErrors into
 * JSON responses. Routes opt into auth by calling requireUser(data.user), which
 * keeps the public endpoints (/api/config, /api/auth/session) explicit.
 */
export const onRequest: Api = async (context) => {
  const { request, env, data, next } = context

  data.user = null
  const token = readCookie(request, SESSION_COOKIE)
  if (token && env.SESSION_SECRET) {
    try {
      data.user = await verifySessionToken(env.SESSION_SECRET, token)
    } catch {
      data.user = null
    }
  }

  try {
    return await next()
  } catch (err) {
    if (err instanceof HttpError) {
      return errorResponse(err.status, err.code, err.detail)
    }
    console.error('unhandled api error', err)
    return errorResponse(500, 'internal_error', err instanceof Error ? err.message : undefined)
  }
}
