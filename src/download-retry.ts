/**
 * Retry policy for the curl/wget downloads that bootstrap mise.
 *
 * Failed attempts wait for a capped exponential backoff with jitter. Only
 * transient failures are retried: transport errors (no HTTP status) and the
 * statuses 408, 429 and 5xx. Other 4xx responses and integrity failures end
 * the loop at once.
 */

export const DOWNLOAD_RETRIES = 5
const BASE_DELAY_MS = 2000
const MAX_DELAY_MS = 30_000

/** A failure that another attempt cannot fix. */
export class NonRetryableError extends Error {}

/** Whether another attempt could succeed. `undefined` means no HTTP response. */
export function isRetryableStatus(status: number | undefined): boolean {
  if (status === undefined || status === 0) return true
  return status === 408 || status === 429 || status >= 500
}

/**
 * Delay before retry number `retry` (0-based): 2s, 4s, 8s, 16s, 30s, each
 * randomized into the upper half of its range so parallel jobs spread out.
 */
export function backoffDelayMs(retry: number, random = Math.random): number {
  const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** retry)
  return Math.round(ceiling / 2 + (random() * ceiling) / 2)
}

/** Host of a URL, or a placeholder; never the path or query, which may be signed. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return 'unknown host'
  }
}

export interface DownloadFailure {
  url: string
  /** Final HTTP status; absent when the transfer failed before a response. */
  status?: number
  stderr: string
}

/** The error for a failed attempt: retryable unless the status is a permanent 4xx. */
export function downloadError(failure: DownloadFailure): Error {
  const where = failure.status
    ? `HTTP ${failure.status} from ${hostOf(failure.url)}`
    : `no HTTP response from ${hostOf(failure.url)}`
  const detail = failure.stderr.trim()
  const msg = `Could not download ${failure.url} (${where})${detail ? `: ${detail}` : ''}`
  return isRetryableStatus(failure.status)
    ? new Error(msg)
    : new NonRetryableError(msg)
}

export interface RetryOptions {
  retries?: number
  sleep?: (ms: number) => Promise<void>
  random?: () => number
  onRetry?: (message: string) => void
}

/** Run `attempt` until it succeeds, throws a `NonRetryableError`, or the retries are spent. */
export async function retryDownload<T>(
  attempt: (n: number) => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const retries = opts.retries ?? DOWNLOAD_RETRIES
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise(r => setTimeout(r, ms)))
  for (let retry = 0; ; retry++) {
    try {
      return await attempt(retry + 1)
    } catch (err) {
      if (err instanceof NonRetryableError || retry === retries) throw err
      const delay = backoffDelayMs(retry, opts.random)
      const reason = err instanceof Error ? err.message : String(err)
      opts.onRetry?.(
        `Download attempt ${retry + 1}/${retries + 1} failed: ${reason}. Retrying in ${(delay / 1000).toFixed(1)} seconds.`
      )
      await sleep(delay)
    }
  }
}
