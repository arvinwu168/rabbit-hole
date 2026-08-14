import { NextResponse } from "next/server";
import {
  AUTH_COOKIE_NAME,
  authCookieOptions,
  createAuthToken,
  passwordMatches,
} from "@/lib/auth";
import {
  clearFailedLogins,
  loginRateLimitStatus,
  recordFailedLogin,
} from "@/lib/login-rate-limit";

function clientKey(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "local";
}

function rateLimitedResponse(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { error: "Too many password attempts. Please wait a few minutes and try again." },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(retryAfterSeconds),
      },
    },
  );
}

export async function POST(request: Request) {
  const key = clientKey(request);
  const currentLimit = loginRateLimitStatus(key);
  if (currentLimit.limited) return rateLimitedResponse(currentLimit.retryAfterSeconds);

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 1_024) {
    return NextResponse.json(
      { error: "Password request is too large." },
      { status: 413, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: unknown;
  try {
    const rawBody = await request.text();
    if (rawBody.length > 1_024) {
      return NextResponse.json(
        { error: "Password request is too large." },
        { status: 413, headers: { "Cache-Control": "no-store" } },
      );
    }
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: "Enter the shared password." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const password = typeof body === "object" && body !== null && "password" in body
    ? body.password
    : undefined;

  if (!(await passwordMatches(password))) {
    const nextLimit = recordFailedLogin(key);
    if (nextLimit.limited) return rateLimitedResponse(nextLimit.retryAfterSeconds);

    return NextResponse.json(
      { error: "That password is not correct." },
      {
        status: 401,
        headers: {
          "Cache-Control": "no-store",
          "X-RateLimit-Remaining": String(nextLimit.remaining),
        },
      },
    );
  }

  clearFailedLogins(key);
  const response = NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
  response.cookies.set(AUTH_COOKIE_NAME, await createAuthToken(), authCookieOptions());
  return response;
}
