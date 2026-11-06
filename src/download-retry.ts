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

const CURL_EXIT_REASONS: Record<number, string> = {
  5: 'could not resolve proxy',
  6: 'could not resolve host',
  7: 'could not connect',
  16: 'HTTP/2 error',
  18: 'transfer ended early',
  23: 'could not write the file',
  28: 'timed out',
  35: 'TLS handshake failed',
  52: 'empty reply from server',
  55: 'send failed',
  56: 'receive failed',
  60: 'TLS certificate not trusted',
  92: 'HTTP/2 stream error'
}

const WGET_EXIT_REASONS: Record<number, string> = {
  3: 'could not write the file',
  4: 'network failure',
  5: 'TLS verification failed',
  8: 'server returned an error'
}

/**
 * A fixed phrase for the tool's exit code. The tool's own stderr is never
 * logged: it can carry signed URLs, credentials or response headers, so the
 * log gets an allowlisted reason and the exit code instead.
 */
export function exitReason(tool: 'curl' | 'wget', exitCode: number): string {
  const reasons = tool === 'curl' ? CURL_EXIT_REASONS : WGET_EXIT_REASONS
  const reason = reasons[exitCode]
  return `${tool} exit ${exitCode}${reason ? ` (${reason})` : ''}`
}

/**
 * Host reached by following `locations` (the `Location:` headers of a redirect
 * chain, which may be relative) from `url`; undefined when there were none or
 * one doesn't parse.
 */
export function redirectedHost(
  url: string,
  locations: string[]
): string | undefined {
  if (locations.length === 0) return undefined
  try {
    let current = new URL(url)
    for (const location of locations) current = new URL(location, current)
    return current.host || undefined
  } catch {
    return undefined
  }
}

/**
 * The status to blame for a failed attempt. A redirect status on a failed
 * transfer means the redirect target never answered, so it is not credited
 * with the previous hop's status.
 */
export function failedStatus(
  status: number | undefined,
  exitCode: number
): number | undefined {
  const redirected =
    exitCode !== 0 && status !== undefined && status >= 300 && status < 400
  return redirected ? undefined : status
}

/** Host of a URL (never its userinfo), or undefined when it doesn't parse. */
export function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host || undefined
  } catch {
    return undefined
  }
}

export interface DownloadFailure {
  url: string
  /** Final HTTP status; absent when the transfer failed before a response. */
  status?: number
  /** Host that sent the final response, which differs from `url` after a redirect. */
  host?: string
  /** The tool that ran and its exit code; their stderr is deliberately not kept. */
  tool?: 'curl' | 'wget'
  exitCode?: number
  /** The tool failed writing the file locally, which another attempt won't fix. */
  localError?: boolean
}

/** The error for a failed attempt: retryable unless the status is a permanent 4xx. */
export function downloadError(failure: DownloadFailure): Error {
  const host = failure.host ?? describeUrl(failure.url).split('/')[0]
  const where = failure.status
    ? `${failure.status < 400 ? 'transfer interrupted after HTTP' : 'HTTP'} ${failure.status} from ${host}`
    : `no HTTP response from ${host}`
  const detail =
    failure.tool && failure.exitCode
      ? `: ${exitReason(failure.tool, failure.exitCode)}`
      : ''
  const msg = `Could not download ${describeUrl(failure.url)} (${where})${detail}`
  return isRetryableStatus(failure.status) && !failure.localError
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
