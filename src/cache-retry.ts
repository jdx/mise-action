/**
 * Retry cache restores and saves that GitHub throttles with HTTP 429.
 *
 * `@actions/cache` swallows the 429: it logs a warning and reports a miss
 * (restore) or `-1` (save), so callers can't see the error. Its warnings are
 * the only signal (a throttled save reservation is rethrown as a reservation conflict and logged only at debug level), so `captureWarnings` records the `::warning::` commands
 * written while an attempt runs and `detectThrottle` matches the messages
 * `@actions/cache` emits for a 429. This depends on that wording; if it
 * changes, throttling goes undetected and behavior falls back to no retries.
 */

const MAX_JITTER_MS = 2000
const DEFAULT_RETRY_AFTER_MS = 1000

export interface Throttle {
  /** Delay advertised by `Retry-After`, absent when the header wasn't sent. */
  retryAfterMs?: number
}

export interface RetryOptions {
  /** Total time the retry delays may add up to. 0 disables retrying. */
  budgetMs: number
  sleep?: (ms: number) => Promise<void>
  /** Returns a number in [0, 1), like `Math.random`. */
  random?: () => number
  onRetry?: (delayMs: number, remainingMs: number) => void
}

/** Parse `60s`, `500ms`, `2m` or `1h`. A bare number is seconds. */
export function parseDuration(input: string, name = 'duration'): number {
  const trimmed = input.trim()
  if (trimmed === '') return 0
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/i.exec(trimmed)
  if (!match) {
    throw new Error(
      `${name} must be a duration like 60s, 2m or 0s, got: ${input}`
    )
  }
  const unit = (match[2] ?? 's').toLowerCase()
  const factor = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[unit] as number
  return Math.round(Number(match[1]) * factor)
}

/**
 * Find a throttle in the warnings emitted by one cache call. Returns
 * `undefined` for anything else, including cache misses and reservation
 * conflicts.
 */
export function detectThrottle(warnings: string[]): Throttle | undefined {
  // A 429 while reserving a save is rethrown as a `ReserveCacheError`
  // (logged at info, so only its debug line carries the cause); a bare
  // "hit a rate limit" warning is only ever logged for a 429.
  const throttled = warnings.some(
    w =>
      /^Failed to (?:restore|save): Rate limited:/.test(w) ||
      /^Failed to (?:restore|save): .*\(429\)/.test(w) ||
      /^Failed to reserve cache: .*Rate limited:/.test(w) ||
      /^You've hit a rate limit/.test(w)
  )
  if (!throttled) return undefined
  for (const w of warnings) {
    const m = /rate limit will reset in (\d+) seconds/.exec(w)
    if (m) return { retryAfterMs: Number(m[1]) * 1000 }
  }
  return {}
}

/**
 * Run `attempt` until it isn't throttled or the next delay no longer fits in
 * the budget. Each delay is `Retry-After` (1s when absent) plus jitter in
 * [0, 2s], and the whole delay counts against the budget. When the budget
 * runs out the last (throttled) result is returned unchanged, so the caller's
 * existing fallback applies.
 */
export async function retryOnThrottle<T>(
  attempt: () => Promise<{ value: T; throttle?: Throttle }>,
  opts: RetryOptions
): Promise<T> {
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise(r => setTimeout(r, ms)))
  const random = opts.random ?? Math.random
  let remaining = opts.budgetMs
  for (;;) {
    const { value, throttle } = await attempt()
    if (!throttle) return value
    const delay =
      (throttle.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS) +
      Math.floor(random() * (MAX_JITTER_MS + 1))
    if (delay > remaining) return value
    remaining -= delay
    opts.onRetry?.(delay, remaining)
    await sleep(delay)
  }
}

/** Run `fn` and collect the `::warning::` and `::debug::` messages it writes to stdout. */
export async function captureWarnings<T>(
  fn: () => Promise<T>
): Promise<{ value: T; warnings: string[] }> {
  const warnings: string[] = []
  const original = process.stdout.write
  let pending = ''
  const collect = (chunk: string): void => {
    pending += chunk
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() ?? ''
    for (const line of lines) {
      const m = /^::(?:warning|debug)(?: [^:]*)?::(.*)$/.exec(line)
      if (m) warnings.push(decodeData(m[1]))
    }
  }
  process.stdout.write = function (
    this: unknown,
    chunk: unknown,
    ...rest: unknown[]
  ): boolean {
    collect(
      typeof chunk === 'string'
        ? chunk
        : Buffer.from(chunk as Uint8Array).toString()
    )
    return (original as (...a: unknown[]) => boolean).call(
      process.stdout,
      chunk,
      ...rest
    )
  } as typeof process.stdout.write
  try {
    const value = await fn()
    return { value, warnings }
  } finally {
    process.stdout.write = original
  }
}

function decodeData(s: string): string {
  return s.replace(/%0D/gi, '\r').replace(/%0A/gi, '\n').replace(/%25/g, '%')
}

/** Call a cache operation, retrying while GitHub throttles it with a 429. */
export async function withThrottleRetry<T>(
  op: () => Promise<T>,
  opts: RetryOptions
): Promise<T> {
  if (opts.budgetMs <= 0) return op()
  return retryOnThrottle(async () => {
    const { value, warnings } = await captureWarnings(op)
    return { value, throttle: detectThrottle(warnings) }
  }, opts)
}
