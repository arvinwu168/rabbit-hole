"use client";

import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Copy,
  Ellipsis,
  ExternalLink,
  FlaskConical,
  GitBranch,
  LoaderCircle,
  Lock,
  LogIn,
  MessageSquare,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PlugZap,
  Plus,
  Quote,
  Rabbit,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  SquarePen,
  Sun,
  Terminal,
  UserRound,
  X,
  Zap,
} from "lucide-react";
import {
  FormEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChatTree,
  QuoteAnchor,
  RelayLatencyMetrics,
  RelayTrafficMetrics,
  TurnNode,
  WorkspaceState,
  buildContinuationMessages,
  createEmptyWorkspace,
  getAncestorIds,
  getChildren,
  getNodePath,
  makeChatTitle,
} from "@/lib/conversation-tree";
import { createRandomDemoChats } from "@/lib/demo-trees";
import {
  MOCK_FIXTURES,
  getMockFixtureSelection,
  type MockFixtureId,
  type MockFixtureSelection,
} from "@/lib/mock-fixtures";
import {
  AUTOMATIC_OUTPUT_TOKENS,
  DEFAULT_INFERENCE_OPTION_ID,
  DEFAULT_MAX_OUTPUT_TOKENS,
  INFERENCE_OPTION_GROUPS,
  INFERENCE_OPTIONS,
  OUTPUT_TOKEN_OPTIONS,
  modelLabelForId,
  type InferenceOptionId,
  type OutputTokenLimit,
  type OutputTokenSetting,
} from "@/lib/inference-options";
import {
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  oppositeColorTheme,
  resolveColorTheme,
  type ColorTheme,
} from "@/lib/theme";
import { isExperimentModeAvailable } from "@/lib/experiment-mode";

const LEGACY_WORKSPACE_STORAGE_KEY = "rabbit-hole-workspace-v1";
const GUEST_WORKSPACE_STORAGE_KEY = "rabbit-hole-guest-workspace-v1";
const LEGACY_DEMO_CHAT_IDS = new Set([
  "chat-free-tier",
  "chat-onboarding",
  "chat-conference",
]);
const MODEL_CONTROLS_STORAGE_KEY = "rabbit-hole-model-controls-visible";
const DEV_MODE_STORAGE_KEY = "rabbit-hole-dev-mode";
const RELAY_TOKEN_STORAGE_KEY = "rabbit-hole-chatgpt-relay-token";
const NATIVE_BRANCH_FROM_SELECTION_EVENT = "rabbit-hole:native-branch-from-selection";
const CHATGPT_RELAY_URL = "http://127.0.0.1:43119";
const EXPERIMENT_MODE_AVAILABLE = isExperimentModeAvailable();

type LoopbackRequestInit = RequestInit & {
  targetAddressSpace?: "loopback";
};

function fetchRelay(path: string, init: RequestInit = {}) {
  return fetch(`${CHATGPT_RELAY_URL}${path}`, {
    ...init,
    targetAddressSpace: "loopback",
  } as LoopbackRequestInit);
}

function fetchInference(usingRelay: boolean, init: RequestInit) {
  return usingRelay ? fetchRelay("/chat", init) : fetch("/api/chat", init);
}

type RelayStatus =
  | "disconnected"
  | "checking"
  | "ready"
  | "rate-limited"
  | "login-required"
  | "offline"
  | "unauthorized";

type RelayConnectionCheckOptions = {
  background?: boolean;
};

type RelaySessionDiagnostics = {
  uptimeMs: number;
  requestsReceived: number;
  duplicateRequests: number;
  submissions: number;
  completed: number;
  failed: number;
  protectionWarnings: number;
  cooldownStarts: number;
  cooldownOverrides: number;
  pagesOpened: number;
  pagesClosed: number;
  activePages: number;
  peakPages: number;
  prewarmEnabled: boolean;
  maxConcurrentGenerations: number;
  traffic: RelayTrafficMetrics;
};

type ComposerCommandOption = {
  id: string;
  command: string;
  label: string;
  description: string;
  action:
    | "open-fixtures"
    | "open-demos"
    | "show-help"
    | "select-fixture"
    | "demo-tree"
    | "demo-forest";
  fixture?: MockFixtureSelection;
};

const DEMO_COMMANDS: ComposerCommandOption[] = [
  {
    id: "demo-tree",
    command: "/demo tree",
    label: "Generate one tree",
    description: "Add one randomized conversation tree without calling a model.",
    action: "demo-tree",
  },
  {
    id: "demo-forest",
    command: "/demo forest",
    label: "Generate a forest",
    description: "Add several randomized conversation trees without calling a model.",
    action: "demo-forest",
  },
];

const ROOT_COMMANDS: ComposerCommandOption[] = [
  {
    id: "fixture-picker",
    command: "/fixture",
    label: "Choose a mock fixture",
    description: "Run a deterministic Mock response as an immediate test turn.",
    action: "open-fixtures",
  },
  {
    id: "demo-picker",
    command: "/demo",
    label: "Generate demo conversations",
    description: "Choose a randomized tree or multi-tree workspace.",
    action: "open-demos",
  },
  {
    id: "fixture-help",
    command: "/help",
    label: "Experiment command help",
    description: "Return the current commands and fixture rules as a local help response.",
    action: "show-help",
  },
];

function fixtureCommandOptions(query: string): ComposerCommandOption[] {
  const normalizedQuery = query.trim().toLowerCase();

  return MOCK_FIXTURES.filter((fixture) => {
    if (!normalizedQuery) return true;
    const searchable = [fixture.command, fixture.label, fixture.description, ...fixture.keywords]
      .join(" ")
      .toLowerCase();
    return searchable.includes(normalizedQuery);
  }).map((fixture) => ({
    id: `fixture-${fixture.id}`,
    command: `/fixture ${fixture.command}`,
    label: fixture.label,
    description: fixture.description,
    action: "select-fixture" as const,
    fixture,
  }));
}

function demoCommandOptions(query: string): ComposerCommandOption[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return DEMO_COMMANDS;

  return DEMO_COMMANDS.filter((option) =>
    `${option.command} ${option.label} ${option.description}`
      .toLowerCase()
      .includes(normalizedQuery),
  );
}

function composerCommandOptions(value: string): ComposerCommandOption[] {
  const command = value.trimStart().toLowerCase();
  if (!command.startsWith("/")) return [];

  if (command.startsWith("/fixture")) {
    return fixtureCommandOptions(command.slice("/fixture".length));
  }

  if (command.startsWith("/demo")) {
    return demoCommandOptions(command.slice("/demo".length));
  }

  if (command.startsWith("/help")) {
    return ROOT_COMMANDS.filter((option) => option.action === "show-help");
  }

  const query = command.slice(1);
  return ROOT_COMMANDS.filter((option) =>
    `${option.command} ${option.label} ${option.description}`.toLowerCase().includes(query),
  );
}

function developerHelpResponse(): string {
  const fixtures = MOCK_FIXTURES.map(
    (fixture) => `- \`/fixture ${fixture.command}\` — ${fixture.description}`,
  );

  return [
    "# Experiment commands",
    "",
    "Type `/` to open the command palette. Use ↑/↓ to select, Enter to run, and Esc to close it.",
    "",
    "## Workspace generators",
    "",
    "- `/demo tree` — add one randomized conversation tree.",
    "- `/demo forest` — add several randomized conversation trees.",
    "",
    "## Mock fixtures",
    "",
    ...fixtures,
    "",
    "## Rules",
    "",
    "- Selecting a fixture immediately adds its command as a test turn and streams the response.",
    "- Demo generators are additive: existing chats stay in the workspace.",
    "- `/fixture anchored` requires an active quote: select response text and choose **Branch from selection** first.",
    "- Demo, fixture, and help responses are local and consume no model tokens.",
    "- `/help` returns this message and does not call an inference provider.",
  ].join("\n");
}

function inferenceLabel(
  inferenceOptionId: InferenceOptionId,
  outputTokenSetting?: OutputTokenSetting,
): string {
  const option = INFERENCE_OPTIONS[inferenceOptionId];
  const tokenLabel = !option.supportsOutputCap || outputTokenSetting === undefined
    ? ""
    : outputTokenSetting === AUTOMATIC_OUTPUT_TOKENS
      ? " · automatic"
      : ` · max ${outputTokenSetting}`;
  return `${option.providerLabel} · ${option.modelLabel}${tokenLabel}`;
}

function responseInferenceLabel(headers: Headers, fallback: string): string {
  const provider = headers.get("X-Rabbit-Hole-Provider");
  const model = headers.get("X-Rabbit-Hole-Model");
  const maxTokens = headers.get("X-Rabbit-Hole-Max-Tokens");
  const fixture = headers.get("X-Rabbit-Hole-Fixture");

  if (!provider || !model) return fallback;

  if (fixture) {
    const fixtureSelection = getMockFixtureSelection(fixture);
    if (fixtureSelection) return `${provider} · ${fixtureSelection.label}`;
  }

  const modelLabel = modelLabelForId(model);
  const tokenLabel = maxTokens === AUTOMATIC_OUTPUT_TOKENS
    ? " · automatic"
    : maxTokens
      ? ` · max ${maxTokens}`
      : "";
  return `${provider} · ${modelLabel}${tokenLabel}`;
}

type BranchContext = {
  parentId: string;
  anchor?: string;
};

type TextSelection = {
  nodeId: string;
  quote: string;
  left: number;
  top: number;
};

function getResponseSelection(): TextSelection | null {
  const selected = window.getSelection();
  if (!selected || selected.isCollapsed || selected.rangeCount === 0) return null;

  const anchorElement =
    selected.anchorNode instanceof Element ? selected.anchorNode : selected.anchorNode?.parentElement;
  const focusElement =
    selected.focusNode instanceof Element ? selected.focusNode : selected.focusNode?.parentElement;
  const anchorResponse = anchorElement?.closest<HTMLElement>(".markdown-body[data-node-id]");
  const focusResponse = focusElement?.closest<HTMLElement>(".markdown-body[data-node-id]");

  if (!anchorResponse || anchorResponse !== focusResponse) return null;

  const quote = selected.toString().trim().replace(/\s+/g, " ");
  if (!quote) return null;

  const rect = selected.getRangeAt(0).getBoundingClientRect();
  if (!rect.width && !rect.height) return null;

  return {
    nodeId: anchorResponse.dataset.nodeId ?? "",
    quote: quote.slice(0, 480),
    left: Math.max(132, Math.min(window.innerWidth - 132, rect.left + rect.width / 2)),
    top: Math.max(52, rect.top - 9),
  };
}

async function writeToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const fallback = document.createElement("textarea");
    fallback.value = text;
    fallback.setAttribute("readonly", "");
    fallback.style.position = "fixed";
    fallback.style.opacity = "0";
    document.body.appendChild(fallback);
    fallback.select();
    const copied = document.execCommand("copy");
    fallback.remove();
    return copied;
  }
}

