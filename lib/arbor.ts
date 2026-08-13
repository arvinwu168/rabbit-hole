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

const AUG_12 = new Date("2026-08-12T10:00:00-07:00").getTime();

const freeTierNodes: Record<string, TurnNode> = {
  "free-root": {
    id: "free-root",
    parentId: null,
    prompt: "Should a small developer-tools startup add a free tier?",
    response:
      "A free tier can work when the product naturally spreads between collaborators. The strongest version is not **giving the product away**; it is using individual adoption to create team-wide pull.\n\nThe main risk is attracting users who never encounter a reason to upgrade. Keep the complete solo workflow free, then charge where collaboration, governance, or scale begins.",
    status: "complete",
    createdAt: AUG_12,
    model: "Simulated",
  },
  "free-acquisition": {
    id: "free-acquisition",
    parentId: "free-root",
    prompt: "Model the acquisition upside. What would have to be true for this loop to work?",
    response:
      "The free tier becomes a distribution surface rather than a pricing discount. That requires a solo user to produce something another person must see, edit, approve, or reuse.\n\n**Activation—not sign-up volume—is the first metric to validate.** Define activation as completing the core job and inviting at least one collaborator within seven days.",
    status: "complete",
    createdAt: AUG_12 + 1,
    model: "Simulated",
    anchor: {
      sourceNodeId: "free-root",
      quote: "create team-wide pull",
    },
  },
  "free-activation": {
    id: "free-activation",
    parentId: "free-acquisition",
    prompt: "Which activation metric would give us the earliest trustworthy signal?",
    response:
      "Use a two-stage activation metric:\n\n1. **Value reached:** the user completes the core workflow in their first session.\n2. **Value transmitted:** someone else opens, comments on, or reuses the result within seven days.\n\nThe second event matters more. It proves the product is beginning to travel through a team rather than merely accumulating accounts.",
    status: "complete",
    createdAt: AUG_12 + 2,
    model: "Simulated",
    anchor: {
      sourceNodeId: "free-acquisition",
      quote: "Activation—not sign-up volume—is the first metric to validate.",
    },
  },
  "free-experiment": {
    id: "free-experiment",
    parentId: "free-activation",
    prompt: "Design a two-week experiment around that signal.",
    response:
      "Recruit 20 new users from one narrow persona and remove every onboarding step that does not lead to the core artifact. Give half a lightweight collaboration prompt immediately after completion; leave the other half unchanged.\n\nMeasure artifact completion, collaborator invitation, collaborator action, and the time between each event. Treat the experiment as directional—the sample is too small for statistical certainty, but large enough to expose where the loop breaks.",
    status: "complete",
    createdAt: AUG_12 + 3,
    model: "Simulated",
    anchor: {
      sourceNodeId: "free-activation",
      quote: "within seven days",
    },
  },
  "free-upgrade": {
    id: "free-upgrade",
    parentId: "free-acquisition",
    prompt: "Find the cleanest paid upgrade trigger.",
    response:
      "Charge when the product crosses from personal utility into organizational infrastructure. Shared workspaces, permissions, history, and reusable team templates are natural triggers because the buyer can connect them to coordination cost—not arbitrary usage limits.",
    status: "complete",
    createdAt: AUG_12 + 4,
    model: "Simulated",
  },
  "free-pricing": {
    id: "free-pricing",
    parentId: "free-root",
    prompt: "Design limits that protect conversion without crippling the free product.",
    response:
      "Let one person complete the product’s full core job. Limit the organizational layer instead: number of collaborators, shared projects, team history, permission controls, and automation volume.\n\nA free user should understand the product’s value before encountering the boundary. Otherwise the tier behaves like a demo, not a growth loop.",
    status: "complete",
    createdAt: AUG_12 + 5,
    model: "Simulated",
    anchor: {
      sourceNodeId: "free-root",
      quote: "Keep the complete solo workflow free",
    },
  },
  "free-counter": {
    id: "free-counter",
    parentId: "free-root",
    prompt: "Argue against the proposal.",
    response:
      "A free tier may be premature if the company has not yet found a repeatable paid use case. It can multiply support load, blur positioning, and optimize the team around activation before retention is understood.\n\nThe strongest counterproposal is a generous time-limited trial paired with concierge onboarding. Learn why serious users pay before engineering a permanent free boundary.",
    status: "complete",
    createdAt: AUG_12 + 6,
    model: "Simulated",
  },
};

export const SEED_WORKSPACE: WorkspaceState = {
  chats: [
    {
      id: "chat-free-tier",
      title: "Should we add a free tier?",
      rootNodeId: "free-root",
      createdAt: AUG_12,
      updatedAt: AUG_12 + 6,
      nodes: freeTierNodes,
    },
    {
      id: "chat-onboarding",
      title: "Rethink our AI onboarding",
      rootNodeId: "onboarding-root",
      createdAt: AUG_12 - 86_400_000,
      updatedAt: AUG_12 - 86_400_000,
      nodes: {
        "onboarding-root": {
          id: "onboarding-root",
          parentId: null,
          prompt: "How could an AI product teach itself without a traditional product tour?",
          response:
            "Make the first useful outcome the tutorial. Ask for a real goal, produce a small result immediately, and explain controls only when they become relevant. The user should learn the product by advancing their own work—not by rehearsing someone else’s example.",
          status: "complete",
          createdAt: AUG_12 - 86_400_000,
          model: "Simulated",
        },
      },
    },
    {
      id: "chat-conference",
      title: "Small conference strategy",
      rootNodeId: "conference-root",
      createdAt: AUG_12 - 172_800_000,
      updatedAt: AUG_12 - 172_800_000,
      nodes: {
        "conference-root": {
          id: "conference-root",
          parentId: null,
          prompt: "What would make a 100-person technical conference genuinely memorable?",
          response:
            "Design for conversations people could not have online. Keep talks short, organize attendees around unresolved questions, and make every artifact—from badges to breaks—help people find the person they need to meet.",
          status: "complete",
          createdAt: AUG_12 - 172_800_000,
          model: "Simulated",
        },
      },
    },
  ],
  activeChatId: "chat-free-tier",
  activeNodeId: "free-activation",
};

export function cloneSeedWorkspace(): WorkspaceState {
  return JSON.parse(JSON.stringify(SEED_WORKSPACE)) as WorkspaceState;
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
