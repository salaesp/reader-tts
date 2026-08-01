import type { Api } from '../lib/env'
import { json } from '../lib/http'

/**
 * Public bootstrap config. The OAuth client id lives in a Pages environment
 * variable rather than the bundle, so the same build works across environments.
 */
export const onRequestGet: Api = ({ env }) =>
  json({ googleClientId: env.GOOGLE_CLIENT_ID ?? '' })
