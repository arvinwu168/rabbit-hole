const SESSION_VERSION = "v1";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export const AUTH_COOKIE_NAME = "rabbit-hole-session";

function textBytes(value: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(value);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;

  for (let index = 0; index < maxLength; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }

  return difference === 0;
}

function configuredPassword(): string | undefined {
  return process.env.RABBIT_HOLE_PASSWORD?.trim() || undefined;
}

function signingSecret(): string {
  return process.env.RABBIT_HOLE_AUTH_SECRET?.trim()
    || `rabbit-hole-demo:${configuredPassword() || "password-not-configured"}`;
}

async function sha256(value: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", textBytes(value)));
}

async function sign(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    textBytes(signingSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, textBytes(value)));
}

export function isAuthDisabled(): boolean {
  return ["1", "true", "yes"].includes(
    process.env.RABBIT_HOLE_AUTH_DISABLED?.trim().toLowerCase() || "",
  );
}

export async function passwordMatches(candidate: unknown): Promise<boolean> {
  if (typeof candidate !== "string" || candidate.length > 256) return false;
  const password = configuredPassword();
  if (!password) return false;

  const [candidateDigest, passwordDigest] = await Promise.all([
    sha256(candidate),
    sha256(password),
  ]);
  return constantTimeEqual(candidateDigest, passwordDigest);
}

export async function createAuthToken(now = Date.now()): Promise<string> {
  const expiresAt = Math.floor(now / 1000) + SESSION_MAX_AGE_SECONDS;
  const payload = `${SESSION_VERSION}.${expiresAt}`;
  return `${payload}.${await sign(payload)}`;
}

export async function verifyAuthToken(token: string | undefined, now = Date.now()): Promise<boolean> {
  if (!token) return false;

  const [version, rawExpiresAt, signature, ...extra] = token.split(".");
  if (version !== SESSION_VERSION || !rawExpiresAt || !signature || extra.length) return false;

  const expiresAt = Number(rawExpiresAt);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1000)) return false;

  const expectedSignature = await sign(`${version}.${rawExpiresAt}`);
  return constantTimeEqual(signature, expectedSignature);
}

function cookieValue(cookieHeader: string | null, name: string): string | undefined {
  for (const part of cookieHeader?.split(";") ?? []) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }

  return undefined;
}

export async function isRequestAuthenticated(request: Request): Promise<boolean> {
  if (isAuthDisabled()) return true;
  if (!configuredPassword()) return false;
  return verifyAuthToken(cookieValue(request.headers.get("cookie"), AUTH_COOKIE_NAME));
}

export function authCookieOptions() {
  return {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}
