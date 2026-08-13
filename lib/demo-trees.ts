import type { ChatTree, TurnNode } from "@/lib/conversation-tree";

type DemoFollowUp = {
  prompt: string;
  response: string;
  anchor?: string;
};

type DemoBranch = {
  prompt: string;
  response: string;
  anchor?: string;
  followUp?: DemoFollowUp;
};

type DemoTemplate = {
  title: string;
  prompt: string;
  response: string;
  branches: DemoBranch[];
};

const DEMO_TEMPLATES: DemoTemplate[] = [
  {
    title: "Rethink AI onboarding",
    prompt: "How should a small AI product redesign its onboarding?",
    response:
      "Treat the **first useful outcome as the tutorial**. Ask for a real goal, produce a small result immediately, and explain controls only when they become relevant.\n\nThe first session should feel like progress on the user’s work—not a rehearsal of the product’s features.",
    branches: [
      {
        anchor: "first useful outcome as the tutorial",
        prompt: "How would we measure whether the first session worked?",
        response:
          "Use a short activation chain:\n\n1. A real input is provided.\n2. A useful artifact is created.\n3. The artifact is edited, saved, or shared.\n\nTrack **time-to-value** and the percentage of sessions reaching the third event.",
        followUp: {
          anchor: "time-to-value",
          prompt: "Design a lightweight dashboard for that metric.",
          response:
            "Show the median and 90th-percentile time-to-value by acquisition source, with a funnel for each activation event. Add session replays only for the largest drop-off so the dashboard stays diagnostic rather than decorative.",
        },
      },
      {
        anchor: "explain controls only when they become relevant",
        prompt: "Which controls should remain hidden at first?",
        response:
          "Hide model selection, advanced formatting, sharing permissions, and automation settings until the user’s action makes each control relevant. Keep only the input, one strong example, and an obvious way to revise the result.",
      },
      {
        prompt: "Argue for keeping a traditional product tour.",
        response:
          "A short tour can still help when the product has an unfamiliar mental model or irreversible actions. The best case is a thirty-second orientation that names the workspace, the main action, and the escape hatch—then gets out of the way.",
      },
    ],
  },
  {
    title: "Design a focused launch",
    prompt: "How should a tiny team launch a developer tool without a large audience?",
    response:
      "Launch around **one painful job and one credible proof**. A narrow demonstration that saves a specific developer twenty minutes is more persuasive than a broad list of capabilities.\n\nUse the first launch to find language and objections, not to manufacture a viral moment.",
    branches: [
      {
        anchor: "one painful job and one credible proof",
        prompt: "What makes the proof credible?",
        response:
          "Use a real repository, show the before-and-after workflow, and publish the failure cases beside the success. Credibility rises when the audience can see exactly where the tool helps and where it stops.",
        followUp: {
          anchor: "failure cases",
          prompt: "How should we present limitations without weakening the launch?",
          response:
            "Frame each limitation as a boundary with a reason: unsupported environment, safety constraint, or work still in progress. Pair it with the workaround and the signal that would justify expanding support.",
        },
      },
      {
        anchor: "find language and objections",
        prompt: "Design the first week of customer conversations.",
        response:
          "Schedule five short sessions with the narrowest target persona. Ask each person to attempt the same job, note the words they use for the pain, and end by asking what would prevent them from using the tool tomorrow.",
      },
      {
        prompt: "What launch channel should the team avoid?",
        response:
          "Avoid channels that reward impressions but hide intent. A large generic audience can produce encouraging traffic while teaching almost nothing about whether the right developers understand and retain the product.",
      },
    ],
  },
  {
    title: "Plan a small conference",
    prompt: "What would make a 100-person technical conference genuinely memorable?",
    response:
      "Design for **conversations people could not have online**. Keep talks short, organize attendees around unresolved questions, and make every artifact—from badges to breaks—help people find the person they need to meet.",
    branches: [
      {
        anchor: "conversations people could not have online",
        prompt: "How should we structure the discussion sessions?",
        response:
          "Give each table one contested question, a facilitator, and a visible shared note. End with the strongest disagreement rather than a forced consensus; unresolved edges create better follow-up conversations.",
        followUp: {
          anchor: "strongest disagreement",
          prompt: "How can we carry those disagreements into the closing session?",
          response:
            "Ask each table to submit one claim the room should challenge. Cluster overlapping claims, let two participants argue each side for three minutes, then publish the open questions with owners for post-event follow-up.",
        },
      },
      {
        anchor: "badges to breaks",
        prompt: "Redesign the badge and break format.",
        response:
          "Put one current problem and one area of expertise on every badge. During breaks, mark several small zones by problem type so attendees can move toward the conversation they want instead of defaulting to people they already know.",
      },
      {
        prompt: "What should we deliberately cut?",
        response:
          "Cut parallel tracks, oversized sponsor booths, and long panels. Each one fragments attention or turns participants into spectators—the opposite of what a small gathering does best.",
      },
    ],
  },
  {
    title: "Choose a product roadmap",
    prompt: "How should a product team choose between reliability work and new features?",
    response:
      "Compare both options against **the next constraint on durable usage**. Reliability wins when failures interrupt the core job or erode trust; features win when retained users repeatedly reach a capability boundary.\n\nDo not average every request into one score. Name the constraint, then choose the smallest investment that tests whether it is real.",
    branches: [
      {
        anchor: "the next constraint on durable usage",
        prompt: "How can we identify that constraint from product data?",
        response:
          "Segment retained and churned users by the last meaningful event before they diverge. Combine that pattern with support severity and interview evidence; no single metric can distinguish friction from missing value.",
        followUp: {
          anchor: "last meaningful event",
          prompt: "Turn that into a two-week research plan.",
          response:
            "Instrument the three events nearest the divergence, review ten affected sessions, and interview five users from each segment. End the sprint with one falsifiable constraint statement and one cheap intervention.",
        },
      },
      {
        anchor: "erode trust",
        prompt: "Which reliability problems deserve roadmap priority?",
        response:
          "Prioritize silent data loss, inconsistent results, and failures in the core workflow. Cosmetic defects may be frequent, but trust-breaking failures create avoidance behavior that is much harder to reverse.",
      },
      {
        prompt: "Make the case for a fixed 70/30 allocation.",
        response:
          "A fixed allocation protects maintenance from short-term feature pressure and makes capacity legible. It is useful as a budgeting guardrail, but the team should still override it when evidence shows one category is the immediate constraint.",
      },
    ],
  },
];

