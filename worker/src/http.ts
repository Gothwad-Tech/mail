// =============================================================================
// Small HTTP helpers: JSON replies, errors, CORS and the CSRF origin check.
//
// Why CSRF check: the session is a cookie. Any site could try to POST to
// /api/mail/send and the browser would attach the cookie. So for every write
// we require the Origin header to be one of our own origins (unless the
// caller sends a Bearer token, which a browser page on another site cannot
// attach on its own).
// =============================================================================

import type { Config } from './config';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
    public extra?: Record<string, unknown>
  ) {
    super(message ?? code);
  }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });
}

export function errorResponse(err: unknown, config: Config): Response {
  if (err instanceof HttpError) {
    return json({ error: err.code, message: err.message, ...(err.extra ?? {}) }, err.status);
  }
  // Never leak internals. Full error goes to the Worker log (no secrets in it).
  console.error('unhandled_error', err instanceof Error ? err.message : String(err));
  return json(
    {
      error: 'internal_error',
      message: 'Something went wrong. Please try again.',
      ...(config.isProduction ? {} : { debug: err instanceof Error ? err.message : String(err) }),
    },
    500
  );
}

export function corsHeaders(origin: string | null, config: Config): Record<string, string> {
  if (!origin || !config.allowedOrigins.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

/** Writes must come from our own origin when using cookies (CSRF guard). */
export function assertSafeWrite(request: Request, config: Config): void {
  if (request.headers.get('authorization')) return; // Bearer callers are not CSRF-able
  const origin = request.headers.get('origin');
  if (!origin || !config.allowedOrigins.includes(origin)) {
    throw new HttpError(403, 'bad_origin', 'Write request from an unknown origin.');
  }
  const type = request.headers.get('content-type') || '';
  // A cross-site HTML form cannot send JSON, so this blocks a second class of CSRF.
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'unsupported_media_type', 'Send JSON with content-type application/json.');
  }
}

/** Reads a JSON body with a size cap so one request cannot exhaust memory. */
export async function readJson<T>(request: Request, maxBytes = 256 * 1024): Promise<T> {
  const declared = Number(request.headers.get('content-length') || '0');
  if (declared > maxBytes) throw new HttpError(413, 'payload_too_large');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new HttpError(413, 'payload_too_large');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body is not valid JSON.');
  }
}
