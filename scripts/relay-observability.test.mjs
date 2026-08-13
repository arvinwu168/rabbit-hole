import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ChatGptProtectionError,
  IdempotencyRegistry,
  NetworkTrafficCounter,
  PersistentCooldownStore,
  isChatGptProtectionError,
  messageDiagnostics,
  sanitizeClientContext,
  sanitizeNetworkTarget,
} from "./relay-observability.mjs";
import { buildRelayReport, parseRelayLog } from "./relay-report.mjs";

test("typed protection warnings cannot be lost when their public copy changes", () => {
  assert.equal(isChatGptProtectionError(new ChatGptProtectionError(), /unrelated/), true);
  assert.equal(
    isChatGptProtectionError(new Error("temporarily limiting this account"), /temporarily limiting/i),
    true,
  );
  assert.equal(isChatGptProtectionError(new Error("ordinary failure"), /temporarily limiting/i), false);
});

test("network diagnostics discard query strings, hosts outside OpenAI, and conversation identifiers", () => {
  const target = sanitizeNetworkTarget(
    "https://chatgpt.com/backend-api/conversation/123e4567-e89b-12d3-a456-426614174000?access_token=secret",
  );
  assert.deepEqual(target, {
    owner: "chatgpt",
    route: "chatgpt:/backend-api/conversation/:id",
  });
  assert.deepEqual(
    sanitizeNetworkTarget("https://analytics.example/private-user-id?token=secret"),
    { owner: "other", route: "other" },
  );
  assert.equal(JSON.stringify(target).includes("secret"), false);
});

test("traffic counters separate document loads, ChatGPT API calls, and HTTP alerts", () => {
  const traffic = new NetworkTrafficCounter({ startedAt: 1_000 });
  traffic.recordRequest({ url: "https://chatgpt.com/", method: "GET", resourceType: "document" });
  traffic.recordRequest({
    url: "https://chatgpt.com/backend-api/conversation",
    method: "POST",
    resourceType: "fetch",
  });
  traffic.recordRequest({ url: "https://cdn.example/app.js", method: "GET", resourceType: "script" });
  traffic.recordResponse({ status: 200 });
  traffic.recordResponse({ status: 429 });
  traffic.recordFailure();

  assert.deepEqual(traffic.snapshot({ completedAt: 1_500 }), {
    observedMs: 500,
    requests: 3,
    responses: 2,
    failed: 1,
    documentLoads: 1,
    chatgptApiRequests: 1,
    firstPartyRequests: 2,
    status403: 0,
    status429: 1,
    status5xx: 0,
    methods: { GET: 2, POST: 1 },
    resourceTypes: { document: 1, fetch: 1, script: 1 },
    owners: { chatgpt: 2, other: 1 },
    statusClasses: { "2xx": 1, "4xx": 1 },
    topRoutes: [{ route: "POST chatgpt:/backend-api/conversation", count: 1 }],
  });
});

test("prompt diagnostics are useful without storing prompt text", () => {
  const prompt = "private prompt contents";
  const diagnostics = messageDiagnostics([
    { role: "user", content: prompt, anchor: "quoted material" },
  ]);
  assert.equal(diagnostics.messageCount, 1);
  assert.equal(diagnostics.totalCharacters, prompt.length);
  assert.equal(diagnostics.anchorCount, 1);
  assert.equal(diagnostics.finalFingerprint.length, 16);
  assert.equal(JSON.stringify(diagnostics).includes(prompt), false);
});

test("client correlation accepts stable identifiers and rejects arbitrary text", () => {
  assert.deepEqual(sanitizeClientContext({
    clientRequestId: "node-123",
    chatId: "chat-456",
    nodeId: "node-123",
    requestKind: "quote-branch",
    clientStartedAt: 1_000,
  }), {
    clientRequestId: "node-123",
    chatId: "chat-456",
    nodeId: "node-123",
    requestKind: "quote-branch",
    clientStartedAt: 1_000,
  });
  assert.deepEqual(sanitizeClientContext({ clientRequestId: "not allowed spaces" }), {
    clientRequestId: null,
    chatId: null,
    nodeId: null,
    requestKind: "unknown",
    clientStartedAt: null,
  });
});

test("idempotency blocks duplicate client requests but releases attempts that never submit", () => {
  const registry = new IdempotencyRegistry({ ttlMs: 100, capacity: 4 });
  assert.equal(registry.claim("node-1", 1_000), true);
  assert.equal(registry.claim("node-1", 1_001), false);
  registry.release("node-1");
  assert.equal(registry.claim("node-1", 1_002), true);
  registry.complete("node-1", 1_003);
  assert.equal(registry.claim("node-1", 1_004), false);
  assert.equal(registry.claim("node-1", 1_200), true);
});

test("cooldown state survives a relay restart without storing credentials", () => {
  const directory = mkdtempSync(join(tmpdir(), "rabbit-hole-relay-state-"));
  const path = join(directory, "state.json");
  try {
    const first = new PersistentCooldownStore(path);
    first.start({ now: 1_000, durationMs: 3_600_000, reason: "protection", requestId: "abc123" });
    const second = new PersistentCooldownStore(path);
    assert.deepEqual(second.state, {
      cooldownUntil: 3_601_000,
      reason: "protection",
      requestId: "abc123",
    });
    assert.equal(readFileSync(path, "utf8").includes("token"), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the report correlates sanitized client, relay, outcome, and traffic records", () => {
  const entries = parseRelayLog([
    JSON.stringify({ timestamp: "2026-08-13T00:00:00Z", event: "relay.start" }),
    JSON.stringify({ timestamp: "2026-08-13T00:00:01Z", event: "request.received", requestId: "relay-1" }),
    JSON.stringify({
      timestamp: "2026-08-13T00:00:01Z",
      event: "request.validated",
      requestId: "relay-1",
      clientRequestId: "node-1",
      requestKind: "root",
      prompt: { finalFingerprint: "0123456789abcdef" },
    }),
    JSON.stringify({ timestamp: "2026-08-13T00:00:02Z", event: "generation.submitted", requestId: "relay-1" }),
    JSON.stringify({
      timestamp: "2026-08-13T00:00:03Z",
      event: "generation.done",
      requestId: "relay-1",
      elapsedMs: 2_000,
      metrics: { traffic: { requests: 10, chatgptApiRequests: 2 } },
    }),
  ].join("\n"));
  const report = buildRelayReport(entries);
  assert.equal(report.currentSession.promptsSubmitted, 1);
  assert.equal(report.recentRequests[0].clientRequestId, "node-1");
  assert.equal(report.recentRequests[0].outcome, "complete");
  assert.equal(report.recentRequests[0].traffic.requests, 10);
});
