import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

const MAX_ROUTE_METRICS = 12;
const DEFAULT_IDEMPOTENCY_TTL_MS = 15 * 60 * 1_000;
const DEFAULT_IDEMPOTENCY_CAPACITY = 500;

export const CHATGPT_PROTECTION_MESSAGE =
  "ChatGPT is temporarily limiting this account. Rabbit Hole paused new ChatGPT launches so it does not make the restriction worse.";

export class ChatGptProtectionError extends Error {
  constructor(message = CHATGPT_PROTECTION_MESSAGE) {
    super(message);
    this.name = "ChatGptProtectionError";
    this.code = "CHATGPT_ACCOUNT_PROTECTION";
  }
}

export function isChatGptProtectionError(error, pattern) {
  if (error instanceof ChatGptProtectionError || error?.code === "CHATGPT_ACCOUNT_PROTECTION") {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  return Boolean(pattern?.test(message));
}

function increment(record, key, amount = 1) {
  record[key] = (record[key] ?? 0) + amount;
}

function normalizePath(pathname) {
  return pathname
    .replace(/\/c\/[^/]+/gi, "/c/:id")
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":id")
    .replace(/\/[A-Za-z0-9_-]{28,}(?=\/|$)/g, "/:id")
    .replace(/\d{6,}/g, ":n");
}

export function sanitizeNetworkTarget(input) {
  try {
    const url = new URL(input);
    const hostname = url.hostname.toLowerCase();
    const owner = hostname === "chatgpt.com" || hostname.endsWith(".chatgpt.com")
      ? "chatgpt"
      : hostname === "openai.com" || hostname.endsWith(".openai.com")
        ? "openai"
        : hostname === "oaistatic.com" || hostname.endsWith(".oaistatic.com")
          ? "static"
          : hostname === "oaiusercontent.com" || hostname.endsWith(".oaiusercontent.com")
            ? "content"
            : "other";
    const path = normalizePath(url.pathname || "/");
    return {
      owner,
      route: owner === "other" ? "other" : `${owner}:${path}`,
    };
  } catch {
    return { owner: "invalid", route: "invalid" };
  }
}

export class NetworkTrafficCounter {
  constructor({ startedAt = Date.now() } = {}) {
    this.startedAt = startedAt;
    this.requests = 0;
    this.responses = 0;
    this.failed = 0;
    this.documentLoads = 0;
    this.chatgptApiRequests = 0;
    this.firstPartyRequests = 0;
    this.status403 = 0;
    this.status429 = 0;
    this.status5xx = 0;
    this.methods = {};
    this.resourceTypes = {};
    this.owners = {};
    this.statusClasses = {};
    this.routes = new Map();
  }

  recordRequest({ url, method = "GET", resourceType = "other" }) {
    const target = sanitizeNetworkTarget(url);
    const normalizedMethod = String(method || "GET").toUpperCase();
    const normalizedType = String(resourceType || "other").toLowerCase();
    this.requests += 1;
    increment(this.methods, normalizedMethod);
    increment(this.resourceTypes, normalizedType);
    increment(this.owners, target.owner);
    if (target.owner !== "other" && target.owner !== "invalid") this.firstPartyRequests += 1;
    if (target.owner === "chatgpt" && normalizedType === "document") this.documentLoads += 1;
    if (target.owner === "chatgpt" && (normalizedType === "fetch" || normalizedType === "xhr")) {
      this.chatgptApiRequests += 1;
      const route = `${normalizedMethod} ${target.route}`;
      this.routes.set(route, (this.routes.get(route) ?? 0) + 1);
    }
  }

  recordResponse({ status }) {
    const numericStatus = Number(status);
    if (!Number.isFinite(numericStatus)) return;
    this.responses += 1;
    increment(this.statusClasses, `${Math.floor(numericStatus / 100)}xx`);
    if (numericStatus === 403) this.status403 += 1;
    if (numericStatus === 429) this.status429 += 1;
    if (numericStatus >= 500) this.status5xx += 1;
  }

  recordFailure() {
    this.failed += 1;
  }

  snapshot({ completedAt = Date.now() } = {}) {
    const topRoutes = [...this.routes.entries()]
      .map(([route, count]) => ({ route, count }))
      .sort((left, right) => right.count - left.count || left.route.localeCompare(right.route))
      .slice(0, MAX_ROUTE_METRICS);
    return {
      observedMs: Math.max(0, completedAt - this.startedAt),
      requests: this.requests,
      responses: this.responses,
      failed: this.failed,
      documentLoads: this.documentLoads,
      chatgptApiRequests: this.chatgptApiRequests,
      firstPartyRequests: this.firstPartyRequests,
      status403: this.status403,
      status429: this.status429,
      status5xx: this.status5xx,
      methods: { ...this.methods },
      resourceTypes: { ...this.resourceTypes },
      owners: { ...this.owners },
      statusClasses: { ...this.statusClasses },
      topRoutes,
    };
  }
}

