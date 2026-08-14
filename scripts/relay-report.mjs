#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

function count(entries, event) {
  return entries.filter((entry) => entry.event === event).length;
}

function sum(entries, select) {
  return entries.reduce((total, entry) => total + (Number(select(entry)) || 0), 0);
}

function requestRows(entries) {
  const requests = new Map();
  for (const entry of entries) {
    if (!entry.requestId) continue;
    const row = requests.get(entry.requestId) ?? {
      requestId: entry.requestId,
      clientRequestId: null,
      receivedAt: null,
      requestKind: null,
      fingerprint: null,
      submitted: false,
      promptSubmitted: false,
      outcome: "open",
      elapsedMs: null,
      pageId: null,
      traffic: null,
    };
    if (entry.clientRequestId) row.clientRequestId = entry.clientRequestId;
    if (entry.event === "request.received") row.receivedAt = entry.timestamp;
    if (entry.event === "request.validated") {
      row.requestKind = entry.requestKind;
      row.fingerprint = entry.prompt?.finalFingerprint ?? null;
    }
    if (entry.event === "generation.submitted") {
      row.submitted = true;
      row.promptSubmitted = true;
      row.pageId = entry.pageId ?? row.pageId;
      row.outcome = "streaming";
    }
    if (entry.event === "generation.done") {
      row.outcome = "complete";
      row.elapsedMs = entry.elapsedMs ?? null;
      row.pageId = entry.pageId ?? row.pageId;
      row.traffic = entry.metrics?.traffic ?? null;
    }
    if (entry.event === "generation.failed") {
      const protectionWarning = entry.protectionWarning === true
        || /temporarily limiting|making requests too quickly|temporarily limited access/i.test(entry.error ?? "");
      row.outcome = protectionWarning ? "protection-warning" : "failed";
      row.promptSubmitted = entry.promptSubmitted === true;
      row.elapsedMs = entry.elapsedMs ?? null;
      row.pageId = entry.pageId ?? row.pageId;
      row.traffic = entry.traffic ?? null;
    }
    if (entry.event === "request.duplicate") row.outcome = "duplicate-blocked";
    requests.set(entry.requestId, row);
  }
  return [...requests.values()].sort((left, right) =>
    String(right.receivedAt ?? "").localeCompare(String(left.receivedAt ?? ""))
  );
}

export function buildRelayReport(entries) {
  const lastStartIndex = entries.findLastIndex((entry) => entry.event === "relay.start");
  const current = lastStartIndex >= 0 ? entries.slice(lastStartIndex) : entries;
  const closedPages = current.filter((entry) => entry.event === "browser.page.closed");
  const latestHealth = [...current].reverse().find((entry) => entry.event === "relay.health.snapshot");
  const rows = requestRows(current);
  return {
    generatedAt: new Date().toISOString(),
    window: {
      startedAt: current[0]?.timestamp ?? null,
      endedAt: current.at(-1)?.timestamp ?? null,
      logEntries: current.length,
    },
    currentSession: {
      requestsReceived: count(current, "request.received"),
      duplicatesBlocked: count(current, "request.duplicate"),
      promptsSubmitted: count(current, "generation.submitted"),
      completed: count(current, "generation.done"),
      failed: count(current, "generation.failed"),
      protectionWarnings: current.filter(
        (entry) => entry.event === "generation.failed" && (
          entry.protectionWarning === true
          || /temporarily limiting|making requests too quickly|temporarily limited access/i.test(entry.error ?? "")
        ),
      ).length,
      cooldownsStarted: count(current, "account.cooldown.started"),
      cooldownsOverridden: count(current, "account.cooldown.overridden"),
      pagesOpened: count(current, "browser.page.opened"),
      pagesClosed: count(current, "browser.page.closed"),
      prewarms: count(current, "browser.prewarm.ready"),
      browserTraffic: {
        requests: sum(closedPages, (entry) => entry.traffic?.requests),
        chatgptApiRequests: sum(closedPages, (entry) => entry.traffic?.chatgptApiRequests),
        documentLoads: sum(closedPages, (entry) => entry.traffic?.documentLoads),
        failed: sum(closedPages, (entry) => entry.traffic?.failed),
        status403: sum(closedPages, (entry) => entry.traffic?.status403),
        status429: sum(closedPages, (entry) => entry.traffic?.status429),
        status5xx: sum(closedPages, (entry) => entry.traffic?.status5xx),
      },
      latestHealth: latestHealth?.session ?? null,
    },
    allTime: {
      relayStarts: count(entries, "relay.start"),
      requestsReceived: count(entries, "request.received"),
      promptsSubmitted: count(entries, "generation.submitted"),
      completed: count(entries, "generation.done"),
      failed: count(entries, "generation.failed"),
      cooldownsStarted: count(entries, "account.cooldown.started"),
      cooldownsOverridden: count(entries, "account.cooldown.overridden"),
    },
    recentRequests: rows.slice(0, 12),
  };
}

export function parseRelayLog(text) {
  return text
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value ?? 0);
}

function printReport(report, logPath) {
  const session = report.currentSession;
  process.stdout.write(`Rabbit Hole ChatGPT relay report\n`);
  process.stdout.write(`Log: ${logPath}\n`);
  process.stdout.write(`Current window: ${report.window.startedAt ?? "unknown"} → ${report.window.endedAt ?? "now"}\n\n`);
  process.stdout.write(`Requests: ${session.requestsReceived} received · ${session.promptsSubmitted} submitted · ${session.duplicatesBlocked} duplicates blocked\n`);
  process.stdout.write(`Outcomes: ${session.completed} complete · ${session.failed} failed · ${session.protectionWarnings} protection warnings · ${session.cooldownsStarted} cooldowns · ${session.cooldownsOverridden} overridden\n`);
  process.stdout.write(`Pages: ${session.pagesOpened} opened · ${session.pagesClosed} closed · ${session.prewarms} prewarmed\n`);
  process.stdout.write(
    `Browser traffic (closed pages): ${formatNumber(session.browserTraffic.requests)} total · ${formatNumber(session.browserTraffic.chatgptApiRequests)} ChatGPT API · ${formatNumber(session.browserTraffic.documentLoads)} documents\n`,
  );
  process.stdout.write(
    `HTTP alerts: ${session.browserTraffic.status403}×403 · ${session.browserTraffic.status429}×429 · ${session.browserTraffic.status5xx}×5xx · ${session.browserTraffic.failed} failed\n\n`,
  );
  process.stdout.write("Recent requests (prompt text is never logged):\n");
  if (!report.recentRequests.length) {
    process.stdout.write("  none\n");
    return;
  }
  for (const row of report.recentRequests) {
    const traffic = row.traffic
      ? ` · net ${row.traffic.requests}/${row.traffic.chatgptApiRequests} API`
      : "";
    process.stdout.write(
      `  ${row.receivedAt ?? "unknown"} ${row.requestId} client=${row.clientRequestId ?? "legacy"} ${row.outcome} submitted=${row.promptSubmitted}${traffic}\n`,
    );
  }
}

async function main() {
  const logPath = process.env.RABBIT_HOLE_RELAY_LOG?.trim()
    || join(process.cwd(), ".rabbit-hole", "chatgpt-relay.log");
  if (!existsSync(logPath)) throw new Error(`No relay log found at ${logPath}`);
  const report = buildRelayReport(parseRelayLog(readFileSync(logPath, "utf8")));
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  printReport(report, logPath);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
