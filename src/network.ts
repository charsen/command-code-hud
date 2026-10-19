export interface CapturedRequest {
  url: string
  method: string
  headers: Record<string, string>
}

export interface CapturedFetch {
  url: string
  status: number
  body?: string
  request?: CapturedRequest
}

type FetchLike = (input: unknown, init?: unknown) => Promise<Response>

interface FetchState {
  original: FetchLike
  handler?: (capture: CapturedFetch) => void
  capture?: (input: unknown, init: unknown, response: Response) => void
  mutable?: boolean
}

const STATE_KEY = Symbol.for('command-code-hud.fetch-interceptor')
const USAGE_URL = /api\.commandcode\.ai\/.*(?:billing|credits|usage)|billing\/credits/i

function redactUrl(url: string): string {
  return url.replace(
    /([?&](?:token|key|auth|session|sig|signature)[^=]*=)[^&]+/gi,
    '$1<redacted>',
  )
}

function headersToRecord(headers: unknown): Record<string, string> {
  const record: Record<string, string> = {}
  if (!headers) return record
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      record[key] = value
    })
    return record
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      if (typeof key === 'string' && typeof value === 'string') record[key] = value
    }
    return record
  }
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (typeof value === 'string') record[key] = value
  }
  return record
}

function captureResponse(
  state: FetchState,
  input: unknown,
  init: unknown,
  response: Response,
): void {
  try {
    const handler = state.handler
    if (!handler) return
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request | undefined)?.url
    if (!url || !USAGE_URL.test(url)) return

    const request = input instanceof Request ? input : undefined
    const initObject =
      init && typeof init === 'object' ? (init as RequestInit) : undefined
    const capturedRequest: CapturedRequest = {
      // Keep the raw URL for replay; only the persisted copy is redacted.
      url,
      method: request?.method ?? initObject?.method ?? 'GET',
      headers: headersToRecord(request?.headers ?? initObject?.headers),
    }

    const clone = response.clone()
    void clone
      .text()
      .then(body =>
        handler({
          url: redactUrl(url),
          status: response.status,
          body,
          request: capturedRequest,
        }),
      )
      .catch(() => {})
  } catch {
    // Never interfere with the host's request.
  }
}

export function interceptFetch(handler: (capture: CapturedFetch) => void): void {
  const globalScope = globalThis as typeof globalThis & {
    [STATE_KEY]?: FetchState
  }
  let state = globalScope[STATE_KEY]

  if (!state) {
    const original = globalScope.fetch as FetchLike | undefined
    if (typeof original !== 'function') return
    state = { original }
    globalScope[STATE_KEY] = state
  }

  state.handler = handler
  state.capture = (input, init, response) => {
    captureResponse(state as FetchState, input, init, response)
  }

  // Install the wrapper once. On later hot reloads the wrapper reads the
  // mutable `capture` above, so we never replace another mod's wrapper.
  if (state.mutable) return
  state.mutable = true
  const original = state.original
  globalScope.fetch = async (input: unknown, init?: unknown) => {
    const response = await original(input, init)
    const current = globalScope[STATE_KEY]
    current?.capture?.(input, init, response)
    return response
  }
}
