"use client";

import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  GitBranch,
  Leaf,
  LoaderCircle,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Quote,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
  X,
} from "lucide-react";
import { FormEvent, MouseEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  ChatTree,
  QuoteAnchor,
  TurnNode,
  WorkspaceState,
  cloneSeedWorkspace,
  getAncestorIds,
  getChildren,
  getNodePath,
  makeChatTitle,
} from "@/lib/arbor";

const STORAGE_KEY = "arbor-workspace-v1";
const DEVTOOLS_STORAGE_KEY = "arbor-devtools-visible";
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

function inferenceLabel(provider: InferenceProvider, maxTokens?: number): string {
  const option = INFERENCE_OPTIONS[provider];
  const tokenLabel = provider === "groq" && maxTokens ? ` · max ${maxTokens}` : "";
  return `${option.label.replace(" API", "")} · ${option.modelLabel}${tokenLabel}`;
}

function responseInferenceLabel(headers: Headers, fallback: string): string {
  const provider = headers.get("X-Arbor-Provider");
  const model = headers.get("X-Arbor-Model");
  const maxTokens = headers.get("X-Arbor-Max-Tokens");

  if (!provider || !model) return fallback;

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
  const [workspace, setWorkspace] = useState<WorkspaceState>(() => cloneSeedWorkspace());
  const [hydrated, setHydrated] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(["free-root", "free-acquisition", "free-activation"]),
  );
  const [composerValue, setComposerValue] = useState("");
  const [branchContext, setBranchContext] = useState<BranchContext | null>(null);
  const [selection, setSelection] = useState<TextSelection | null>(null);
  const [newChatMode, setNewChatMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [copiedNodeId, setCopiedNodeId] = useState<string | null>(null);
  const [openBranchMenuId, setOpenBranchMenuId] = useState<string | null>(null);
  const [inferenceProvider, setInferenceProvider] = useState<InferenceProvider>("groq");
  const [maxTokens, setMaxTokens] = useState(256);
  const [devToolsVisible, setDevToolsVisible] = useState(true);
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
  const selectedInferenceLabel = inferenceLabel(inferenceProvider, maxTokens);

  useEffect(() => {
    let restored: WorkspaceState | null = null;
    let restoredDevToolsVisibility: boolean | null = null;
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as WorkspaceState;
        if (parsed.chats?.length && parsed.activeChatId && parsed.activeNodeId) {
          restored = parsed;
        }
      }
      const savedDevToolsVisibility = window.localStorage.getItem(DEVTOOLS_STORAGE_KEY);
      if (savedDevToolsVisibility !== null) {
        restoredDevToolsVisibility = savedDevToolsVisibility === "true";
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }

    const frame = window.requestAnimationFrame(() => {
      if (restored) {
        setWorkspace(restored);
        const chat = restored.chats.find((item) => item.id === restored?.activeChatId);
        if (chat) setExpandedIds(new Set(getAncestorIds(chat, restored.activeNodeId)));
      }
      if (restoredDevToolsVisibility !== null) {
        setDevToolsVisible(restoredDevToolsVisibility);
      }
      setHydrated(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timeout = window.setTimeout(() => {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [hydrated, workspace]);

  useEffect(() => {
    if (!hydrated || !IS_DEVELOPMENT) return;
    window.localStorage.setItem(DEVTOOLS_STORAGE_KEY, String(devToolsVisible));
  }, [devToolsVisible, hydrated]);

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
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    anchor?: string,
  ) {
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, messages, anchor, provider: inferenceProvider, maxTokens }),
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

  function handleTextSelection(nodeId: string, event: MouseEvent<HTMLDivElement>) {
    const selected = window.getSelection();
    if (!selected || selected.isCollapsed || selected.rangeCount === 0) return;
    const anchorNode = selected.anchorNode;
    const focusNode = selected.focusNode;
    if (!anchorNode || !focusNode) return;
    if (!event.currentTarget.contains(anchorNode) || !event.currentTarget.contains(focusNode)) return;

    const quote = selected.toString().trim().replace(/\s+/g, " ");
    if (quote.length < 3) return;
    const range = selected.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const left = Math.max(132, Math.min(window.innerWidth - 132, rect.left + rect.width / 2));
    setSelection({ nodeId, quote: quote.slice(0, 480), left, top: rect.top - 9 });
  }

  async function copyResponse(node: TurnNode) {
    if (await writeToClipboard(node.response)) {
      setCopiedNodeId(node.id);
      window.setTimeout(() => setCopiedNodeId(null), 1200);
    } else {
      setCopiedNodeId(null);
    }
  }

  async function submitPrompt(event: FormEvent) {
    event.preventDefault();
    const prompt = composerValue.trim();
    if (!prompt || isGenerating) return;
    setComposerValue("");

    if (newChatMode || !activeChat || !activeNode) {
      const chatId = crypto.randomUUID();
      const nodeId = crypto.randomUUID();
      const now = Date.now();
      const rootNode: TurnNode = {
        id: nodeId,
        parentId: null,
        prompt,
        response: "",
        status: "streaming",
        createdAt: now,
        model: selectedInferenceLabel,
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
      await streamIntoNode(chatId, nodeId, prompt, [{ role: "user", content: prompt }]);
      return;
    }

    const parentId = branchContext?.parentId ?? activeNode.id;
    const parent = activeChat.nodes[parentId];
    if (!parent) return;
    const nodeId = crypto.randomUUID();
    const now = Date.now();
    const anchor: QuoteAnchor | undefined = branchContext?.anchor
      ? { sourceNodeId: parentId, quote: branchContext.anchor }
      : undefined;
    const newNode: TurnNode = {
      id: nodeId,
      parentId,
      prompt,
      response: "",
      status: "streaming",
      createdAt: now,
      model: selectedInferenceLabel,
      anchor,
    };
    const parentPath = getNodePath(activeChat, parentId);
    const messages = parentPath.flatMap((node) => [
      { role: "user" as const, content: node.prompt },
      { role: "assistant" as const, content: node.response },
    ]);
    messages.push({ role: "user", content: prompt });

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
    await streamIntoNode(activeChat.id, nodeId, prompt, messages, anchor?.quote);
  }

  function resetWorkspace() {
    if (!window.confirm("Reset Arbor to the seeded demo tree? Your local branches will be removed.")) return;
    const seed = cloneSeedWorkspace();
    window.localStorage.removeItem(STORAGE_KEY);
    setWorkspace(seed);
    setExpandedIds(new Set(["free-root", "free-acquisition", "free-activation"]));
    setBranchContext(null);
    setComposerValue("");
    setNewChatMode(false);
    setOpenBranchMenuId(null);
  }

  function startNewChat() {
    setNewChatMode(true);
    setBranchContext(null);
    setSelection(null);
    setOpenBranchMenuId(null);
    setComposerValue("");
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
        </nav>

        {IS_DEVELOPMENT && devToolsVisible ? (
          <div className="sidebar-footer">
            <span className="provider-dot" />
            <span>Development</span>
            <span className="provider-name">{selectedInference.label}</span>
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
            {IS_DEVELOPMENT && devToolsVisible ? (
              <span className={`inference-badge is-${inferenceProvider}`}>
                <Sparkles size={13} /> {selectedInference.label} · {selectedInference.modelLabel}
              </span>
            ) : null}
            {IS_DEVELOPMENT ? (
              <button
                type="button"
                className={`icon-button devtools-toggle ${devToolsVisible ? "is-active" : ""}`}
                onClick={() => setDevToolsVisible((visible) => !visible)}
                aria-label={`${devToolsVisible ? "Hide" : "Show"} development controls`}
                aria-pressed={devToolsVisible}
                title={`${devToolsVisible ? "Hide" : "Show"} development controls`}
              >
                <SlidersHorizontal size={16} />
              </button>
            ) : null}
            <button type="button" className="icon-button" onClick={resetWorkspace} aria-label="Reset demo">
              <RotateCcw size={16} />
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
                        <span className="assistant-avatar" aria-hidden="true">
                          <Leaf size={14} />
                        </span>
                        <span className="assistant-name">Arbor</span>
                        <span className="model-name">{node.model}</span>
                        <StatusMark status={node.status} />
                      </div>

                      <div
                        className={`markdown-body ${node.status === "streaming" ? "is-streaming" : ""}`}
                        onMouseUp={(event) => handleTextSelection(node.id, event)}
                      >
                        {node.response ? (
                          <ReactMarkdown>{node.response}</ReactMarkdown>
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

            {IS_DEVELOPMENT && devToolsVisible ? (
              <div className="developer-controls" aria-label="Development inference settings">
                <span className="developer-controls-label">Dev</span>
                <label>
                  <span>Inference</span>
                  <select
                    value={inferenceProvider}
                    onChange={(event) => setInferenceProvider(event.target.value as InferenceProvider)}
                    disabled={isGenerating}
                  >
                    <option value="groq">Groq API</option>
                    <option value="mock">Mock API</option>
                  </select>
                </label>
                <span className="developer-model" title={selectedInference.model}>
                  {selectedInference.modelLabel}
                </span>
                <label>
                  <span>Max output</span>
                  <select
                    value={maxTokens}
                    onChange={(event) => setMaxTokens(Number(event.target.value))}
                    disabled={isGenerating}
                  >
                    {MAX_TOKEN_OPTIONS.map((tokenCount) => (
                      <option key={tokenCount} value={tokenCount}>
                        {tokenCount} tokens
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}

            <div className="composer-input-row">
              <textarea
                ref={composerRef}
                value={composerValue}
                onChange={(event) => setComposerValue(event.target.value)}
                onKeyDown={(event) => {
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
              />
              <button
                type="submit"
                className="send-button"
                disabled={!composerValue.trim() || isGenerating}
                aria-label="Send message"
              >
                {isGenerating ? <LoaderCircle size={17} className="spin" /> : <ArrowUp size={17} />}
              </button>
            </div>
            <div className="composer-meta">
              <span>{newChatMode ? "Creates a new tree" : "Enter to send · Shift + Enter for a new line"}</span>
              {!newChatMode && activeNode ? (
                <button type="button" className="raw-branch-shortcut" onClick={() => beginBranch(activeNode.id)}>
                  <Plus size={12} /> Raw branch
                </button>
              ) : null}
            </div>
          </form>
        </div>
      </section>

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
