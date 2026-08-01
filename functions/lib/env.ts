export interface Env {
  DB: D1Database
  BUCKET: R2Bucket
  /** OAuth 2.0 Web client id from the Google Cloud project. Public. */
  GOOGLE_CLIENT_ID: string
  /** Random secret used to sign session cookies. */
  SESSION_SECRET: string
  /** Base64 of 32 random bytes, used to encrypt stored OpenRouter keys. */
  ENCRYPTION_KEY: string
}

export interface SessionUser {
  id: string
  email: string
  name: string
  picture: string | null
}

/** Populated by functions/api/_middleware.ts for every /api route. */
export interface ApiData extends Record<string, unknown> {
  user: SessionUser | null
}

export type Api<Params extends string = string> = PagesFunction<Env, Params, ApiData>