export function attachPageTraffic(page, options = {}) {
  const counter = new NetworkTrafficCounter({ startedAt: options.startedAt });
  const onRequest = (request) => {
    counter.recordRequest({
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
    });
  };
  const onResponse = (response) => counter.recordResponse({ status: response.status() });
  const onRequestFailed = () => counter.recordFailure();
  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("requestfailed", onRequestFailed);
  return {
    snapshot: (snapshotOptions) => counter.snapshot(snapshotOptions),
    dispose: () => {
      page.off?.("request", onRequest);
      page.off?.("response", onResponse);
      page.off?.("requestfailed", onRequestFailed);
    },
  };
}

export function messageDiagnostics(rawMessages) {
  const messages = Array.isArray(rawMessages) ? rawMessages.filter(Boolean) : [];
  const finalMessage = messages.at(-1);
  const finalContent = typeof finalMessage?.content === "string" ? finalMessage.content : "";
  const totalCharacters = messages.reduce(
    (sum, message) => sum + (typeof message?.content === "string" ? message.content.length : 0),
    0,
  );
  return {
    messageCount: messages.length,
    userMessages: messages.filter((message) => message?.role === "user").length,
    assistantMessages: messages.filter((message) => message?.role === "assistant").length,
    anchorCount: messages.filter((message) => typeof message?.anchor === "string" && message.anchor.trim()).length,
    totalCharacters,
    finalCharacters: finalContent.length,
    finalFingerprint: finalContent
      ? createHash("sha256").update(finalContent).digest("hex").slice(0, 16)
      : null,
  };
}

function cleanIdentifier(value, maxLength = 96) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || !/^[A-Za-z0-9._:-]+$/.test(trimmed)) return null;
  return trimmed;
}

export function sanitizeClientContext(value) {
  if (!value || typeof value !== "object") return {};
  const requestKind = ["root", "branch", "quote-branch"].includes(value.requestKind)
    ? value.requestKind
    : "unknown";
  const clientStartedAt = Number(value.clientStartedAt);
  return {
    clientRequestId: cleanIdentifier(value.clientRequestId),
    chatId: cleanIdentifier(value.chatId),
    nodeId: cleanIdentifier(value.nodeId),
    requestKind,
    clientStartedAt: Number.isFinite(clientStartedAt) ? clientStartedAt : null,
  };
}

export class IdempotencyRegistry {
  constructor({ ttlMs = DEFAULT_IDEMPOTENCY_TTL_MS, capacity = DEFAULT_IDEMPOTENCY_CAPACITY } = {}) {
    this.ttlMs = ttlMs;
    this.capacity = capacity;
    this.entries = new Map();
  }

  cleanup(now = Date.now()) {
    for (const [key, entry] of this.entries) {
      if (now - entry.updatedAt > this.ttlMs) this.entries.delete(key);
    }
    while (this.entries.size > this.capacity) {
      this.entries.delete(this.entries.keys().next().value);
    }
  }

  claim(key, now = Date.now()) {
    if (!key) return true;
    this.cleanup(now);
    if (this.entries.has(key)) return false;
    this.entries.set(key, { status: "active", updatedAt: now });
    return true;
  }

  complete(key, now = Date.now()) {
    if (!key) return;
    this.entries.set(key, { status: "complete", updatedAt: now });
    this.cleanup(now);
  }

  release(key) {
    if (key) this.entries.delete(key);
  }
}

export class PersistentCooldownStore {
  constructor(path) {
    this.path = path;
    this.state = this.read();
    this.lastWriteError = null;
  }

  read() {
    if (!this.path || !existsSync(this.path)) return { cooldownUntil: 0, reason: null, requestId: null };
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8"));
      return {
        cooldownUntil: Number.isFinite(Number(parsed.cooldownUntil)) ? Number(parsed.cooldownUntil) : 0,
        reason: typeof parsed.reason === "string" ? parsed.reason : null,
        requestId: typeof parsed.requestId === "string" ? parsed.requestId : null,
      };
    } catch {
      return { cooldownUntil: 0, reason: null, requestId: null };
    }
  }

  start({ now = Date.now(), durationMs, reason, requestId }) {
    this.state = {
      cooldownUntil: Math.max(this.state.cooldownUntil, now + durationMs),
      reason: typeof reason === "string" ? reason.slice(0, 160) : "ChatGPT account protection warning",
      requestId: typeof requestId === "string" ? requestId : null,
    };
    try {
      this.write();
      this.lastWriteError = null;
    } catch (error) {
      this.lastWriteError = error instanceof Error ? error.message : String(error);
    }
    return { ...this.state, persisted: this.lastWriteError === null };
  }

  clear() {
    const previousCooldownUntil = this.state.cooldownUntil;
    this.state = { cooldownUntil: 0, reason: null, requestId: null };
    try {
      this.write();
      this.lastWriteError = null;
    } catch (error) {
      this.lastWriteError = error instanceof Error ? error.message : String(error);
    }
    return {
      ...this.state,
      previousCooldownUntil,
      persisted: this.lastWriteError === null,
    };
  }

  write() {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify({ version: 1, ...this.state }, null, 2)}\n`, {
      mode: 0o600,
    });
    renameSync(temporaryPath, this.path);
  }
}
