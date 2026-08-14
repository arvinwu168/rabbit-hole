"use client";

import { FormEvent, useState } from "react";
import { LoaderCircle } from "lucide-react";

function responseError(value: unknown): string | undefined {
  return typeof value === "object"
    && value !== null
    && "error" in value
    && typeof value.error === "string"
    ? value.error
    : undefined;
}

export function AccessLoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password || submitting) return;

    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
        cache: "no-store",
      });
      const result: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setError(responseError(result) || "Unable to unlock the demo. Please try again.");
        return;
      }

      window.location.replace("/");
    } catch {
      setError("Unable to reach the demo. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="access-form" onSubmit={submit}>
      <label htmlFor="access-password">Shared password</label>
      <input
        id="access-password"
        name="password"
        type="password"
        autoComplete="current-password"
        autoFocus
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        disabled={submitting}
      />
      <p className="access-error" role="alert" aria-live="polite">
        {error || "\u00a0"}
      </p>
      <button type="submit" disabled={!password || submitting}>
        {submitting ? <LoaderCircle className="spin" size={16} /> : null}
        {submitting ? "Opening…" : "Open demo"}
      </button>
    </form>
  );
}
