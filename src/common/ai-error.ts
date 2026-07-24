/**
 * Classify an OpenAI-side failure into a single concise log line plus
 * a user-meaningful message. Without this, every rate-limit hit gets
 * its full stack trace + response headers + Cloudflare cookies dumped
 * into Railway logs — noisy, slow to scan, and the user-visible path
 * (Coach SSE error event, dashboard fallback) collapses everything to
 * the unhelpful "Stream failed" / silent fallback.
 *
 * The helpers below let callers:
 *   1. Detect the common failure modes (rate limit, timeout, auth,
 *      generic network) without import-coupling to the OpenAI SDK's
 *      private error classes.
 *   2. Log a single line that captures status + reason + request id.
 *   3. Surface a stable, friendly message to the iOS client when the
 *      failure is user-visible (Coach chat).
 */

import { t, type Lang } from './i18n';

type MaybeError = unknown;

interface RecognizedError {
  status: number | null;
  code: string | null;
  type: string | null;
  message: string;
  requestId: string | null;
  retryAfterMs: number | null;
}

function asObject(err: MaybeError): Record<string, any> | null {
  if (err && typeof err === 'object') return err as Record<string, any>;
  return null;
}

function recognize(err: MaybeError): RecognizedError {
  const obj = asObject(err);
  const status =
    typeof obj?.status === 'number'
      ? obj.status
      : typeof obj?.statusCode === 'number'
        ? obj.statusCode
        : null;
  const code = typeof obj?.code === 'string' ? obj.code : null;
  const type = typeof obj?.type === 'string' ? obj.type : null;
  const message =
    typeof obj?.message === 'string'
      ? obj.message
      : typeof obj?.error?.message === 'string'
        ? obj.error.message
        : String(err);
  const requestId =
    typeof obj?.requestID === 'string'
      ? obj.requestID
      : typeof obj?.headers?.['x-request-id'] === 'string'
        ? obj.headers['x-request-id']
        : null;
  const retryAfterMs = (() => {
    const headers = obj?.headers;
    if (!headers || typeof headers !== 'object') return null;
    const raw = headers['retry-after-ms'] ?? headers['retry-after'];
    if (typeof raw !== 'string') return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    // retry-after is in seconds; retry-after-ms is in ms. Disambiguate
    // by header name presence.
    return headers['retry-after-ms'] ? n : n * 1000;
  })();
  return { status, code, type, message, requestId, retryAfterMs };
}

export function isRateLimitError(err: MaybeError): boolean {
  const r = recognize(err);
  return (
    r.status === 429 ||
    r.code === 'rate_limit_exceeded' ||
    r.type === 'tokens' ||
    r.type === 'requests'
  );
}

export function isTimeoutError(err: MaybeError): boolean {
  const r = recognize(err);
  return (
    r.code === 'ETIMEDOUT' ||
    r.code === 'ECONNRESET' ||
    r.code === 'ECONNABORTED' ||
    /timeout|timed[\s-]?out/i.test(r.message)
  );
}

export function isAuthError(err: MaybeError): boolean {
  const r = recognize(err);
  return r.status === 401 || r.status === 403;
}

export function isContentFilterError(err: MaybeError): boolean {
  const r = recognize(err);
  return r.code === 'content_filter';
}

/**
 * One-line summary suitable for `console.warn` / Railway logs. Avoids
 * dumping headers, cookies, or stack traces — only the fields a human
 * triaging the log actually needs.
 *
 * Format: `[<feature>] <kind> from OpenAI (status=429 req=req_abc retry=274ms): <message>`
 */
export function summarizeAiError(feature: string, err: MaybeError): string {
  const r = recognize(err);
  let kind: string;
  if (isRateLimitError(err)) kind = 'rate_limit';
  else if (isTimeoutError(err)) kind = 'timeout';
  else if (isAuthError(err)) kind = 'auth';
  else if (isContentFilterError(err)) kind = 'content_filter';
  else if (r.status && r.status >= 500) kind = 'upstream_5xx';
  else kind = 'unknown';

  const parts: string[] = [`[${feature}] ${kind}`];
  if (r.status) parts.push(`status=${r.status}`);
  if (r.requestId) parts.push(`req=${r.requestId}`);
  if (r.retryAfterMs) parts.push(`retry=${r.retryAfterMs}ms`);
  return `${parts.join(' ')}: ${r.message}`;
}

/**
 * Friendly, single-sentence message for iOS to render. Stable enough
 * that the client can pattern-match on it if needed, but plain English
 * so it can just show the raw string. Always returns a complete
 * sentence ending in a period.
 */
export function userFacingAiErrorMessage(
  err: MaybeError,
  lang: Lang = 'en',
): string {
  if (isRateLimitError(err)) {
    return t(lang, 'coach.error.rate_limit');
  }
  if (isTimeoutError(err)) {
    return t(lang, 'coach.error.timeout');
  }
  if (isContentFilterError(err)) {
    return t(lang, 'coach.error.content_filter');
  }
  if (isAuthError(err)) {
    return t(lang, 'coach.error.auth');
  }
  const r = recognize(err);
  if (r.status && r.status >= 500) {
    return t(lang, 'coach.error.upstream');
  }
  return t(lang, 'coach.error.generic');
}