function shuffled<T>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function buildDemoChat(template: DemoTemplate, createdAt: number): ChatTree {
  const rootId = crypto.randomUUID();
  const nodes: Record<string, TurnNode> = {
    [rootId]: {
      id: rootId,
      parentId: null,
      prompt: template.prompt,
      response: template.response,
      status: "complete",
      createdAt,
      model: "Mock · Generated demo",
    },
  };
  const branchCount = Math.random() < 0.5 ? 2 : 3;
  const branches = shuffled(template.branches).slice(0, branchCount);
  let timestamp = createdAt + 1;

  for (const branch of branches) {
    const branchId = crypto.randomUUID();
    nodes[branchId] = {
      id: branchId,
      parentId: rootId,
      prompt: branch.prompt,
      response: branch.response,
      status: "complete",
      createdAt: timestamp,
      model: "Mock · Generated demo",
      ...(branch.anchor
        ? { anchor: { sourceNodeId: rootId, quote: branch.anchor } }
        : {}),
    };
    timestamp += 1;

    if (branch.followUp && Math.random() < 0.8) {
      const followUpId = crypto.randomUUID();
      nodes[followUpId] = {
        id: followUpId,
        parentId: branchId,
        prompt: branch.followUp.prompt,
        response: branch.followUp.response,
        status: "complete",
        createdAt: timestamp,
        model: "Mock · Generated demo",
        ...(branch.followUp.anchor
          ? { anchor: { sourceNodeId: branchId, quote: branch.followUp.anchor } }
          : {}),
      };
      timestamp += 1;
    }
  }

  return {
    id: crypto.randomUUID(),
    title: template.title,
    rootNodeId: rootId,
    createdAt,
    updatedAt: timestamp,
    nodes,
  };
}

export function createRandomDemoChats(count: number): ChatTree[] {
  const templates = shuffled(DEMO_TEMPLATES).slice(0, Math.min(count, DEMO_TEMPLATES.length));
  const now = Date.now();
  return templates.map((template, index) => buildDemoChat(template, now - index));
}