const MARKDOWN_COMPONENTS: Components = {
  table: ({ node, ...props }) => {
    void node;
    return (
      <div className="markdown-table-scroll">
        <table {...props} />
      </div>
    );
  },
  a: ({ node, ...props }) => {
    void node;
    return <a {...props} target="_blank" rel="noreferrer" />;
  },
};

function normalizeModelMarkdown(content: string): string {
  const fencedCode = /```[\s\S]*?```/g;
  let cursor = 0;
  let normalized = "";

  for (const match of content.matchAll(fencedCode)) {
    const index = match.index ?? 0;
    normalized += content.slice(cursor, index).replace(/<br\s*\/?\s*>/gi, "  \n");
    normalized += match[0];
    cursor = index + match[0].length;
  }

  return normalized + content.slice(cursor).replace(/<br\s*\/?\s*>/gi, "  \n");
}

function OpenAIIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
    </svg>
  );
}

function ProviderIdentity({ model }: { model: string }) {
  const segments = model.split(" · ").map((segment) => segment.trim()).filter(Boolean);
  let provider = segments.shift() ?? "AI";
  let details = segments.join(" · ");

  if (provider === "Simulated") {
    provider = "Mock";
    details = "Simulated";
  }

  const providerKey = provider.toLowerCase();
  const isRabbitHole = providerKey === "rabbit hole";
  const isMock = providerKey === "mock";
  const isGateway = providerKey === "ai gateway";
  const isGroq = providerKey === "groq" || providerKey === "groq direct";
  const isGrok = providerKey === "grok";
  const isChatGpt = providerKey === "chatgpt" || providerKey === "chatgpt relay";

  return (
    <>
      <span
        className={`response-provider-icon ${isRabbitHole ? "is-rabbit-hole" : isMock ? "is-mock" : isGateway ? "is-gateway" : isGroq ? "is-groq" : isGrok ? "is-grok" : isChatGpt ? "is-chatgpt" : "is-generic"}`}
        aria-hidden="true"
      >
        {isRabbitHole ? (
          <Rabbit size={14} strokeWidth={2.1} />
        ) : isMock ? (
          <FlaskConical size={13} />
        ) : isGroq ? (
          <Zap size={13} />
        ) : isChatGpt ? (
          <OpenAIIcon size={14} />
        ) : (
          <Sparkles size={13} />
        )}
      </span>
      <span className="response-provider-name">{provider}</span>
      {details ? <span className="model-name">{details}</span> : null}
    </>
  );
}

function formatLatency(milliseconds: number): string {
  return milliseconds < 1_000
    ? `${Math.round(milliseconds)} ms`
    : `${(milliseconds / 1_000).toFixed(1)} s`;
}

function LatencySummary({ metrics }: { metrics: RelayLatencyMetrics }) {
  const endToEndMs = metrics.endToEndMs ?? metrics.relayTotalMs;
  const clientUiMs = metrics.clientUiMs
    ?? Math.max(0, endToEndMs - metrics.relayTotalMs);
  const details = [
    `Queue: ${formatLatency(metrics.queueMs)}`,
    `Relay/browser setup: ${formatLatency(metrics.browserSetupMs)}`,
    `Fresh chat: ${metrics.prewarmHit ? "prewarmed" : "prepared on demand"}`,
    `ChatGPT first text: ${formatLatency(metrics.chatgptTimeToFirstTextMs)}`,
    `ChatGPT generation/capture: ${formatLatency(metrics.chatgptGenerationMs)}`,
    `Capture stability window: ${formatLatency(metrics.stabilityWindowMs)}`,
    `Rabbit Hole UI/network: ${formatLatency(clientUiMs)}`,
    ...(metrics.traffic
      ? [
          `Browser requests: ${metrics.traffic.requests}`,
          `ChatGPT API requests: ${metrics.traffic.chatgptApiRequests}`,
          `Document loads: ${metrics.traffic.documentLoads}`,
          `403 / 429 / 5xx: ${metrics.traffic.status403} / ${metrics.traffic.status429} / ${metrics.traffic.status5xx}`,
        ]
      : []),
  ].join(" · ");

  return (
    <span className="latency-summary" title={details} aria-label={`Latency: ${details}`}>
      <Clock3 size={11} />
      <span>E2E {formatLatency(endToEndMs)}</span>
      <span>ChatGPT {formatLatency(metrics.chatgptObservedMs)}</span>
      <span>Relay setup {formatLatency(metrics.relayOverheadMs)}</span>
      {metrics.traffic ? <span>Net {metrics.traffic.requests}</span> : null}
    </span>
  );
}

function RelayTraceDetails({ metrics }: { metrics: RelayLatencyMetrics }) {
  if (!metrics.trace && !metrics.traffic) return null;
  const trace = metrics.trace;
  const traffic = metrics.traffic;

  return (
    <details className="relay-trace-details">
      <summary>
        <Terminal size={11} />
        Relay trace {trace?.requestId ?? "unavailable"}
      </summary>
      <div className="relay-trace-grid">
        <span>Relay request</span><code>{trace?.requestId ?? "—"}</code>
        <span>Client request</span><code>{trace?.clientRequestId ?? "—"}</code>
        <span>Browser page</span><code>{trace?.pageId ?? "—"} · {trace?.pageRole ?? "—"}</code>
        <span>Request kind</span><code>{trace?.requestKind ?? "—"}</code>
        <span>Network</span>
        <code>
          {traffic
            ? `${traffic.requests} requests · ${traffic.chatgptApiRequests} ChatGPT API · ${traffic.documentLoads} documents`
            : "—"}
        </code>
        <span>HTTP alerts</span>
        <code>
          {traffic
            ? `${traffic.status403}×403 · ${traffic.status429}×429 · ${traffic.status5xx}×5xx · ${traffic.failed} failed`
            : "—"}
        </code>
      </div>
      {traffic?.topRoutes.length ? (
        <div className="relay-trace-routes">
          <span>Sanitized ChatGPT routes</span>
          {traffic.topRoutes.map((route) => (
            <code key={route.route}>{route.count}× {route.route}</code>
          ))}
        </div>
      ) : null}
    </details>
  );
}

