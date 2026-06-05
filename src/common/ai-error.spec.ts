import {
  isRateLimitError,
  isTimeoutError,
  isAuthError,
  summarizeAiError,
  userFacingAiErrorMessage,
} from './ai-error';

// Shape mirrors the real openai-node RateLimitError instance we see in
// Railway logs (status + code + type + headers + requestID).
function buildRateLimitError(): any {
  return {
    status: 429,
    code: 'rate_limit_exceeded',
    type: 'tokens',
    message:
      'Rate limit reached for gpt-4o in organization org-X on tokens per min (TPM): Limit 30000, Used 30000, Requested 137.',
    requestID: 'req_5e4e899354fb41ad9e260a73b4ab2abb',
    headers: {
      'retry-after-ms': '274',
      'x-request-id': 'req_5e4e899354fb41ad9e260a73b4ab2abb',
    },
  };
}

describe('ai-error helpers', () => {
  describe('isRateLimitError', () => {
    it('recognizes a real 429 error shape', () => {
      expect(isRateLimitError(buildRateLimitError())).toBe(true);
    });

    it('returns false for a 500', () => {
      expect(isRateLimitError({ status: 500, message: 'oops' })).toBe(false);
    });

    it('returns false for a plain Error', () => {
      expect(isRateLimitError(new Error('boom'))).toBe(false);
    });

    it('returns false for null / undefined', () => {
      expect(isRateLimitError(null)).toBe(false);
      expect(isRateLimitError(undefined)).toBe(false);
    });
  });

  describe('isTimeoutError', () => {
    it('matches ETIMEDOUT code', () => {
      expect(isTimeoutError({ code: 'ETIMEDOUT', message: 'x' })).toBe(true);
    });
    it('matches "timeout" in message', () => {
      expect(isTimeoutError(new Error('Request timed out'))).toBe(true);
    });
  });

  describe('isAuthError', () => {
    it('recognizes 401 + 403', () => {
      expect(isAuthError({ status: 401, message: 'x' })).toBe(true);
      expect(isAuthError({ status: 403, message: 'x' })).toBe(true);
      expect(isAuthError({ status: 429, message: 'x' })).toBe(false);
    });
  });

  describe('summarizeAiError', () => {
    it('produces a single line with status / req / retry / message', () => {
      const line = summarizeAiError('weekly_overview', buildRateLimitError());
      expect(line).toContain('[weekly_overview]');
      expect(line).toContain('rate_limit');
      expect(line).toContain('status=429');
      expect(line).toContain('req=req_5e4e899354fb41ad9e260a73b4ab2abb');
      expect(line).toContain('retry=274ms');
      expect(line).not.toContain('\n'); // single-line
    });

    it('labels generic failures as unknown but still concise', () => {
      const line = summarizeAiError('coach', new Error('something broke'));
      expect(line).toContain('[coach] unknown');
      expect(line).toContain('something broke');
    });
  });

  describe('userFacingAiErrorMessage', () => {
    it('returns a friendly sentence for rate limits', () => {
      const msg = userFacingAiErrorMessage(buildRateLimitError());
      expect(msg).toMatch(/capacity|try again/i);
      expect(msg.endsWith('.')).toBe(true);
    });
    it('returns a different message for timeouts', () => {
      const msg = userFacingAiErrorMessage({ code: 'ETIMEDOUT', message: 'x' });
      expect(msg).toMatch(/too long|try/i);
    });
    it('returns a generic message for unknown errors', () => {
      const msg = userFacingAiErrorMessage(new Error('mystery'));
      expect(msg).toMatch(/something went wrong/i);
    });
  });
});
