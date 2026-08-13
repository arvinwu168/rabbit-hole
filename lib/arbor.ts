export type TurnStatus = "complete" | "streaming" | "error";

export type QuoteAnchor = {
  sourceNodeId: string;
  quote: string;
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

export function makeChatTitle(prompt: string): string {
  const trimmed = prompt.trim().replace(/\s+/g, " ");
  return trimmed.length > 42 ? `${trimmed.slice(0, 42).trim()}…` : trimmed;
}
