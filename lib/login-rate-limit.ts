const MAX_FAILED_ATTEMPTS = 5;
const WINDOW_MS = 10 * 60 * 1000;

type LoginAttemptBucket = {
  failures: number;
  resetAt: number;
};

type LoginRateLimitStatus = {
  limited: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

const globalRateLimit = globalThis as typeof globalThis & {
  rabbitHoleLoginAttempts?: Map<string, LoginAttemptBucket>;
};

const loginAttempts = globalRateLimit.rabbitHoleLoginAttempts
  ?? new Map<string, LoginAttemptBucket>();

globalRateLimit.rabbitHoleLoginAttempts = loginAttempts;

function currentBucket(key: string, now: number): LoginAttemptBucket | undefined {
  const bucket = loginAttempts.get(key);
  if (bucket && bucket.resetAt > now) return bucket;
  if (bucket) loginAttempts.delete(key);
  return undefined;
}

function statusFor(bucket: LoginAttemptBucket | undefined, now: number): LoginRateLimitStatus {
  const failures = bucket?.failures ?? 0;
  return {
    limited: failures >= MAX_FAILED_ATTEMPTS,
    remaining: Math.max(0, MAX_FAILED_ATTEMPTS - failures),
    retryAfterSeconds: bucket ? Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) : 0,
  };
}

export function loginRateLimitStatus(key: string, now = Date.now()): LoginRateLimitStatus {
  return statusFor(currentBucket(key, now), now);
}

export function recordFailedLogin(key: string, now = Date.now()): LoginRateLimitStatus {
  const existing = currentBucket(key, now);
  const bucket = existing
    ? { ...existing, failures: existing.failures + 1 }
    : { failures: 1, resetAt: now + WINDOW_MS };

  loginAttempts.set(key, bucket);
  return statusFor(bucket, now);
}

export function clearFailedLogins(key: string): void {
  loginAttempts.delete(key);
}
