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

/**
 * Whether another attempt could succeed. `undefined` means no HTTP response; a
 * status below 400 on a failed attempt means the transfer broke after the
 * headers arrived, which is just as transient.
 */
export function isRetryableStatus(status: number | undefined): boolean {
  if (status === undefined || status < 400) return true
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

/**
 * Host and last path segment of a URL, which is enough to tell the release
 * archive from its checksums. The query and the rest of the path may carry
 * signatures, so they are dropped.
 */
export function describeUrl(url: string): string {
  try {
    const u = new URL(url)
    const name = u.pathname.split('/').filter(Boolean).pop()
    return name ? `${u.host}/…/${name}` : u.host
  } catch {
    return 'unknown host'
  }
}

/**
 * The tool's own error line, minus anything that could leak: wget's
 * `--server-response` prints each response header indented, so indented lines
 * (which can include a signed `Location`) are dropped, and every URL left is
 * reduced to its host.
 */
export function sanitizeDetail(stderr: string): string {
  const line = stderr.split(/\r?\n/).find(l => l.trim() && !/^\s/.test(l))
  if (!line) return ''
  return line
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/([^\s/?#'"]+)\S*?(?=:?(?:\s|$))/gi, '$1')
    .trim()
}

export interface DownloadFailure {
  url: string
  /** Final HTTP status; absent when the transfer failed before a response. */
  status?: number
  stderr: string
}

/** The error for a failed attempt: retryable unless the status is a permanent 4xx. */
export function downloadError(failure: DownloadFailure): Error {
  const host = describeUrl(failure.url).split('/')[0]
  const where = failure.status
    ? `${failure.status < 400 ? 'transfer interrupted after HTTP' : 'HTTP'} ${failure.status} from ${host}`
    : `no HTTP response from ${host}`
  const detail = sanitizeDetail(failure.stderr)
  const msg = `Could not download ${describeUrl(failure.url)} (${where})${detail ? `: ${detail}` : ''}`
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
