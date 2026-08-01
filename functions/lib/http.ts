import type { SessionUser } from './env'

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Everything under /api is user-specific.
      'cache-control': 'private, no-store',
      ...(init.headers as Record<string, string> | undefined),
    },
  })
}

export function errorResponse(status: number, error: string, detail?: string): Response {
  return json(detail ? { error, detail } : { error }, { status })
}

/** Thrown by requireUser and caught by the middleware. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail?: string,
  ) {
    super(code)
  }
}

export function requireUser(user: SessionUser | null): SessionUser {
  if (!user) throw new HttpError(401, 'unauthorized')
  return user
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T
  } catch {
    throw new HttpError(400, 'invalid_json')
  }
}

export function methodNotAllowed(allowed: string[]): Response {
  return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
    status: 405,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      allow: allowed.join(', '),
    },
  })
}
