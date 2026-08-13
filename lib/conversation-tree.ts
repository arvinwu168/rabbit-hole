export type TurnStatus = "complete" | "streaming" | "cancelled" | "error";

export type QuoteAnchor = {
  sourceNodeId: string;
  quote: string;
};

export type RelayTrafficMetrics = {
  observedMs: number;
  requests: number;
  responses: number;
  failed: number;
  documentLoads: number;
  chatgptApiRequests: number;
  firstPartyRequests: number;
  status403: number;
  status429: number;
  status5xx: number;
  methods: Record<string, number>;
  resourceTypes: Record<string, number>;
  owners: Record<string, number>;
  statusClasses: Record<string, number>;
  topRoutes: Array<{ route: string; count: number }>;
};

export type RelayTraceMetrics = {
  requestId: string;
  clientRequestId: string | null;
  pageId: string | null;
  pageRole: string;
  requestKind: string;
};

export type RelayLatencyMetrics = {
  queueMs: number;
  browserSetupMs: number;
  chatgptTimeToFirstTextMs: number;
  chatgptGenerationMs: number;
  chatgptObservedMs: number;
  relayOverheadMs: number;
  relayTotalMs: number;
  stabilityWindowMs: number;
  prewarmHit?: boolean;
  endToEndMs?: number;
  clientOverheadMs?: number;
  clientUiMs?: number;
  traffic?: RelayTrafficMetrics;
  trace?: RelayTraceMetrics;
};

export type TurnNode = {
  id: string;
  parentId: string | null;
  prompt: string;
  response: string;
  status: TurnStatus;
  createdAt: number;
  model: string;
  anchor?: QuoteAnchor;
  providerConversationUrl?: string;
  latency?: RelayLatencyMetrics;
};

export type ChatTree = {
  id: string;
  title: string;
  rootNodeId: string;
  createdAt: number;
  updatedAt: number;
  nodes: Record<string, TurnNode>;
};

export type WorkspaceState = {
  chats: ChatTree[];
  activeChatId: string;
  activeNodeId: string;
};

export type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
  anchor?: string;
};

export function createEmptyWorkspace(): WorkspaceState {
  return {
    chats: [],
    activeChatId: "",
    activeNodeId: "",
  };
}

export function getNodePath(chat: ChatTree, nodeId: string): TurnNode[] {
  const path: TurnNode[] = [];
  let current: TurnNode | undefined = chat.nodes[nodeId];

  while (current) {
    path.unshift(current);
    current = current.parentId ? chat.nodes[current.parentId] : undefined;
  }

  return path;
}

export function getChildren(chat: ChatTree, parentId: string): TurnNode[] {
  return Object.values(chat.nodes)
    .filter((node) => node.parentId === parentId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function getAncestorIds(chat: ChatTree, nodeId: string): string[] {
  return getNodePath(chat, nodeId).map((node) => node.id);
}

export function buildContinuationMessages(
  parentPath: TurnNode[],
  prompt: string,
  anchor?: QuoteAnchor,
): ConversationMessage[] {
  const messages: ConversationMessage[] = [];

  for (const node of parentPath) {
    messages.push({
      role: "user",
      content: node.prompt,
      ...(node.anchor?.quote ? { anchor: node.anchor.quote } : {}),
    });

    const response = node.response.trim();
    if (!response || node.status === "error") continue;

    messages.push({
      role: "assistant",
      content: node.status === "cancelled"
        ? `${response}\n\n[Response stopped by the user before completion.]`
        : response,
    });
  }

  messages.push({
    role: "user",
    content: prompt,
    ...(anchor?.quote ? { anchor: anchor.quote } : {}),
  });

  return messages;
}

export function makeChatTitle(prompt: string): string {
  const trimmed = prompt.trim().replace(/\s+/g, " ");
  return trimmed.length > 42 ? `${trimmed.slice(0, 42).trim()}…` : trimmed;
}