function MermaidDiagram({ chart }: { chart: string }) {
  const reactId = useId();
  const diagramId = `rabbit-hole-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [svg, setSvg] = useState("");
  const [error, setError] = useState(false);
  const [prefersDark, setPrefersDark] = useState<boolean | null>(null);

  useEffect(() => {
    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
    const updateColorScheme = () => {
      const selectedTheme = document.documentElement.dataset.theme;
      setPrefersDark(resolveColorTheme(selectedTheme, colorScheme.matches) === "dark");
    };
    updateColorScheme();
    colorScheme.addEventListener("change", updateColorScheme);
    window.addEventListener(THEME_CHANGE_EVENT, updateColorScheme);
    return () => {
      colorScheme.removeEventListener("change", updateColorScheme);
      window.removeEventListener(THEME_CHANGE_EVENT, updateColorScheme);
    };
  }, []);

  useEffect(() => {
    if (prefersDark === null) return;
    let cancelled = false;

    async function renderDiagram() {
      setSvg("");
      setError(false);

      try {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          themeVariables: {
            primaryColor: prefersDark ? "#242628" : "#f0f1f1",
            primaryTextColor: prefersDark ? "#e7e8e9" : "#26282a",
            primaryBorderColor: prefersDark ? "#9ca1a5" : "#62666a",
            lineColor: prefersDark ? "#9ca1a5" : "#62666a",
            secondaryColor: prefersDark ? "#202224" : "#f1f1ef",
            tertiaryColor: prefersDark ? "#1b1d1f" : "#fdfdfc",
            background: prefersDark ? "#1e2022" : "#fbfbfa",
            fontFamily: "Inter, ui-sans-serif, sans-serif",
          },
        });
        const result = await mermaid.render(diagramId, chart);
        if (!cancelled) setSvg(result.svg);
      } catch {
        if (!cancelled) setError(true);
      }
    }

    void renderDiagram();
    return () => {
      cancelled = true;
    };
  }, [chart, diagramId, prefersDark]);

  if (error) {
    return (
      <div className="mermaid-error">
        <span>Diagram could not be rendered. Showing its source instead.</span>
        <pre>
          <code>{chart}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className="mermaid-diagram" aria-label="Diagram">
      {svg ? (
        <div className="mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <span className="mermaid-loading">
          <LoaderCircle size={14} className="spin" /> Rendering diagram…
        </span>
      )}
    </div>
  );
}

function MarkdownResponse({ content }: { content: string }) {
  const normalizedContent = normalizeModelMarkdown(content);
  const parts: Array<{ type: "markdown" | "mermaid"; content: string }> = [];
  const mermaidFence = /```mermaid[ \t]*\n([\s\S]*?)```/gi;
  let cursor = 0;

  for (const match of normalizedContent.matchAll(mermaidFence)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      parts.push({ type: "markdown", content: normalizedContent.slice(cursor, index) });
    }
    parts.push({ type: "mermaid", content: match[1].trim() });
    cursor = index + match[0].length;
  }

  if (cursor < normalizedContent.length) {
    parts.push({ type: "markdown", content: normalizedContent.slice(cursor) });
  }
  if (!parts.length) parts.push({ type: "markdown", content: normalizedContent });

  return parts.map((part, index) =>
    part.type === "mermaid" ? (
      <MermaidDiagram key={`mermaid-${index}`} chart={part.content} />
    ) : (
      <ReactMarkdown
        key={`markdown-${index}`}
        remarkPlugins={[remarkGfm]}
        components={MARKDOWN_COMPONENTS}
      >
        {part.content}
      </ReactMarkdown>
    ),
  );
}

type TreeNodeProps = {
  chat: ChatTree;
  node: TurnNode;
  depth: number;
  activeNodeId: string;
  expandedIds: Set<string>;
  onSelect: (chatId: string, nodeId: string) => void;
  onToggle: (nodeId: string) => void;
};

function TreeNodeItem({
  chat,
  node,
  depth,
  activeNodeId,
  expandedIds,
  onSelect,
  onToggle,
}: TreeNodeProps) {
  const children = getChildren(chat, node.id);
  const hasChildren = children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const isActive = activeNodeId === node.id;
  const isRoot = node.parentId === null;

  return (
    <li className="tree-item">
      <div
        className={`tree-row ${isActive ? "is-active" : ""}`}
        style={{ paddingLeft: 8 }}
      >
        <button
          type="button"
          className="tree-disclosure"
          onClick={(event) => {
            event.stopPropagation();
            if (hasChildren) onToggle(node.id);
          }}
          aria-label={hasChildren ? `${isExpanded ? "Collapse" : "Expand"} ${node.prompt}` : undefined}
          disabled={!hasChildren}
        >
          {hasChildren ? (
            isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
          ) : (
            <span className="tree-disclosure-dot" />
          )}
        </button>

        <button
          type="button"
          className="tree-select"
          onClick={() => onSelect(chat.id, node.id)}
          aria-current={isActive ? "page" : undefined}
        >
          <span className="tree-node-icon" aria-hidden="true">
            {node.status === "streaming" ? (
              <LoaderCircle size={14} className="spin" />
            ) : isRoot ? (
              <MessageSquare size={14} />
            ) : node.anchor ? (
              <Quote size={13} />
            ) : (
              <GitBranch size={14} />
            )}
          </span>
          <span className="tree-copy">
            <span className="tree-label">{isRoot ? chat.title : node.prompt}</span>
            {node.anchor ? <span className="tree-quote">“{node.anchor.quote}”</span> : null}
          </span>
        </button>
      </div>

      {hasChildren && isExpanded ? (
        <ul className="tree-children">
          {children.map((child) => (
            <TreeNodeItem
              key={child.id}
              chat={chat}
              node={child}
              depth={depth + 1}
              activeNodeId={activeNodeId}
              expandedIds={expandedIds}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function StatusMark({ status }: { status: TurnNode["status"] }) {
  if (status === "streaming") {
    return (
      <span className="message-status is-streaming">
        <LoaderCircle size={12} className="spin" /> Thinking
      </span>
    );
  }

  if (status === "error") {
    return <span className="message-status is-error">Generation failed</span>;
  }

  if (status === "cancelled") {
    return <span className="message-status is-cancelled">Stopped</span>;
  }

  return null;
}

function UserPrompt({ prompt }: { prompt: string }) {
  const [expanded, setExpanded] = useState(false);
  const [canCollapse, setCanCollapse] = useState(false);
  const [copied, setCopied] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const measure = () => {
      const lineHeight = Number.parseFloat(window.getComputedStyle(viewport).lineHeight);
      const collapsedHeight = lineHeight * 8;
      setCanCollapse(viewport.scrollHeight > collapsedHeight + 1);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [prompt]);

  async function copyPrompt() {
    if (await writeToClipboard(prompt)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } else {
      setCopied(false);
    }
  }

  return (
    <>
      <div className="user-bubble">
        <div
          ref={viewportRef}
          className={`user-prompt-viewport ${canCollapse && !expanded ? "is-collapsed" : ""}`}
        >
          {prompt}
        </div>
        {canCollapse ? (
          <button
            type="button"
            className="user-prompt-toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        ) : null}
      </div>
      <div className="user-message-actions">
        <button type="button" onClick={copyPrompt} aria-label="Copy user prompt">
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </>
  );
}

type BranchShelfProps = {
  branches: TurnNode[];
  activeBranchId?: string;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onSelect: (nodeId: string) => void;
};

function getBranchBaseLabel(branch: TurnNode, quoteAnchor = true): string {
  if (!branch.anchor) return makeChatTitle(branch.prompt);
  return quoteAnchor ? `“${branch.anchor.quote}”` : branch.anchor.quote;
}

function getBranchLabel(branch: TurnNode, siblings: TurnNode[], quoteAnchor = true): string {
  const baseLabel = getBranchBaseLabel(branch, quoteAnchor);
  const branchIndex = siblings.findIndex((sibling) => sibling.id === branch.id);
  const duplicateIndex = siblings
    .slice(0, branchIndex)
    .filter((sibling) => getBranchBaseLabel(sibling, quoteAnchor) === baseLabel).length;

  return duplicateIndex ? `${baseLabel} · ${duplicateIndex + 1}` : baseLabel;
}

function getConversationScroller(fallback: HTMLDivElement | null) {
  return fallback;
}

function BranchShelf({
  branches,
  activeBranchId,
  menuOpen,
  onToggleMenu,
  onSelect,
}: BranchShelfProps) {
  let visibleBranches = branches.length <= 3 ? branches : branches.slice(0, 3);

  if (activeBranchId && !visibleBranches.some((branch) => branch.id === activeBranchId)) {
    const activeBranch = branches.find((branch) => branch.id === activeBranchId);
    if (activeBranch) {
      visibleBranches = [...visibleBranches.slice(0, 2), activeBranch].sort(
        (a, b) => branches.indexOf(a) - branches.indexOf(b),
      );
    }
  }

  return (
    <div className="branch-shelf" aria-label="Branches from this response">
      {visibleBranches.map((branch) => {
        const isActive = branch.id === activeBranchId;
        return (
          <button
            type="button"
            key={branch.id}
            className={`branch-chip ${isActive ? "is-active" : ""}`}
            onClick={() => onSelect(branch.id)}
            aria-current={isActive ? "page" : undefined}
            title={branch.anchor ? `Anchored to “${branch.anchor.quote}”\n${branch.prompt}` : branch.prompt}
          >
            {branch.anchor ? <Quote size={14} /> : <GitBranch size={14} />}
            <span className="branch-chip-label">
              <span className="branch-label-default">{getBranchLabel(branch, branches)}</span>
              <span className="branch-label-ipad">{getBranchLabel(branch, branches, false)}</span>
            </span>
          </button>
        );
      })}

      {branches.length > 3 ? (
        <div className="branch-overflow">
          <button
            type="button"
            className="branch-more-button"
            onClick={onToggleMenu}
            aria-expanded={menuOpen}
          >
            More… <ChevronDown size={14} className={menuOpen ? "is-open" : ""} />
          </button>

          {menuOpen ? (
            <div className="branch-overflow-menu">
              {branches.map((branch) => {
                const isActive = branch.id === activeBranchId;
                return (
                  <button
                    type="button"
                    key={branch.id}
                    className={`branch-menu-item ${isActive ? "is-active" : ""}`}
                    onClick={() => onSelect(branch.id)}
                    aria-current={isActive ? "page" : undefined}
                  >
                    <span className="branch-menu-icon" aria-hidden="true">
                      {branch.anchor ? <Quote size={14} /> : <GitBranch size={14} />}
                    </span>
                    <span className="branch-menu-copy">
                      <span className="branch-menu-label">
                        <span className="branch-label-default">{getBranchLabel(branch, branches)}</span>
                        <span className="branch-label-ipad">{getBranchLabel(branch, branches, false)}</span>
                      </span>
                      {branch.anchor ? <span className="branch-menu-prompt">{branch.prompt}</span> : null}
                    </span>
                    {isActive ? <Check size={13} className="branch-menu-check" /> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function RabbitHoleApp() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(() => createEmptyWorkspace());
  const [hydrated, setHydrated] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [composerValue, setComposerValue] = useState("");
  const [branchContext, setBranchContext] = useState<BranchContext | null>(null);
  const [selection, setSelection] = useState<TextSelection | null>(null);
  const [newChatMode, setNewChatMode] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [copiedNodeId, setCopiedNodeId] = useState<string | null>(null);
  const [openBranchMenuId, setOpenBranchMenuId] = useState<string | null>(null);
  const [inferenceOptionId, setInferenceOptionId] = useState<InferenceOptionId>(
    DEFAULT_INFERENCE_OPTION_ID,
  );
  const [maxTokens, setMaxTokens] = useState<OutputTokenSetting>(DEFAULT_MAX_OUTPUT_TOKENS);
  const [modelControlsVisible, setModelControlsVisible] = useState(true);
  const [devMode, setDevMode] = useState(false);
  const [relayToken, setRelayToken] = useState("");
  const [relayPaired, setRelayPaired] = useState(false);
  const [relayStatus, setRelayStatus] = useState<RelayStatus>("disconnected");
  const [relaySession, setRelaySession] = useState<RelaySessionDiagnostics | null>(null);
  const [relayCooldownOverridePending, setRelayCooldownOverridePending] = useState(false);
  const [relayMessage, setRelayMessage] = useState(
    "First time: run npm run relay:login, sign in, close Chrome, then run npm run relay.",
  );
  const [pendingFixtureId, setPendingFixtureId] = useState<MockFixtureId | null>(null);
  const [pendingHelp, setPendingHelp] = useState(false);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [commandPaletteDismissed, setCommandPaletteDismissed] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [ipadMoreMenuOpen, setIpadMoreMenuOpen] = useState(false);
  const [colorTheme, setColorTheme] = useState<ColorTheme>("light");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const composerDockRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followStreamRef = useRef(true);
  const lastViewedNodeIdRef = useRef<string | null>(null);
  const pendingPreservedScrollTopRef = useRef<number | null>(null);
  const generationControllersRef = useRef<Map<string, AbortController>>(new Map());

  const activeChat = useMemo(
    () => workspace.chats.find((chat) => chat.id === workspace.activeChatId) ?? workspace.chats[0],
    [workspace],
  );
  const activeNode = activeChat?.nodes[workspace.activeNodeId] ?? activeChat?.nodes[activeChat?.rootNodeId];
  const branchParent = branchContext && activeChat ? activeChat.nodes[branchContext.parentId] : null;
  const composerParent = branchParent ?? activeNode;
  const composerBlockedByGeneration = !newChatMode && composerParent?.status === "streaming";
  const activePath = useMemo(
    () => (activeChat && activeNode ? getNodePath(activeChat, activeNode.id) : []),
    [activeChat, activeNode],
  );
  const selectedInference = INFERENCE_OPTIONS[inferenceOptionId];
  const selectedOutputTokenSetting = selectedInference.supportsOutputCap ? maxTokens : undefined;
  const effectiveMaxTokens = selectedOutputTokenSetting === AUTOMATIC_OUTPUT_TOKENS
    ? undefined
    : selectedOutputTokenSetting;
  const pendingFixture = pendingFixtureId ? getMockFixtureSelection(pendingFixtureId) : undefined;
  const selectedInferenceLabel =
    inferenceOptionId === "mock" && pendingFixture
      ? `Mock · ${pendingFixture.label}`
      : inferenceLabel(inferenceOptionId, selectedOutputTokenSetting);
  const isCommandInput =
    EXPERIMENT_MODE_AVAILABLE && devMode && composerValue.trimStart().startsWith("/");
  const commandOptions = useMemo(
    () => (isCommandInput && !commandPaletteDismissed ? composerCommandOptions(composerValue) : []),
    [commandPaletteDismissed, composerValue, isCommandInput],
  );
  const commandPaletteVisible = isCommandInput && !commandPaletteDismissed;

  const checkRelayConnection = useCallback(async (
    candidateToken?: string,
    options: RelayConnectionCheckOptions = {},
  ) => {
    const token = (candidateToken ?? relayToken).trim();
    if (!token) {
      setRelayStatus("disconnected");
      setRelayMessage("First time: run npm run relay:login, sign in, close Chrome, then run npm run relay.");
      return false;
    }

    if (!options.background) {
      setRelayStatus("checking");
      setRelayMessage("Checking the local browser session…");
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 3_500);

    try {
      const response = await fetchRelay("/health", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: controller.signal,
      });

      if (response.status === 401) {
        if (window.sessionStorage.getItem(RELAY_TOKEN_STORAGE_KEY) === token) {
          window.sessionStorage.removeItem(RELAY_TOKEN_STORAGE_KEY);
        }
        setRelayPaired(false);
        setRelayStatus("unauthorized");
        setRelayMessage("That pairing token was rejected. Copy the current token from the relay terminal.");
        return false;
      }
      if (!response.ok) throw new Error(`Relay returned ${response.status}`);

      const health = (await response.json()) as {
        ready?: boolean;
        loginRequired?: boolean;
        rateLimited?: boolean;
        retryAt?: string | null;
        session?: RelaySessionDiagnostics;
      };
      setRelaySession(health.session ?? null);
      setRelayToken(token);
      setRelayPaired(true);
      window.sessionStorage.setItem(RELAY_TOKEN_STORAGE_KEY, token);

      if (health.rateLimited) {
        const retryTime = health.retryAt
          ? new Date(health.retryAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
          : null;
        setRelayStatus("rate-limited");
        setRelayMessage(
          retryTime
            ? `Rabbit Hole paused new ChatGPT launches until about ${retryTime}; queued prompts will not be submitted.`
            : "Rabbit Hole paused new ChatGPT launches after a temporary usage warning.",
        );
        return false;
      }

      if (health.ready) {
        setRelayStatus("ready");
        setRelayMessage("Connected. Prompts stay on this computer and use the signed-in ChatGPT session.");
        return true;
      }

      setRelayStatus("login-required");
      setRelayMessage(
        health.loginRequired
          ? "Stop the relay. Run npm run relay:login, finish signing in, close Chrome, then restart the relay."
          : "The relay browser is starting. Check again in a moment.",
      );
      return false;
    } catch {
      setRelayStatus("offline");
      setRelayMessage("No relay answered on 127.0.0.1:43119. Run npm run relay in another terminal.");
      return false;
    } finally {
      window.clearTimeout(timeout);
    }
  }, [relayToken]);

  const overrideRelayCooldown = useCallback(async () => {
    const token = relayToken.trim();
    if (!token || relayCooldownOverridePending) return;

    setRelayCooldownOverridePending(true);
    setRelayMessage("Clearing Rabbit Hole's local cooldown gate…");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 3_500);

    try {
      const response = await fetchRelay("/cooldown/override", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: controller.signal,
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
        overridden?: boolean;
        persisted?: boolean;
      };

      if (response.status === 401) {
        window.sessionStorage.removeItem(RELAY_TOKEN_STORAGE_KEY);
        setRelayPaired(false);
        setRelayStatus("unauthorized");
        setRelayMessage("That pairing token was rejected. Copy the current token from the relay terminal.");
        return;
      }
      if (!response.ok) {
        throw new Error(result.error || `Relay returned ${response.status}`);
      }

      const ready = await checkRelayConnection(token);
      if (ready) {
        setRelayMessage(
          result.persisted === false
            ? "Cooldown cleared for this relay session, but its state file could not be updated; restarting may restore the old timer."
            : result.overridden
            ? "Local cooldown overridden. The next prompt will check ChatGPT again; another protection warning will restore the cooldown."
            : "The local cooldown had already ended. ChatGPT is ready to be checked by the next prompt.",
        );
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown relay error";
      setRelayStatus("rate-limited");
      setRelayMessage(
        detail === "Unknown Rabbit Hole relay endpoint."
          ? "Restart npm run relay to enable cooldown overrides, then try again."
          : "The local cooldown could not be overridden. Check that the relay is running and try again.",
      );
    } finally {
      window.clearTimeout(timeout);
      setRelayCooldownOverridePending(false);
    }
  }, [checkRelayConnection, relayCooldownOverridePending, relayToken]);

  useEffect(() => {
    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
    const syncColorTheme = () => {
      let savedTheme: string | null = null;
      try {
        savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
      } catch {}

      const nextTheme = resolveColorTheme(savedTheme, colorScheme.matches);
      if (savedTheme === "light" || savedTheme === "dark") {
        document.documentElement.dataset.theme = savedTheme;
      } else {
        document.documentElement.removeAttribute("data-theme");
      }
      setColorTheme(nextTheme);
    };

    syncColorTheme();
    colorScheme.addEventListener("change", syncColorTheme);
    return () => colorScheme.removeEventListener("change", syncColorTheme);
  }, []);

  useEffect(() => {
    const pendingCommand = pendingHelp
      ? "/help"
      : pendingFixture
        ? `/fixture ${pendingFixture.command}`
        : undefined;
    if (!pendingCommand || composerValue !== pendingCommand) return;

    const frame = window.requestAnimationFrame(() => {
      composerRef.current?.form?.requestSubmit();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [composerValue, pendingFixture, pendingHelp]);

  function toggleColorTheme() {
    const nextTheme = oppositeColorTheme(colorTheme);
    document.documentElement.dataset.theme = nextTheme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {}
    setColorTheme(nextTheme);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }

  useEffect(() => {
    let restored: WorkspaceState | null = null;
    let restoredModelControlsVisibility: boolean | null = null;
    let restoredDevMode = false;
    let restoredRelayToken = "";
    try {
      window.localStorage.removeItem(LEGACY_WORKSPACE_STORAGE_KEY);

      const saved = window.sessionStorage.getItem(GUEST_WORKSPACE_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as WorkspaceState;
        const chats = parsed.chats?.filter((chat) => !LEGACY_DEMO_CHAT_IDS.has(chat.id)) ?? [];
        if (chats.length) {
          const activeChat = chats.find((chat) => chat.id === parsed.activeChatId) ?? chats[0];
          restored = {
            chats,
            activeChatId: activeChat.id,
            activeNodeId: activeChat.nodes[parsed.activeNodeId]
              ? parsed.activeNodeId
              : activeChat.rootNodeId,
          };
        }
      }
      const savedModelControlsVisibility = window.localStorage.getItem(MODEL_CONTROLS_STORAGE_KEY);
      if (savedModelControlsVisibility !== null) {
        restoredModelControlsVisibility = savedModelControlsVisibility === "true";
      }
      if (EXPERIMENT_MODE_AVAILABLE) {
        restoredDevMode = window.localStorage.getItem(DEV_MODE_STORAGE_KEY) === "true";
      }
      restoredRelayToken = window.sessionStorage.getItem(RELAY_TOKEN_STORAGE_KEY) ?? "";
    } catch {}

    const frame = window.requestAnimationFrame(() => {
      if (restored) {
        setWorkspace(restored);
        const chat = restored.chats.find((item) => item.id === restored?.activeChatId);
        if (chat) setExpandedIds(new Set(getAncestorIds(chat, restored.activeNodeId)));
        setNewChatMode(false);
      }
      if (restoredModelControlsVisibility !== null) {
        setModelControlsVisible(restoredModelControlsVisibility);
      }
      if (EXPERIMENT_MODE_AVAILABLE) setDevMode(restoredDevMode);
      if (restoredRelayToken) {
        setRelayToken(restoredRelayToken);
        setRelayPaired(true);
      }
      setHydrated(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timeout = window.setTimeout(() => {
      window.sessionStorage.setItem(
        GUEST_WORKSPACE_STORAGE_KEY,
        JSON.stringify(workspace),
      );
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [hydrated, workspace]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(MODEL_CONTROLS_STORAGE_KEY, String(modelControlsVisible));
  }, [modelControlsVisible, hydrated]);

  useEffect(() => {
    if (!hydrated || !EXPERIMENT_MODE_AVAILABLE) return;
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, String(devMode));
  }, [devMode, hydrated]);

  useEffect(() => {
    if (!hydrated || inferenceOptionId !== "chatgpt-relay" || !relayToken || !relayPaired) return;
    if (window.sessionStorage.getItem(RELAY_TOKEN_STORAGE_KEY) !== relayToken) return;

    const initialCheck = window.setTimeout(() => {
      if (window.sessionStorage.getItem(RELAY_TOKEN_STORAGE_KEY) === relayToken) {
        void checkRelayConnection(relayToken, { background: true });
      }
    }, 0);
    const interval = window.setInterval(() => {
      if (window.sessionStorage.getItem(RELAY_TOKEN_STORAGE_KEY) === relayToken) {
        void checkRelayConnection(relayToken, { background: true });
      }
    }, 12_000);
    return () => {
      window.clearTimeout(initialCheck);
      window.clearInterval(interval);
    };
  }, [checkRelayConnection, hydrated, inferenceOptionId, relayPaired, relayToken]);

  useEffect(() => {
    if (!signInOpen) return;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSignInOpen(false);
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [signInOpen]);

  useEffect(() => () => {
    for (const controller of generationControllersRef.current.values()) {
      controller.abort();
    }
    generationControllersRef.current.clear();
  }, []);

  useLayoutEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;

    composer.style.height = "auto";
    composer.style.height = `${Math.min(composer.scrollHeight, 200)}px`;
    composer.style.overflowY = composer.scrollHeight > 200 ? "auto" : "hidden";
  }, [composerValue]);

  useLayoutEffect(() => {
    if (document.documentElement.dataset.rabbitHolePlatform !== "ipad") return;

    const composerDock = composerDockRef.current;
    const mainPanel = composerDock?.parentElement;
    if (!composerDock || !mainPanel) return;

    const updateComposerHeight = () => {
      mainPanel.style.setProperty("--composer-overlay-height", `${composerDock.offsetHeight}px`);
    };
    updateComposerHeight();

    const observer = new ResizeObserver(updateComposerHeight);
    observer.observe(composerDock);
    return () => {
      observer.disconnect();
      mainPanel.style.removeProperty("--composer-overlay-height");
    };
  }, []);

  useEffect(() => {
    if (document.documentElement.dataset.rabbitHolePlatform !== "ipad") return;

    const composer = composerRef.current;
    const composerDock = composerDockRef.current;
    if (!composer || !composerDock) return;

    const viewport = window.visualViewport;
    let focused = false;
    let pendingFrame = 0;
    let blurTimer = 0;

    const updateFocusedPosition = () => {
      pendingFrame = 0;
      if (!focused) return;

      const pageTop = viewport?.pageTop ?? window.scrollY;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const top = Math.max(0, pageTop + viewportHeight - composerDock.offsetHeight);
      composerDock.style.position = "absolute";
      composerDock.style.top = `${Math.round(top)}px`;
      composerDock.style.bottom = "auto";
      composerDock.dataset.keyboardPositioned = "true";
    };

    const scheduleFocusedPosition = () => {
      if (!focused) return;
      if (pendingFrame) window.cancelAnimationFrame(pendingFrame);
      pendingFrame = window.requestAnimationFrame(updateFocusedPosition);
    };

    const beginFocusedPositioning = () => {
      focused = true;
      if (blurTimer) window.clearTimeout(blurTimer);
      updateFocusedPosition();
    };

    const endFocusedPositioning = () => {
      focused = false;
      if (pendingFrame) window.cancelAnimationFrame(pendingFrame);
      pendingFrame = 0;
      blurTimer = window.setTimeout(() => {
        composerDock.style.removeProperty("position");
        composerDock.style.removeProperty("top");
        composerDock.style.removeProperty("bottom");
        delete composerDock.dataset.keyboardPositioned;
      }, 350);
    };

    const observer = new ResizeObserver(scheduleFocusedPosition);
    observer.observe(composerDock);
    composer.addEventListener("focus", beginFocusedPositioning);
    composer.addEventListener("blur", endFocusedPositioning);
    window.addEventListener("scroll", scheduleFocusedPosition);
    window.addEventListener("resize", scheduleFocusedPosition);
    viewport?.addEventListener("scroll", scheduleFocusedPosition);
    viewport?.addEventListener("resize", scheduleFocusedPosition);

    return () => {
      focused = false;
      observer.disconnect();
      composer.removeEventListener("focus", beginFocusedPositioning);
      composer.removeEventListener("blur", endFocusedPositioning);
      window.removeEventListener("scroll", scheduleFocusedPosition);
      window.removeEventListener("resize", scheduleFocusedPosition);
      viewport?.removeEventListener("scroll", scheduleFocusedPosition);
      viewport?.removeEventListener("resize", scheduleFocusedPosition);
      if (pendingFrame) window.cancelAnimationFrame(pendingFrame);
      if (blurTimer) window.clearTimeout(blurTimer);
      composerDock.style.removeProperty("position");
      composerDock.style.removeProperty("top");
      composerDock.style.removeProperty("bottom");
      delete composerDock.dataset.keyboardPositioned;
    };
  }, []);

  useLayoutEffect(() => {
    const scrollElement = getConversationScroller(scrollRef.current);
    if (!activeNode || !scrollElement) return;

    const nodeChanged = lastViewedNodeIdRef.current !== activeNode.id;
    if (nodeChanged) {
      lastViewedNodeIdRef.current = activeNode.id;
      const preservedScrollTop = pendingPreservedScrollTopRef.current;
      pendingPreservedScrollTopRef.current = null;

      if (preservedScrollTop !== null) {
        followStreamRef.current = false;
        scrollElement.scrollTo({ top: preservedScrollTop, behavior: "auto" });
        return;
      }

      followStreamRef.current = true;
    } else if (activeNode.status !== "streaming" || !followStreamRef.current) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      scrollElement.scrollTo({ top: scrollElement.scrollHeight, behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeNode]);

  useEffect(() => {
    const closeFloatingControls = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".selection-popover")) setSelection(null);
      if (!target.closest(".branch-overflow")) setOpenBranchMenuId(null);
      if (!target.closest(".ipad-header-more")) setIpadMoreMenuOpen(false);
    };
    const handleScroll = () => {
      setSelection(null);
      setOpenBranchMenuId(null);
      setIpadMoreMenuOpen(false);
      if (!scrollElement) return;
      const distanceFromBottom =
        scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight;
      followStreamRef.current = distanceFromBottom <= 80;
    };
    const scrollElement = getConversationScroller(scrollRef.current);
    document.addEventListener("pointerdown", closeFloatingControls);
    window.addEventListener("resize", handleScroll);
    scrollElement?.addEventListener("scroll", handleScroll);
    return () => {
      document.removeEventListener("pointerdown", closeFloatingControls);
      window.removeEventListener("resize", handleScroll);
      scrollElement?.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useEffect(() => {
    const captureSelection = () => {
      const nextSelection = getResponseSelection();
      if (nextSelection?.nodeId) setSelection(nextSelection);
    };
    const captureKeyboardSelection = (event: KeyboardEvent) => {
      if (event.shiftKey) captureSelection();
    };
    const captureTouchSelection = () => window.setTimeout(captureSelection, 0);

    document.addEventListener("mouseup", captureSelection);
    document.addEventListener("keyup", captureKeyboardSelection);
    document.addEventListener("touchend", captureTouchSelection);
    return () => {
      document.removeEventListener("mouseup", captureSelection);
      document.removeEventListener("keyup", captureKeyboardSelection);
      document.removeEventListener("touchend", captureTouchSelection);
    };
  }, []);

  useEffect(() => {
    if (document.documentElement.dataset.rabbitHolePlatform !== "ipad") return;

    const beginNativeBranch = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId?: unknown; quote?: unknown }>).detail;
      if (typeof detail?.nodeId !== "string" || typeof detail.quote !== "string") return;

      const nodeId = detail.nodeId.trim();
      const quote = detail.quote.trim().replace(/\s+/g, " ").slice(0, 480);
      if (!nodeId || !quote) return;

      setBranchContext({ parentId: nodeId, anchor: quote });
      setSelection(null);
      setOpenBranchMenuId(null);
      window.getSelection()?.removeAllRanges();
      window.setTimeout(() => composerRef.current?.focus(), 0);
    };

    window.addEventListener(NATIVE_BRANCH_FROM_SELECTION_EVENT, beginNativeBranch);
    return () => window.removeEventListener(NATIVE_BRANCH_FROM_SELECTION_EVENT, beginNativeBranch);
  }, []);

  function updateNode(chatId: string, nodeId: string, update: Partial<TurnNode>) {
    setWorkspace((current) => ({
      ...current,
      chats: current.chats.map((chat) =>
        chat.id === chatId
          ? {
              ...chat,
              updatedAt: Date.now(),
              nodes: {
                ...chat.nodes,
                [nodeId]: { ...chat.nodes[nodeId], ...update },
              },
            }
          : chat,
      ),
    }));
  }

  function cancelGeneration(chatId: string, nodeId: string) {
    const controller = generationControllersRef.current.get(nodeId);
    controller?.abort();
    generationControllersRef.current.delete(nodeId);

    setWorkspace((current) => ({
      ...current,
      chats: current.chats.map((chat) => {
        const node = chat.nodes[nodeId];
        if (chat.id !== chatId || !node || node.status !== "streaming") return chat;
        return {
          ...chat,
          updatedAt: Date.now(),
          nodes: {
            ...chat.nodes,
            [nodeId]: { ...node, status: "cancelled" },
          },
        };
      }),
    }));
  }

  async function streamIntoNode(
    chatId: string,
    nodeId: string,
    prompt: string,
    messages: Array<{ role: "user" | "assistant"; content: string; anchor?: string }>,
    anchor?: string,
    fixtureId?: MockFixtureId,
  ) {
    // This runs only after a submit event and measures the local request lifecycle.
    // eslint-disable-next-line react-hooks/purity
    const requestStartedAt = Date.now();
    const controller = new AbortController();
    generationControllersRef.current.set(nodeId, controller);
    try {
      const usingRelay = selectedInference.transport === "relay";
      const relayRequestKind = messages.length === 1
        ? "root"
        : anchor
          ? "quote-branch"
          : "branch";
      if (usingRelay && relayStatus !== "ready") {
        throw new Error("Connect the local ChatGPT relay before sending a message.");
      }

      const response = await fetchInference(usingRelay, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(usingRelay ? { Authorization: `Bearer ${relayToken}` } : {}),
        },
        body: JSON.stringify(
          usingRelay
            ? {
                messages,
                client: {
                  clientRequestId: nodeId,
                  chatId,
                  nodeId,
                  requestKind: relayRequestKind,
                  clientStartedAt: requestStartedAt,
                },
              }
            : {
                prompt,
                messages,
                anchor,
                inference: inferenceOptionId,
                devMode: EXPERIMENT_MODE_AVAILABLE && devMode,
                ...(effectiveMaxTokens ? { maxTokens: effectiveMaxTokens } : {}),
                ...(fixtureId ? { fixtureId } : {}),
          },
        ),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const detail = await response.text();
        throw new Error(detail || "Unable to start generation");
      }

      updateNode(chatId, nodeId, {
        model: responseInferenceLabel(response.headers, selectedInferenceLabel),
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let content = "";
      const streamProtocol = response.headers.get("X-Rabbit-Hole-Stream-Protocol");

      if (usingRelay) {
        let buffer = "";
        let completed = false;

        while (true) {
          const { value, done } = await reader.read();
          buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
          const lines = buffer.split("\n");
          buffer = done ? "" : (lines.pop() ?? "");

          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line) as {
              type?: "meta" | "snapshot" | "done" | "error";
              text?: string;
              error?: string;
              model?: string;
              metrics?: RelayLatencyMetrics;
              conversationUrl?: string;
              promptSubmitted?: boolean;
            };

            if (event.type === "meta" && event.model) {
              updateNode(chatId, nodeId, { model: `ChatGPT · ${event.model}` });
            }
            if (event.type === "error") {
              throw new Error(event.error || "The ChatGPT relay failed.");
            }
            if ((event.type === "snapshot" || event.type === "done") && typeof event.text === "string") {
              content = event.text;
              // This runs while consuming the response stream, outside render.
              // eslint-disable-next-line react-hooks/purity
              const endToEndMs = Date.now() - requestStartedAt;
              updateNode(chatId, nodeId, {
                response: content,
                ...(event.conversationUrl ? { providerConversationUrl: event.conversationUrl } : {}),
                ...(event.metrics
                  ? {
                      latency: {
                        ...event.metrics,
                        endToEndMs,
                        clientOverheadMs: Math.max(0, endToEndMs - event.metrics.chatgptObservedMs),
                        clientUiMs: Math.max(0, endToEndMs - event.metrics.relayTotalMs),
                      },
                    }
                  : {}),
              });
            }
            if (event.type === "done") completed = true;
          }

          if (done) break;
        }

        if (!completed || !content) {
          throw new Error("The ChatGPT relay ended before returning a complete response.");
        }
        updateNode(chatId, nodeId, { status: "complete", response: content });
        return;
      }

      if (streamProtocol === "rabbit-hole-ndjson-v1") {
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
          const lines = buffer.split("\n");
          buffer = done ? "" : (lines.pop() ?? "");

          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line) as {
              type?: "delta" | "error";
              text?: string;
              error?: string;
            };

            if (event.type === "error") {
              throw new Error(event.error || "The inference provider failed.");
            }
            if (event.type === "delta" && typeof event.text === "string") {
              content += event.text;
              updateNode(chatId, nodeId, { response: content });
            }
          }

          if (done) break;
        }

        if (!content) {
          throw new Error("The inference provider completed without returning text.");
        }
        updateNode(chatId, nodeId, { status: "complete", response: content });
        return;
      }

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        content += decoder.decode(value, { stream: true });
        updateNode(chatId, nodeId, { response: content });
      }

      updateNode(chatId, nodeId, { status: "complete", response: content });
    } catch (error) {
      if (controller.signal.aborted) {
        updateNode(chatId, nodeId, { status: "cancelled" });
        return;
      }

      const detail = error instanceof Error ? error.message : "Unknown inference error";
      if (
        selectedInference.transport === "relay"
        && /temporarily limiting this account/i.test(detail)
      ) {
        setRelayStatus("rate-limited");
        setRelayMessage(detail);
      }
      updateNode(chatId, nodeId, {
        status: "error",
        response: `Generation was interrupted: ${detail.slice(0, 320)}`,
      });
    } finally {
      if (generationControllersRef.current.get(nodeId) === controller) {
        generationControllersRef.current.delete(nodeId);
      }
    }
  }

  function selectNode(chatId: string, nodeId: string, preserveScroll = false) {
    const chat = workspace.chats.find((item) => item.id === chatId);
    const destinationChanged = workspace.activeChatId !== chatId || workspace.activeNodeId !== nodeId;
    pendingPreservedScrollTopRef.current = preserveScroll && destinationChanged
      ? getConversationScroller(scrollRef.current)?.scrollTop ?? null
      : null;
    setWorkspace((current) => ({ ...current, activeChatId: chatId, activeNodeId: nodeId }));
    setNewChatMode(false);
    setBranchContext(null);
    setSelection(null);
    setOpenBranchMenuId(null);
    if (chat) {
      setExpandedIds((current) => new Set([...current, ...getAncestorIds(chat, nodeId)]));
    }
  }

  function toggleNode(nodeId: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }

  function beginBranch(parentId: string, anchor?: string) {
    setBranchContext({ parentId, anchor });
    setSelection(null);
    setOpenBranchMenuId(null);
    window.getSelection()?.removeAllRanges();
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }

  async function copyResponse(node: TurnNode) {
    if (await writeToClipboard(node.response)) {
      setCopiedNodeId(node.id);
      window.setTimeout(() => setCopiedNodeId(null), 1200);
    } else {
      setCopiedNodeId(null);
    }
  }

  function disconnectRelay() {
    window.sessionStorage.removeItem(RELAY_TOKEN_STORAGE_KEY);
    setRelayToken("");
    setRelayPaired(false);
    setRelayStatus("disconnected");
    setRelaySession(null);
    setRelayMessage("First time: run npm run relay:login, sign in, close Chrome, then run npm run relay.");
  }

  function runComposerCommand(option: ComposerCommandOption) {
    if (option.action === "open-fixtures") {
      setComposerValue("/fixture ");
      setSelectedCommandIndex(0);
      setCommandPaletteDismissed(false);
      window.setTimeout(() => composerRef.current?.focus(), 0);
      return;
    }

    if (option.action === "open-demos") {
      setComposerValue("/demo ");
      setSelectedCommandIndex(0);
      setCommandPaletteDismissed(false);
      window.setTimeout(() => composerRef.current?.focus(), 0);
      return;
    }

    if (option.action === "demo-tree" || option.action === "demo-forest") {
      const chats = createRandomDemoChats(option.action === "demo-tree" ? 1 : 3);
      const activeChat = chats[0];
      const activeNodes = Object.values(activeChat.nodes);
      const activeNode = activeNodes[activeNodes.length - 1];

      setWorkspace((current) => ({
        chats: [...chats, ...current.chats],
        activeChatId: activeChat.id,
        activeNodeId: activeNode.id,
      }));
      setExpandedIds((current) =>
        new Set([
          ...current,
          ...chats.flatMap((chat) => Object.keys(chat.nodes)),
        ]),
      );
      setNewChatMode(false);
      setBranchContext(null);
      setSelection(null);
      setOpenBranchMenuId(null);
      setPendingHelp(false);
      setPendingFixtureId(null);
      setComposerValue("");
      setSelectedCommandIndex(0);
      setCommandPaletteDismissed(true);
      return;
    }

    if (option.action === "show-help") {
      setPendingHelp(true);
      setPendingFixtureId(null);
      setComposerValue("/help");
      setSelectedCommandIndex(0);
      setCommandPaletteDismissed(true);
      return;
    }

    if (!option.fixture) return;

    setDevMode(true);
    setModelControlsVisible(true);
    setInferenceOptionId("mock");
    setPendingHelp(false);
    setPendingFixtureId(option.fixture.id);
    setComposerValue(option.command);
    setSelectedCommandIndex(0);
    setCommandPaletteDismissed(true);
  }

  async function submitPrompt(event: FormEvent) {
    event.preventDefault();
    const prompt = composerValue.trim();
    if (!prompt || composerBlockedByGeneration) return;

    if (isCommandInput && !pendingFixtureId && !pendingHelp) {
      const selectedOption = commandOptions[selectedCommandIndex] ?? commandOptions[0];
      if (selectedOption) runComposerCommand(selectedOption);
      return;
    }

    const fixtureId = pendingFixtureId ?? undefined;
    const helpResponse = pendingHelp ? developerHelpResponse() : undefined;
    const requestInferenceLabel = helpResponse
      ? "Rabbit Hole · Help"
      : fixtureId
        ? `Mock · ${getMockFixtureSelection(fixtureId)?.label ?? fixtureId}`
        : selectedInferenceLabel;
    setComposerValue("");
    setPendingFixtureId(null);
    setPendingHelp(false);

    if (newChatMode || !activeChat || !activeNode) {
      const chatId = crypto.randomUUID();
      const nodeId = crypto.randomUUID();
      // This runs only after a submit event; the timestamp is stored with the new node.
      // eslint-disable-next-line react-hooks/purity
      const now = Date.now();
      const rootNode: TurnNode = {
        id: nodeId,
        parentId: null,
        prompt,
        response: helpResponse ?? "",
        status: helpResponse ? "complete" : "streaming",
        createdAt: now,
        model: requestInferenceLabel,
      };
      const chat: ChatTree = {
        id: chatId,
        title: makeChatTitle(prompt),
        rootNodeId: nodeId,
        createdAt: now,
        updatedAt: now,
        nodes: { [nodeId]: rootNode },
      };
      setWorkspace((current) => ({
        chats: [chat, ...current.chats],
        activeChatId: chatId,
        activeNodeId: nodeId,
      }));
      setExpandedIds((current) => new Set([...current, nodeId]));
      setNewChatMode(false);
      if (helpResponse) return;
      await streamIntoNode(
        chatId,
        nodeId,
        prompt,
        [{ role: "user", content: prompt }],
        undefined,
        fixtureId,
      );
      return;
    }

    const parentId = branchContext?.parentId ?? activeNode.id;
    const parent = activeChat.nodes[parentId];
    if (!parent) return;
    const nodeId = crypto.randomUUID();
    // This runs only after a submit event; the timestamp is stored with the new branch.
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    const anchor: QuoteAnchor | undefined = branchContext?.anchor
      ? { sourceNodeId: parentId, quote: branchContext.anchor }
      : undefined;
    const newNode: TurnNode = {
      id: nodeId,
      parentId,
      prompt,
      response: helpResponse ?? "",
      status: helpResponse ? "complete" : "streaming",
      createdAt: now,
      model: requestInferenceLabel,
      anchor,
    };
    const parentPath = getNodePath(activeChat, parentId);
    const messages = buildContinuationMessages(parentPath, prompt, anchor);

    setWorkspace((current) => ({
      ...current,
      activeNodeId: nodeId,
      chats: current.chats.map((chat) =>
        chat.id === activeChat.id
          ? {
              ...chat,
              updatedAt: now,
              nodes: { ...chat.nodes, [nodeId]: newNode },
            }
          : chat,
      ),
    }));
    setExpandedIds((current) => new Set([...current, parentId, nodeId]));
    setBranchContext(null);
    if (helpResponse) return;
    await streamIntoNode(activeChat.id, nodeId, prompt, messages, anchor?.quote, fixtureId);
  }

  function resetWorkspace() {
    if (!window.confirm("Start a fresh guest session? All chats and branches in this tab will be removed.")) {
      return;
    }
    for (const controller of generationControllersRef.current.values()) {
      controller.abort();
    }
    generationControllersRef.current.clear();
    window.sessionStorage.removeItem(GUEST_WORKSPACE_STORAGE_KEY);
    setWorkspace(createEmptyWorkspace());
    setExpandedIds(new Set());
    setBranchContext(null);
    setComposerValue("");
    setPendingFixtureId(null);
    setPendingHelp(false);
    setNewChatMode(true);
    setOpenBranchMenuId(null);
  }

  function startNewChat() {
    setNewChatMode(true);
    setBranchContext(null);
    setSelection(null);
    setOpenBranchMenuId(null);
    setComposerValue("");
    setPendingFixtureId(null);
    setPendingHelp(false);
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }

  function toggleExperimentMode() {
    const nextDevMode = !devMode;
    setDevMode(nextDevMode);
    if (nextDevMode) {
      setModelControlsVisible(true);
    } else {
      setPendingFixtureId(null);
      setPendingHelp(false);
      if (composerValue.trimStart().startsWith("/")) setComposerValue("");
    }
  }

  return (
    <main className={`app-shell ${sidebarOpen ? "" : "sidebar-collapsed"}`}>
      <aside className="sidebar" aria-label="Conversation trees">
        <div className="sidebar-topbar">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true">
              <Rabbit size={17} strokeWidth={2.1} />
            </span>
            <span>Rabbit Hole</span>
          </div>
          <button
            type="button"
            className="icon-button sidebar-toggle"
            onClick={() => setSidebarOpen(false)}
            aria-label="Hide sidebar"
            title="Hide sidebar"
          >
            <PanelLeftClose size={18} />
          </button>
        </div>

        <button
          type="button"
          className={`new-chat-button ${newChatMode ? "is-active" : ""}`}
          onClick={startNewChat}
          aria-current={newChatMode ? "page" : undefined}
        >
          <SquarePen size={20} strokeWidth={1.9} />
          <span>New chat</span>
        </button>

        <div className="sidebar-heading">
          <span>Chats</span>
          <span className="sidebar-count">{workspace.chats.length}</span>
        </div>

        <nav className="tree-nav" aria-label="Chats and branches">
          {workspace.chats.length ? (
            <ul className="tree-root-list">
              {workspace.chats.map((chat) => {
                const root = chat.nodes[chat.rootNodeId];
                if (!root) return null;
                return (
                  <TreeNodeItem
                    key={chat.id}
                    chat={chat}
                    node={root}
                    depth={0}
                    activeNodeId={workspace.activeChatId === chat.id ? workspace.activeNodeId : ""}
                    expandedIds={expandedIds}
                    onSelect={selectNode}
                    onToggle={toggleNode}
                  />
                );
              })}
            </ul>
          ) : (
            <p className="empty-chat-list">Your conversations will appear here.</p>
          )}
        </nav>

        {EXPERIMENT_MODE_AVAILABLE && devMode ? (
          <div className="sidebar-footer">
            <span className="provider-dot" />
            <span>Experiment mode</span>
            <span className="provider-name">Tools on</span>
          </div>
        ) : null}
      </aside>

      <section className="main-panel">
        <header className="main-header">
          <div className="main-header-left">
            {!sidebarOpen ? (
              <button
                type="button"
                className="icon-button sidebar-toggle sidebar-show-button"
                onClick={() => setSidebarOpen(true)}
                aria-label="Show sidebar"
                title="Show sidebar"
              >
                <span className="brand-mark sidebar-show-mark" aria-hidden="true">
                  <Rabbit size={17} strokeWidth={2.1} />
                </span>
                <PanelLeftOpen className="sidebar-show-icon" size={17} aria-hidden="true" />
              </button>
            ) : null}
            {newChatMode ? (
              <span className="path-current">New thought</span>
            ) : (
              <div className="breadcrumb" aria-label="Active branch path">
                {activePath.map((node, index) => (
                  <span className="breadcrumb-segment" key={node.id}>
                    {index > 0 ? <ChevronRight size={13} /> : null}
                    <span className={index === activePath.length - 1 ? "path-current" : ""}>
                      {index === 0 && activeChat ? activeChat.title : makeChatTitle(node.prompt)}
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="main-header-actions">
            {modelControlsVisible ? (
              <span className={`inference-badge is-${selectedInference.transport}`}>
                {selectedInference.transport === "relay" ? (
                  <OpenAIIcon size={13} />
                ) : selectedInference.transport === "groq" ? (
                  <Zap size={13} />
                ) : (
                  <Sparkles size={13} />
                )}{" "}
                {selectedInference.providerLabel} · {selectedInference.modelLabel}
              </span>
            ) : null}
            <button
              type="button"
              className={`icon-button model-controls-toggle ${modelControlsVisible ? "is-active" : ""}`}
              onClick={() => setModelControlsVisible((visible) => !visible)}
              aria-label={`${modelControlsVisible ? "Hide" : "Show"} model controls`}
              aria-pressed={modelControlsVisible}
              title={`${modelControlsVisible ? "Hide" : "Show"} model controls`}
            >
              <SlidersHorizontal size={16} />
            </button>
            {EXPERIMENT_MODE_AVAILABLE ? (
              <button
                type="button"
                className={`icon-button dev-mode-toggle ${devMode ? "is-active" : ""}`}
                onClick={toggleExperimentMode}
                aria-label={`${devMode ? "Disable" : "Enable"} experiment mode`}
                aria-pressed={devMode}
                title={`${devMode ? "Disable" : "Enable"} experiment mode`}
              >
                <FlaskConical size={16} />
              </button>
            ) : null}
            <button type="button" className="icon-button" onClick={resetWorkspace} aria-label="Start fresh">
              <RotateCcw size={16} />
            </button>
            <button
              type="button"
              className="icon-button theme-toggle"
              onClick={toggleColorTheme}
              aria-label={`Switch to ${colorTheme === "dark" ? "light" : "dark"} mode`}
              title={`Switch to ${colorTheme === "dark" ? "light" : "dark"} mode`}
            >
              {colorTheme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <form className="lock-demo-form" action="/api/auth/logout" method="post">
              <button
                type="submit"
                className="icon-button"
                aria-label="Lock demo"
                title="Lock demo"
              >
                <Lock size={15} />
              </button>
            </form>
            <span className="header-divider" aria-hidden="true" />
            <span className="guest-badge" title="Chats are saved only for this tab">
              <UserRound size={13} /> Guest
            </span>
            <button
              type="button"
              className="sign-in-button"
              onClick={() => setSignInOpen(true)}
              aria-haspopup="dialog"
            >
              <LogIn size={14} /> <span>Sign in</span>
            </button>
          </div>
          <div className="ipad-header-more">
            <button
              type="button"
              className={`icon-button ipad-more-button ${ipadMoreMenuOpen ? "is-active" : ""}`}
              onClick={() => setIpadMoreMenuOpen((open) => !open)}
              aria-label="More controls"
              aria-haspopup="menu"
              aria-expanded={ipadMoreMenuOpen}
            >
              <Ellipsis size={22} />
            </button>
            {ipadMoreMenuOpen ? (
              <div className="ipad-more-menu" role="menu" aria-label="More controls">
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={modelControlsVisible}
                  onClick={() => setModelControlsVisible((visible) => !visible)}
                >
                  <SlidersHorizontal size={19} />
                  <span className="ipad-more-menu-copy">
                    <strong>Model controls</strong>
                    <small>{selectedInference.providerLabel} · {selectedInference.modelLabel}</small>
                  </span>
                  <span className="ipad-more-menu-value">{modelControlsVisible ? "Shown" : "Hidden"}</span>
                </button>
                {EXPERIMENT_MODE_AVAILABLE ? (
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={devMode}
                    className={devMode ? "is-active" : undefined}
                    onClick={toggleExperimentMode}
                  >
                    <FlaskConical size={19} />
                    <span className="ipad-more-menu-copy">
                      <strong>Experiment mode</strong>
                      <small>Demo tools and fixtures</small>
                    </span>
                    <span className="ipad-more-menu-value">{devMode ? "On" : "Off"}</span>
                  </button>
                ) : null}
                <button type="button" role="menuitem" onClick={toggleColorTheme}>
                  {colorTheme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
                  <span className="ipad-more-menu-copy">
                    <strong>Appearance</strong>
                    <small>Switch to {colorTheme === "dark" ? "light" : "dark"} mode</small>
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setIpadMoreMenuOpen(false);
                    resetWorkspace();
                  }}
                >
                  <RotateCcw size={19} />
                  <span className="ipad-more-menu-copy">
                    <strong>Start fresh</strong>
                    <small>Reset this guest session</small>
                  </span>
                </button>
                <form className="ipad-more-menu-form" action="/api/auth/logout" method="post">
                  <button type="submit" role="menuitem">
                    <Lock size={19} />
                    <span className="ipad-more-menu-copy">
                      <strong>Lock demo</strong>
                      <small>Require the demo password again</small>
                    </span>
                  </button>
                </form>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setIpadMoreMenuOpen(false);
                    setSignInOpen(true);
                  }}
                >
                  <LogIn size={19} />
                  <span className="ipad-more-menu-copy">
                    <strong>Sign in</strong>
                    <small>Currently exploring as Guest</small>
                  </span>
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <div className="conversation-scroll" ref={scrollRef}>
          {newChatMode ? (
            <section className="new-chat-state">
              <span className="new-chat-mark" aria-hidden="true">
                <Rabbit size={23} strokeWidth={1.9} />
              </span>
              <h1>Which rabbit hole should we follow?</h1>
              <p>Start with a question. Follow any answer deeper, or branch sideways without losing the path behind you.</p>
            </section>
          ) : (
            <div className="conversation-path">
              {activePath.map((node, index) => {
                const children = activeChat ? getChildren(activeChat, node.id) : [];
                const activeBranchId = activePath[index + 1]?.id;
                return (
                  <article className="turn" key={node.id}>
                    {index > 0 ? (
                      <div className="path-connector" aria-hidden="true">
                        <span />
                      </div>
                    ) : null}

                    <div className="user-message">
                      {node.anchor ? (
                        <div className="anchor-context">
                          <Quote size={13} />
                          <span>“{node.anchor.quote}”</span>
                        </div>
                      ) : null}
                      <UserPrompt prompt={node.prompt} />
                    </div>

                    <div className="assistant-message">
                      <div className="assistant-head">
                        <ProviderIdentity model={node.model} />
                        {EXPERIMENT_MODE_AVAILABLE && devMode && node.latency ? (
                          <LatencySummary metrics={node.latency} />
                        ) : null}
                        {node.status === "complete" && node.providerConversationUrl ? (
                          <a
                            className="response-source-link"
                            href={node.providerConversationUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open in ChatGPT <ExternalLink size={11} />
                          </a>
                        ) : null}
                        <StatusMark status={node.status} />
                        {node.status === "streaming" && activeChat ? (
                          <button
                            type="button"
                            className="cancel-generation-button"
                            onClick={() => cancelGeneration(activeChat.id, node.id)}
                            aria-label={`Stop generating response to ${makeChatTitle(node.prompt)}`}
                          >
                            <Square size={9} fill="currentColor" /> Stop
                          </button>
                        ) : null}
                      </div>

                      {EXPERIMENT_MODE_AVAILABLE && devMode && node.latency ? (
                        <RelayTraceDetails metrics={node.latency} />
                      ) : null}

                      <div
                        className={`markdown-body ${node.status === "streaming" ? "is-streaming" : ""}`}
                        data-node-id={node.id}
                        onMouseUp={() => {
                          const nextSelection = getResponseSelection();
                          if (nextSelection?.nodeId) setSelection(nextSelection);
                        }}
                      >
                        {node.response ? (
                          <MarkdownResponse content={node.response} />
                        ) : node.status === "streaming" ? (
                          <span className="thinking-placeholder">
                            <span />
                            <span />
                            <span />
                          </span>
                        ) : (
                          <span className="cancelled-placeholder">No response was returned.</span>
                        )}
                      </div>

                      {children.length || node.status !== "streaming" ? (
                        <div className="response-actions-row">
                          {children.length ? (
                            <BranchShelf
                              branches={children}
                              activeBranchId={activeBranchId}
                              menuOpen={openBranchMenuId === node.id}
                              onToggleMenu={() =>
                                setOpenBranchMenuId((current) => (current === node.id ? null : node.id))
                              }
                              onSelect={(childId) => selectNode(activeChat.id, childId, true)}
                            />
                          ) : null}

                          {node.status !== "streaming" ? (
                            <div className="message-actions">
                              <button type="button" onClick={() => beginBranch(node.id)}>
                                <GitBranch size={14} />
                                <span className="branch-action-label-default">Branch here</span>
                                <span className="branch-action-label-ipad">Branch</span>
                              </button>
                              <button type="button" onClick={() => copyResponse(node)}>
                                {copiedNodeId === node.id ? <Check size={14} /> : <Copy size={14} />}
                                {copiedNodeId === node.id ? "Copied" : "Copy"}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <div className="composer-dock" ref={composerDockRef}>
          <form className="composer" onSubmit={submitPrompt}>
            {branchContext && branchParent ? (
              <div className="composer-context">
                <div className="composer-context-copy">
                  {branchContext.anchor ? <Quote size={13} /> : <GitBranch size={13} />}
                  <span>
                    <strong>{branchContext.anchor ? "Anchored to" : "Branching from"}</strong>{" "}
                    {branchContext.anchor ? `“${branchContext.anchor}”` : makeChatTitle(branchParent.prompt)}
                  </span>
                </div>
                <button type="button" onClick={() => setBranchContext(null)} aria-label="Cancel branch context">
                  <X size={14} />
                </button>
              </div>
            ) : null}

            {modelControlsVisible ? (
              <div className="inference-controls" aria-label="Model settings">
                {EXPERIMENT_MODE_AVAILABLE && devMode ? (
                  <span className="developer-controls-label" title="Experiment fixtures and workspace generators are enabled">
                    Experiments
                  </span>
                ) : null}
                <label>
                  <span>Model</span>
                  <select
                    value={inferenceOptionId}
                    onChange={(event) => {
                      const optionId = event.target.value as InferenceOptionId;
                      setInferenceOptionId(optionId);
                      if (optionId !== "mock") setPendingFixtureId(null);
                    }}
                    disabled={composerBlockedByGeneration}
                  >
                    {INFERENCE_OPTION_GROUPS.map((group) => (
                      <optgroup key={group.label} label={group.label}>
                        {group.optionIds.map((optionId) => {
                          const option = INFERENCE_OPTIONS[optionId];
                          return (
                            <option key={optionId} value={optionId}>
                              {option.providerLabel} · {option.modelLabel}
                            </option>
                          );
                        })}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <span
                  className="developer-model"
                  title={`${selectedInference.modelId} — ${selectedInference.description}`}
                >
                  {selectedInference.modelLabel}
                </span>
                {selectedInference.supportsOutputCap ? (
                  <label title="Choose a hard output-token cap, or Automatic to let the model stop naturally">
                    <span>Output cap</span>
                    <select
                      value={maxTokens}
                      onChange={(event) => {
                        const value = event.target.value;
                        setMaxTokens(
                          value === AUTOMATIC_OUTPUT_TOKENS
                            ? AUTOMATIC_OUTPUT_TOKENS
                            : Number(value) as OutputTokenLimit,
                        );
                      }}
                      disabled={composerBlockedByGeneration}
                    >
                      <option value={AUTOMATIC_OUTPUT_TOKENS}>Automatic</option>
                      {OUTPUT_TOKEN_OPTIONS.map((tokenCount) => (
                        <option key={tokenCount} value={tokenCount}>
                          {tokenCount} tokens
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
            ) : null}

            {inferenceOptionId === "chatgpt-relay" ? (
              <div className={`relay-panel is-${relayStatus}`} aria-live="polite">
                <div className="relay-status-row">
                  <span className="relay-status-icon" aria-hidden="true">
                    {relayStatus === "ready" ? (
                      <ShieldCheck size={16} />
                    ) : relayStatus === "rate-limited" ? (
                      <Clock3 size={16} />
                    ) : relayStatus === "checking" ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : (
                      <PlugZap size={16} />
                    )}
                  </span>
                  <span className="relay-status-copy">
                    <strong>
                      {relayStatus === "ready"
                        ? "ChatGPT connected locally"
                        : relayStatus === "rate-limited"
                          ? "ChatGPT is cooling down"
                        : relayStatus === "login-required"
                          ? "ChatGPT sign-in needed"
                          : relayStatus === "checking"
                            ? "Checking relay"
                            : "Connect ChatGPT Relay"}
                    </strong>
                    <span>{relayMessage}</span>
                  </span>
                  {relayStatus === "ready" || relayStatus === "rate-limited" ? (
                    <span className="relay-status-actions">
                      {relayStatus === "rate-limited" ? (
                        <button
                          type="button"
                          className="relay-override-button"
                          onClick={() => void overrideRelayCooldown()}
                          disabled={relayCooldownOverridePending}
                        >
                          {relayCooldownOverridePending ? (
                            <LoaderCircle size={13} className="spin" />
                          ) : (
                            <Zap size={13} />
                          )}
                          Override cooldown
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void checkRelayConnection()}
                        aria-label="Refresh relay connection"
                        title="Refresh connection"
                      >
                        <RefreshCw size={13} />
                      </button>
                      <button type="button" onClick={disconnectRelay}>Disconnect</button>
                    </span>
                  ) : null}
                </div>

                {EXPERIMENT_MODE_AVAILABLE && devMode && relaySession ? (
                  <div className="relay-session-metrics" aria-label="Relay session diagnostics">
                    <span>{relaySession.submissions} submitted</span>
                    <span>{relaySession.requestsReceived} received</span>
                    <span>{relaySession.duplicateRequests} duplicates blocked</span>
                    <span>{relaySession.pagesOpened} pages</span>
                    <span>{relaySession.traffic.requests} browser requests</span>
                    <span>{relaySession.traffic.chatgptApiRequests} ChatGPT API</span>
                    <span>{relaySession.protectionWarnings} protection warnings</span>
                    <span>{relaySession.cooldownOverrides ?? 0} cooldown overrides</span>
                    <span>{relaySession.prewarmEnabled ? "prewarm on" : "prewarm off"}</span>
                    <span>concurrency {relaySession.maxConcurrentGenerations}</span>
                  </div>
                ) : null}

                {relayStatus !== "ready" && relayStatus !== "rate-limited" ? (
                  <div className="relay-connect-row">
                    <label className="relay-token-field">
                      <span>Pairing token</span>
                      <input
                        type="password"
                        value={relayToken}
                        onChange={(event) => {
                          setRelayToken(event.target.value);
                          setRelayPaired(false);
                          setRelayStatus("disconnected");
                        }}
                        placeholder="Paste token from the relay terminal"
                        autoComplete="off"
                        spellCheck={false}
                        disabled={relayStatus === "checking"}
                      />
                    </label>
                    <button
                      type="button"
                      className="relay-connect-button"
                      onClick={() => void checkRelayConnection()}
                      disabled={!relayToken.trim() || relayStatus === "checking"}
                    >
                      Connect
                    </button>
                    <span className="relay-command" title="Run these from the Rabbit Hole project directory">
                      <Terminal size={12} /> <code>relay:login → relay</code>
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}

            {EXPERIMENT_MODE_AVAILABLE && commandPaletteVisible ? (
              <div
                id="composer-command-list"
                className="command-palette"
                role="listbox"
                aria-label="Composer commands"
              >
                <div className="command-palette-heading">
                  <span>
                    {composerValue.trimStart().toLowerCase().startsWith("/fixture")
                      ? "Mock fixtures"
                      : composerValue.trimStart().toLowerCase().startsWith("/demo")
                        ? "Demo workspaces"
                        : "Commands"}
                  </span>
                  <span>experiment mode</span>
                </div>
                <div className="command-options">
                  {commandOptions.length ? (
                    commandOptions.map((option, index) => (
                      <button
                        type="button"
                        id={`composer-command-${option.id}`}
                        key={option.id}
                        className={`command-option ${index === selectedCommandIndex ? "is-selected" : ""}`}
                        role="option"
                        aria-selected={index === selectedCommandIndex}
                        onMouseEnter={() => setSelectedCommandIndex(index)}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => runComposerCommand(option)}
                      >
                        <code>{option.command}</code>
                        <span className="command-option-copy">
                          <strong>{option.label}</strong>
                          <span>{option.description}</span>
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="command-empty">No matching command. Try /demo, /fixture, or /help.</div>
                  )}
                </div>
                <div className="command-palette-footer">↑↓ select · Enter choose · Esc close</div>
              </div>
            ) : null}

            <div className="composer-input-row">
              <textarea
                ref={composerRef}
                value={composerValue}
                onChange={(event) => {
                  setComposerValue(event.target.value);
                  setSelectedCommandIndex(0);
                  setCommandPaletteDismissed(false);
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter"
                    && document.documentElement.dataset.rabbitHolePlatform === "ipad"
                  ) {
                    return;
                  }

                  if (commandPaletteVisible) {
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                      event.preventDefault();
                      if (commandOptions.length) {
                        const direction = event.key === "ArrowDown" ? 1 : -1;
                        setSelectedCommandIndex(
                          (current) => (current + direction + commandOptions.length) % commandOptions.length,
                        );
                      }
                      return;
                    }

                    if (event.key === "Enter" || event.key === "Tab") {
                      const option = commandOptions[selectedCommandIndex] ?? commandOptions[0];
                      if (option) {
                        event.preventDefault();
                        runComposerCommand(option);
                      }
                      return;
                    }

                    if (event.key === "Escape") {
                      event.preventDefault();
                      setCommandPaletteDismissed(true);
                      return;
                    }
                  }

                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder={
                  newChatMode
                    ? "Ask the first question…"
                    : branchContext?.anchor
                      ? "What do you want to explore in this passage?"
                      : "Continue this path, or select response text to branch…"
                }
                rows={1}
                disabled={composerBlockedByGeneration}
                aria-label="Message Rabbit Hole"
                aria-controls={commandPaletteVisible ? "composer-command-list" : undefined}
                aria-activedescendant={
                  commandPaletteVisible && commandOptions[selectedCommandIndex]
                    ? `composer-command-${commandOptions[selectedCommandIndex].id}`
                    : undefined
                }
              />
              {composerBlockedByGeneration && activeChat && composerParent ? (
                <button
                  type="button"
                  className="send-button is-stop"
                  onClick={() => cancelGeneration(activeChat.id, composerParent.id)}
                  aria-label="Stop generation"
                  title="Stop generation"
                >
                  <Square size={12} fill="currentColor" />
                </button>
              ) : (
                <button
                  type="submit"
                  className="send-button"
                  disabled={
                    !composerValue.trim()
                    || (inferenceOptionId === "chatgpt-relay" && relayStatus !== "ready")
                  }
                  aria-label={isCommandInput ? "Run command" : "Send message"}
                >
                  <ArrowUp size={17} />
                </button>
              )}
            </div>
            <div className="composer-meta">
              <span>
                {EXPERIMENT_MODE_AVAILABLE && devMode && !composerValue
                  ? "Type / for experiment commands"
                  : newChatMode
                    ? "Creates a new tree"
                    : "Enter to send · Shift + Enter for a new line"}
              </span>
              {!newChatMode && activeNode && activeNode.status !== "streaming" ? (
                <button type="button" className="raw-branch-shortcut" onClick={() => beginBranch(activeNode.id)}>
                  <Plus size={12} /> Raw branch
                </button>
              ) : null}
            </div>
          </form>
        </div>
      </section>

      {signInOpen ? (
        <div className="auth-backdrop" role="presentation" onMouseDown={() => setSignInOpen(false)}>
          <section
            className="auth-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="icon-button auth-close"
              onClick={() => setSignInOpen(false)}
              aria-label="Close sign-in dialog"
              autoFocus
            >
              <X size={17} />
            </button>
            <span className="auth-mark" aria-hidden="true">
              <Rabbit size={21} strokeWidth={2.1} />
            </span>
            <h2 id="auth-dialog-title">Keep every rabbit hole</h2>
            <p className="auth-intro">
              Sign in to save every trail and continue exploring from any device.
            </p>
            <div className="guest-session-card">
              <span className="guest-session-icon" aria-hidden="true">
                <UserRound size={16} />
              </span>
              <span>
                <strong>You’re exploring as a guest</strong>
                <small>This session is available only in this browser tab.</small>
              </span>
            </div>
            <button type="button" className="auth-provider-button" disabled>
              <span className="provider-letter" aria-hidden="true">G</span>
              Continue with Google
              <small>Coming soon</small>
            </button>
            <button type="button" className="auth-provider-button" disabled>
              <span className="provider-letter provider-letter-email" aria-hidden="true">@</span>
              Continue with email
              <small>Coming soon</small>
            </button>
            <button type="button" className="continue-guest-button" onClick={() => setSignInOpen(false)}>
              Continue as guest
            </button>
            <p className="auth-footnote">Closing this tab ends the guest session. No account is created.</p>
          </section>
        </div>
      ) : null}

      {selection ? (
        <div
          className="selection-popover"
          style={{ left: selection.left, top: selection.top }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => beginBranch(selection.nodeId, selection.quote)}>
            <GitBranch size={14} /> Branch from selection
          </button>
        </div>
      ) : null}
    </main>
  );
}
