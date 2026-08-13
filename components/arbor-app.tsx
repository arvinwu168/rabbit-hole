"use client";

import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FlaskConical,
  GitBranch,
  Leaf,
  LoaderCircle,
  LogIn,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Quote,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
  UserRound,
  X,
  Zap,
} from "lucide-react";
import {
  FormEvent,
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
  TurnNode,
  WorkspaceState,
  createEmptyWorkspace,
  getAncestorIds,
  getChildren,
  getNodePath,
  makeChatTitle,
} from "@/lib/arbor";
import { createRandomDemoChats } from "@/lib/demo-trees";
import {
  MOCK_FIXTURES,
  getMockFixtureSelection,
  type MockFixtureId,
  type MockFixtureSelection,
} from "@/lib/mock-fixtures";

const LEGACY_WORKSPACE_STORAGE_KEY = "arbor-workspace-v1";
const GUEST_WORKSPACE_STORAGE_KEY = "arbor-guest-workspace-v1";
const LEGACY_DEMO_CHAT_IDS = new Set([
  "chat-free-tier",
  "chat-onboarding",
  "chat-conference",
]);
const MODEL_CONTROLS_STORAGE_KEY = "arbor-model-controls-visible";
const DEV_MODE_STORAGE_KEY = "arbor-dev-mode";
const IS_DEVELOPMENT = process.env.NODE_ENV === "development";

type InferenceProvider = "mock" | "groq";

const INFERENCE_OPTIONS: Record<
  InferenceProvider,
  { label: string; model: string; modelLabel: string }
> = {
  groq: {
    label: "Groq API",
    model: "openai/gpt-oss-120b",
    modelLabel: "GPT-OSS 120B",
  },
  mock: {
    label: "Mock API",
    model: "simulated",
    modelLabel: "Simulated",
  },
};

const MAX_TOKEN_OPTIONS = [128, 256, 512, 1024] as const;
type TokenLimit = "automatic" | (typeof MAX_TOKEN_OPTIONS)[number];

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
    label: "Developer command help",
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
    "# Developer commands",
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

function inferenceLabel(provider: InferenceProvider, maxTokens?: number): string {
  const option = INFERENCE_OPTIONS[provider];
  const tokenLabel = provider === "groq" && maxTokens ? ` · max ${maxTokens}` : "";
  return `${option.label.replace(" API", "")} · ${option.modelLabel}${tokenLabel}`;
}

function responseInferenceLabel(headers: Headers, fallback: string): string {
  const provider = headers.get("X-Arbor-Provider");
  const model = headers.get("X-Arbor-Model");
  const maxTokens = headers.get("X-Arbor-Max-Tokens");
  const fixture = headers.get("X-Arbor-Fixture");

  if (!provider || !model) return fallback;

  if (fixture) {
    const fixtureSelection = getMockFixtureSelection(fixture);
    if (fixtureSelection) return `${provider} · ${fixtureSelection.label}`;
  }

  const modelLabel =
    model === "openai/gpt-oss-120b" ? "GPT-OSS 120B" : model === "simulated" ? "Simulated" : model;
  const tokenLabel = provider === "Groq" && maxTokens ? ` · max ${maxTokens}` : "";
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

function ProviderIdentity({ model }: { model: string }) {
  const segments = model.split(" · ").map((segment) => segment.trim()).filter(Boolean);
  let provider = segments.shift() ?? "AI";
  let details = segments.join(" · ");

  if (provider === "Simulated") {
    provider = "Mock";
    details = "Simulated";
  }

  const providerKey = provider.toLowerCase();
  const isArbor = providerKey === "arbor";
  const isMock = providerKey === "mock";
  const isGroq = providerKey === "groq";
  const isGrok = providerKey === "grok";

  return (
    <>
      <span
        className={`response-provider-icon ${isArbor ? "is-arbor" : isMock ? "is-mock" : isGroq ? "is-groq" : isGrok ? "is-grok" : "is-generic"}`}
        aria-hidden="true"
      >
        {isArbor ? (
          <Leaf size={14} strokeWidth={2.2} />
        ) : isMock ? (
          <FlaskConical size={13} />
        ) : isGroq ? (
          <Zap size={13} />
        ) : (
          <Sparkles size={13} />
        )}
      </span>
      <span className="response-provider-name">{provider}</span>
      {details ? <span className="model-name">{details}</span> : null}
    </>
  );
}

function MermaidDiagram({ chart }: { chart: string }) {
  const reactId = useId();
  const diagramId = `arbor-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [svg, setSvg] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
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
            primaryColor: "#edf5f0",
            primaryTextColor: "#20241f",
            primaryBorderColor: "#226449",
            lineColor: "#5f675e",
            secondaryColor: "#f5f6f1",
            tertiaryColor: "#ffffff",
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
  }, [chart, diagramId]);

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
    return <span className="message-status is-error">Generation stopped</span>;
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

function getBranchBaseLabel(branch: TurnNode): string {
  return branch.anchor ? `“${branch.anchor.quote}”` : makeChatTitle(branch.prompt);
}

function getBranchLabel(branch: TurnNode, siblings: TurnNode[]): string {
  const baseLabel = getBranchBaseLabel(branch);
  const branchIndex = siblings.findIndex((sibling) => sibling.id === branch.id);
  const duplicateIndex = siblings
    .slice(0, branchIndex)
    .filter((sibling) => getBranchBaseLabel(sibling) === baseLabel).length;

  return duplicateIndex ? `${baseLabel} · ${duplicateIndex + 1}` : baseLabel;
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
            {branch.anchor ? <Quote size={11} /> : <GitBranch size={12} />}
            <span>{getBranchLabel(branch, branches)}</span>
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
            More… <ChevronDown size={12} className={menuOpen ? "is-open" : ""} />
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
                      {branch.anchor ? <Quote size={12} /> : <GitBranch size={13} />}
                    </span>
                    <span className="branch-menu-copy">
                      <span className="branch-menu-label">{getBranchLabel(branch, branches)}</span>
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

export function ArborApp() {
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
  const [inferenceProvider, setInferenceProvider] = useState<InferenceProvider>("groq");
  const [maxTokens, setMaxTokens] = useState<TokenLimit>("automatic");
  const [modelControlsVisible, setModelControlsVisible] = useState(true);
  const [devMode, setDevMode] = useState(false);
  const [pendingFixtureId, setPendingFixtureId] = useState<MockFixtureId | null>(null);
  const [pendingHelp, setPendingHelp] = useState(false);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [commandPaletteDismissed, setCommandPaletteDismissed] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeChat = useMemo(
    () => workspace.chats.find((chat) => chat.id === workspace.activeChatId) ?? workspace.chats[0],
    [workspace],
  );
  const activeNode = activeChat?.nodes[workspace.activeNodeId] ?? activeChat?.nodes[activeChat?.rootNodeId];
  const activePath = useMemo(
    () => (activeChat && activeNode ? getNodePath(activeChat, activeNode.id) : []),
    [activeChat, activeNode],
  );
  const isGenerating = workspace.chats.some((chat) =>
    Object.values(chat.nodes).some((node) => node.status === "streaming"),
  );
  const selectedInference = INFERENCE_OPTIONS[inferenceProvider];
  const effectiveMaxTokens = devMode && typeof maxTokens === "number" ? maxTokens : undefined;
  const pendingFixture = pendingFixtureId ? getMockFixtureSelection(pendingFixtureId) : undefined;
  const selectedInferenceLabel =
    inferenceProvider === "mock" && pendingFixture
      ? `Mock · ${pendingFixture.label}`
      : inferenceLabel(inferenceProvider, effectiveMaxTokens);
  const isCommandInput =
    IS_DEVELOPMENT && devMode && composerValue.trimStart().startsWith("/");
  const commandOptions = useMemo(
    () => (isCommandInput && !commandPaletteDismissed ? composerCommandOptions(composerValue) : []),
    [commandPaletteDismissed, composerValue, isCommandInput],
  );
  const commandPaletteVisible = isCommandInput && !commandPaletteDismissed;

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

  useEffect(() => {
    let restored: WorkspaceState | null = null;
    let restoredModelControlsVisibility: boolean | null = null;
    let restoredDevMode = false;
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
      if (IS_DEVELOPMENT) {
        restoredDevMode = window.localStorage.getItem(DEV_MODE_STORAGE_KEY) === "true";
      }
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
      if (IS_DEVELOPMENT) setDevMode(restoredDevMode);
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
    if (!hydrated || !IS_DEVELOPMENT) return;
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, String(devMode));
  }, [devMode, hydrated]);

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

  useLayoutEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;

    composer.style.height = "auto";
    composer.style.height = `${Math.min(composer.scrollHeight, 200)}px`;
    composer.style.overflowY = composer.scrollHeight > 200 ? "auto" : "hidden";
  }, [composerValue]);

  useEffect(() => {
    if (!activeNode) return;
    const frame = window.requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeNode]);

  useEffect(() => {
    const closeFloatingControls = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".selection-popover")) setSelection(null);
      if (!target.closest(".branch-overflow")) setOpenBranchMenuId(null);
    };
    const clearOnScroll = () => {
      setSelection(null);
      setOpenBranchMenuId(null);
    };
    const scrollElement = scrollRef.current;
    document.addEventListener("pointerdown", closeFloatingControls);
    window.addEventListener("resize", clearOnScroll);
    scrollElement?.addEventListener("scroll", clearOnScroll);
    return () => {
      document.removeEventListener("pointerdown", closeFloatingControls);
      window.removeEventListener("resize", clearOnScroll);
      scrollElement?.removeEventListener("scroll", clearOnScroll);
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

  async function streamIntoNode(
    chatId: string,
    nodeId: string,
    prompt: string,
    messages: Array<{ role: "user" | "assistant"; content: string; anchor?: string }>,
    anchor?: string,
    fixtureId?: MockFixtureId,
  ) {
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          messages,
          anchor,
          provider: inferenceProvider,
          devMode: IS_DEVELOPMENT && devMode,
          ...(effectiveMaxTokens ? { maxTokens: effectiveMaxTokens } : {}),
          ...(fixtureId ? { fixtureId } : {}),
        }),
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

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        content += decoder.decode(value, { stream: true });
        updateNode(chatId, nodeId, { response: content });
      }

      updateNode(chatId, nodeId, { status: "complete", response: content });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown inference error";
      updateNode(chatId, nodeId, {
        status: "error",
        response: `Generation was interrupted: ${detail.slice(0, 320)}`,
      });
    }
  }

  function selectNode(chatId: string, nodeId: string) {
    const chat = workspace.chats.find((item) => item.id === chatId);
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
    setInferenceProvider("mock");
    setPendingHelp(false);
    setPendingFixtureId(option.fixture.id);
    setComposerValue(option.command);
    setSelectedCommandIndex(0);
    setCommandPaletteDismissed(true);
  }

  async function submitPrompt(event: FormEvent) {
    event.preventDefault();
    const prompt = composerValue.trim();
    if (!prompt || isGenerating) return;

    if (isCommandInput && !pendingFixtureId && !pendingHelp) {
      const selectedOption = commandOptions[selectedCommandIndex] ?? commandOptions[0];
      if (selectedOption) runComposerCommand(selectedOption);
      return;
    }

    const fixtureId = pendingFixtureId ?? undefined;
    const helpResponse = pendingHelp ? developerHelpResponse() : undefined;
    const requestInferenceLabel = helpResponse
      ? "Arbor · Help"
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
    const messages: Array<{
      role: "user" | "assistant";
      content: string;
      anchor?: string;
    }> = parentPath.flatMap((node) => [
      {
        role: "user" as const,
        content: node.prompt,
        ...(node.anchor?.quote ? { anchor: node.anchor.quote } : {}),
      },
      { role: "assistant" as const, content: node.response },
    ]);
    messages.push({
      role: "user",
      content: prompt,
      ...(anchor?.quote ? { anchor: anchor.quote } : {}),
    });

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

  const branchParent = branchContext && activeChat ? activeChat.nodes[branchContext.parentId] : null;

  return (
    <main className={`app-shell ${sidebarOpen ? "" : "sidebar-collapsed"}`}>
      <aside className="sidebar" aria-label="Conversation trees">
        <div className="sidebar-topbar">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true">
              <Leaf size={16} strokeWidth={2.2} />
            </span>
            <span>Arbor</span>
          </div>
          <button type="button" className="icon-button" onClick={startNewChat} aria-label="New chat">
            <SquarePen size={17} />
          </button>
        </div>

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

        {IS_DEVELOPMENT && devMode ? (
          <div className="sidebar-footer">
            <span className="provider-dot" />
            <span>Development mode</span>
            <span className="provider-name">Tools on</span>
          </div>
        ) : null}
      </aside>

      <section className="main-panel">
        <header className="main-header">
          <div className="main-header-left">
            <button
              type="button"
              className="icon-button sidebar-toggle"
              onClick={() => setSidebarOpen((value) => !value)}
              aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            >
              {sidebarOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
            </button>
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
              <span className={`inference-badge is-${inferenceProvider}`}>
                <Sparkles size={13} /> {selectedInference.label} · {selectedInference.modelLabel}
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
            {IS_DEVELOPMENT ? (
              <button
                type="button"
                className={`icon-button dev-mode-toggle ${devMode ? "is-active" : ""}`}
                onClick={() => {
                  const nextDevMode = !devMode;
                  setDevMode(nextDevMode);
                  if (nextDevMode) {
                    setModelControlsVisible(true);
                  } else {
                    setPendingFixtureId(null);
                    setPendingHelp(false);
                    if (composerValue.trimStart().startsWith("/")) setComposerValue("");
                  }
                }}
                aria-label={`${devMode ? "Disable" : "Enable"} development mode`}
                aria-pressed={devMode}
                title={`${devMode ? "Disable" : "Enable"} development mode`}
              >
                <FlaskConical size={16} />
              </button>
            ) : null}
            <button type="button" className="icon-button" onClick={resetWorkspace} aria-label="Start fresh">
              <RotateCcw size={16} />
            </button>
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
        </header>

        <div className="conversation-scroll" ref={scrollRef}>
          {newChatMode ? (
            <section className="new-chat-state">
              <span className="new-chat-mark" aria-hidden="true">
                <GitBranch size={22} />
              </span>
              <h1>Where should this thought begin?</h1>
              <p>Start with a question. Every answer can become several paths without losing where it came from.</p>
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
                        <StatusMark status={node.status} />
                      </div>

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
                        ) : (
                          <span className="thinking-placeholder">
                            <span />
                            <span />
                            <span />
                          </span>
                        )}
                      </div>

                      {children.length ? (
                        <BranchShelf
                          branches={children}
                          activeBranchId={activeBranchId}
                          menuOpen={openBranchMenuId === node.id}
                          onToggleMenu={() =>
                            setOpenBranchMenuId((current) => (current === node.id ? null : node.id))
                          }
                          onSelect={(childId) => selectNode(activeChat.id, childId)}
                        />
                      ) : null}

                      {node.status !== "streaming" ? (
                        <div className="message-actions">
                          <button type="button" onClick={() => beginBranch(node.id)}>
                            <GitBranch size={14} /> Branch here
                          </button>
                          <button type="button" onClick={() => copyResponse(node)}>
                            {copiedNodeId === node.id ? <Check size={14} /> : <Copy size={14} />}
                            {copiedNodeId === node.id ? "Copied" : "Copy"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <div className="composer-dock">
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
                {IS_DEVELOPMENT && devMode ? (
                  <span className="developer-controls-label" title="Developer fixtures and workspace generators are enabled">
                    Dev tools
                  </span>
                ) : null}
                <label>
                  <span>Model</span>
                  <select
                    value={inferenceProvider}
                    onChange={(event) => {
                      const provider = event.target.value as InferenceProvider;
                      setInferenceProvider(provider);
                      if (provider !== "mock") setPendingFixtureId(null);
                    }}
                    disabled={isGenerating}
                  >
                    <option value="groq">Groq API</option>
                    <option value="mock">Mock API</option>
                  </select>
                </label>
                <span className="developer-model" title={selectedInference.model}>
                  {selectedInference.modelLabel}
                </span>
                {IS_DEVELOPMENT && devMode ? (
                  <label title="Automatic lets the provider and model decide when to stop">
                    <span>Output cap</span>
                    <select
                      value={maxTokens}
                      onChange={(event) => {
                        const value = event.target.value;
                        setMaxTokens(value === "automatic" ? "automatic" : (Number(value) as TokenLimit));
                      }}
                      disabled={isGenerating || inferenceProvider !== "groq"}
                    >
                      <option value="automatic">Automatic</option>
                      {MAX_TOKEN_OPTIONS.map((tokenCount) => (
                        <option key={tokenCount} value={tokenCount}>
                          {tokenCount} tokens
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
            ) : null}

            {IS_DEVELOPMENT && commandPaletteVisible ? (
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
                  <span>development only</span>
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
                disabled={isGenerating}
                aria-label="Message Arbor"
                aria-controls={commandPaletteVisible ? "composer-command-list" : undefined}
                aria-activedescendant={
                  commandPaletteVisible && commandOptions[selectedCommandIndex]
                    ? `composer-command-${commandOptions[selectedCommandIndex].id}`
                    : undefined
                }
              />
              <button
                type="submit"
                className="send-button"
                disabled={!composerValue.trim() || isGenerating}
                aria-label={isCommandInput ? "Run command" : "Send message"}
              >
                {isGenerating ? <LoaderCircle size={17} className="spin" /> : <ArrowUp size={17} />}
              </button>
            </div>
            <div className="composer-meta">
              <span>
                {IS_DEVELOPMENT && devMode && !composerValue
                  ? "Type / for developer commands"
                  : newChatMode
                    ? "Creates a new tree"
                    : "Enter to send · Shift + Enter for a new line"}
              </span>
              {!newChatMode && activeNode ? (
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
              <Leaf size={20} strokeWidth={2.2} />
            </span>
            <h2 id="auth-dialog-title">Keep every branch</h2>
            <p className="auth-intro">
              Sign in to save your conversation trees and continue exploring them from any device.
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
