import test from "node:test";
import assert from "node:assert/strict";
import {
  buildContinuationMessages,
  getChildren,
  getChildrenBySubtreeRecency,
  getVisibleBranchesByInteractionRecency,
  markNodePathInteracted,
  sortBranchesByInteractionRecency,
  sortChatsBySubtreeRecency,
} from "../lib/conversation-tree.ts";
import {
  isColorTheme,
  oppositeColorTheme,
  resolveColorTheme,
} from "../lib/theme.ts";
import {
  DEMO_BIOME_TREE_COUNT,
  DEMO_FOREST_TREE_COUNT,
  createRandomDemoBiome,
  createRandomDemoChats,
} from "../lib/demo-trees.ts";

function turn(overrides = {}) {
  return {
    id: "turn-1",
    parentId: null,
    prompt: "Explain the approach.",
    response: "",
    status: "cancelled",
    createdAt: 1,
    model: "v0 Direct · v0 Mini",
    ...overrides,
  };
}

test("continuing after a cancelled empty response never sends an empty assistant message", () => {
  assert.deepEqual(
    buildContinuationMessages([turn()], "Try a different approach."),
    [
      { role: "user", content: "Explain the approach." },
      { role: "user", content: "Try a different approach." },
    ],
  );
});

test("continuing after cancellation preserves partial output and marks it incomplete", () => {
  assert.deepEqual(
    buildContinuationMessages(
      [turn({ response: "The first step is", status: "cancelled" })],
      "Please continue more concisely.",
    ),
    [
      { role: "user", content: "Explain the approach." },
      {
        role: "assistant",
        content: "The first step is\n\n[Response stopped by the user before completion.]",
      },
      { role: "user", content: "Please continue more concisely." },
    ],
  );
});

test("provider error text is UI state and is not replayed as assistant context", () => {
  assert.deepEqual(
    buildContinuationMessages(
      [turn({ response: "Generation was interrupted: upstream failed", status: "error" })],
      "Retry.",
    ),
    [
      { role: "user", content: "Explain the approach." },
      { role: "user", content: "Retry." },
    ],
  );
});

test("main-chat branch clips put the most recently created sibling first", () => {
  const root = turn({ id: "root" });
  const olderBranch = turn({ id: "older", parentId: root.id, createdAt: 2 });
  const newerBranch = turn({ id: "newer", parentId: root.id, createdAt: 5 });
  const recentDescendant = turn({ id: "recent", parentId: olderBranch.id, createdAt: 10 });
  const chat = {
    id: "chat",
    title: "Ordering",
    rootNodeId: root.id,
    createdAt: 1,
    updatedAt: 10,
    nodes: Object.fromEntries(
      [root, olderBranch, newerBranch, recentDescendant].map((node) => [node.id, node]),
    ),
  };

  assert.deepEqual(getChildren(chat, root.id).map((node) => node.id), ["newer", "older"]);
});

test("main-chat branch clips prefer recently viewed or edited siblings", () => {
  const branches = [
    turn({ id: "newest-created", createdAt: 30 }),
    turn({ id: "recently-edited", createdAt: 10, lastInteractedAt: 50 }),
    turn({ id: "recently-viewed", createdAt: 20, lastInteractedAt: 60 }),
    turn({ id: "older", createdAt: 5 }),
  ];

  assert.deepEqual(
    sortBranchesByInteractionRecency(branches).map((node) => node.id),
    ["recently-viewed", "recently-edited", "newest-created", "older"],
  );
});

test("viewing a descendant makes every branch on its path recent", () => {
  const root = turn({ id: "root" });
  const branch = turn({ id: "branch", parentId: root.id, createdAt: 2 });
  const descendant = turn({ id: "descendant", parentId: branch.id, createdAt: 3 });
  const sibling = turn({ id: "sibling", parentId: root.id, createdAt: 4 });
  const chat = {
    id: "chat",
    title: "Interaction tracking",
    rootNodeId: root.id,
    createdAt: 1,
    updatedAt: 4,
    nodes: Object.fromEntries([root, branch, descendant, sibling].map((node) => [node.id, node])),
  };

  const viewed = markNodePathInteracted(chat, descendant.id, 100);

  assert.equal(viewed.nodes[root.id].lastInteractedAt, 100);
  assert.equal(viewed.nodes[branch.id].lastInteractedAt, 100);
  assert.equal(viewed.nodes[descendant.id].lastInteractedAt, 100);
  assert.equal(viewed.nodes[sibling.id].lastInteractedAt, undefined);
  assert.equal(chat.nodes[branch.id].lastInteractedAt, undefined);
});

test("visible branch clips keep club order while recent interactions protect membership", () => {
  const root = turn({ id: "root" });
  const oldest = turn({ id: "oldest", parentId: root.id, createdAt: 10 });
  const middle = turn({ id: "middle", parentId: root.id, createdAt: 20 });
  const newest = turn({ id: "newest", parentId: root.id, createdAt: 30 });
  const hidden = turn({ id: "hidden", parentId: root.id, createdAt: 5 });
  let chat = {
    id: "chat",
    title: "Stable branch shelf",
    rootNodeId: root.id,
    createdAt: 1,
    updatedAt: 30,
    nodes: Object.fromEntries([root, oldest, middle, newest, hidden].map((node) => [node.id, node])),
  };

  assert.deepEqual(
    getVisibleBranchesByInteractionRecency(getChildren(chat, root.id)).map((node) => node.id),
    ["newest", "middle", "oldest"],
  );

  chat = markNodePathInteracted(chat, middle.id, 100);
  assert.deepEqual(
    getVisibleBranchesByInteractionRecency(getChildren(chat, root.id)).map((node) => node.id),
    ["newest", "middle", "oldest"],
  );

  chat = markNodePathInteracted(chat, hidden.id, 110);
  assert.deepEqual(
    getVisibleBranchesByInteractionRecency(getChildren(chat, root.id)).map((node) => node.id),
    ["hidden", "newest", "middle"],
  );

  chat = markNodePathInteracted(chat, middle.id, 120);
  assert.deepEqual(
    getVisibleBranchesByInteractionRecency(getChildren(chat, root.id)).map((node) => node.id),
    ["hidden", "newest", "middle"],
  );

  chat = markNodePathInteracted(chat, oldest.id, 130);
  assert.deepEqual(
    getVisibleBranchesByInteractionRecency(getChildren(chat, root.id)).map((node) => node.id),
    ["oldest", "hidden", "middle"],
  );
});

test("sidebar siblings are ordered by the newest node anywhere in each subtree", () => {
  const root = turn({ id: "root" });
  const olderBranch = turn({ id: "older", parentId: root.id, createdAt: 2 });
  const newerBranch = turn({ id: "newer", parentId: root.id, createdAt: 5 });
  const recentDescendant = turn({ id: "recent", parentId: olderBranch.id, createdAt: 10 });
  const chat = {
    id: "chat",
    title: "Ordering",
    rootNodeId: root.id,
    createdAt: 1,
    updatedAt: 10,
    nodes: Object.fromEntries(
      [root, olderBranch, newerBranch, recentDescendant].map((node) => [node.id, node]),
    ),
  };

  assert.deepEqual(
    getChildrenBySubtreeRecency(chat, root.id).map((node) => node.id),
    ["older", "newer"],
  );
});

test("sidebar chat roots are ordered by their newest descendant", () => {
  const olderRoot = turn({ id: "older-root", createdAt: 1 });
  const recentDescendant = turn({ id: "recent", parentId: olderRoot.id, createdAt: 10 });
  const newerRoot = turn({ id: "newer-root", createdAt: 5 });
  const olderChatWithRecentBranch = {
    id: "older-chat",
    title: "Older root",
    rootNodeId: olderRoot.id,
    createdAt: 1,
    updatedAt: 10,
    nodes: { [olderRoot.id]: olderRoot, [recentDescendant.id]: recentDescendant },
  };
  const newerChat = {
    id: "newer-chat",
    title: "Newer root",
    rootNodeId: newerRoot.id,
    createdAt: 5,
    updatedAt: 5,
    nodes: { [newerRoot.id]: newerRoot },
  };

  assert.deepEqual(
    sortChatsBySubtreeRecency([newerChat, olderChatWithRecentBranch]).map((chat) => chat.id),
    ["older-chat", "newer-chat"],
  );
});

test("color theme follows the system until the user saves an override", () => {
  assert.equal(resolveColorTheme(null, false), "light");
  assert.equal(resolveColorTheme(null, true), "dark");
  assert.equal(resolveColorTheme("light", true), "light");
  assert.equal(resolveColorTheme("dark", false), "dark");
  assert.equal(resolveColorTheme("unknown", true), "dark");
});

test("color theme validation and toggling remain binary", () => {
  assert.equal(isColorTheme("light"), true);
  assert.equal(isColorTheme("dark"), true);
  assert.equal(isColorTheme("system"), false);
  assert.equal(oppositeColorTheme("light"), "dark");
  assert.equal(oppositeColorTheme("dark"), "light");
});

function maximumTreeDepth(chat) {
  const depthFor = (node) => {
    if (node.parentId === null) return 0;
    return 1 + depthFor(chat.nodes[node.parentId]);
  };

  return Math.max(...Object.values(chat.nodes).map(depthFor));
}

test("demo biome is ten forests and every generated tree is deeper", () => {
  const forest = createRandomDemoChats(DEMO_FOREST_TREE_COUNT);
  const biome = createRandomDemoBiome();

  assert.equal(forest.length, DEMO_FOREST_TREE_COUNT);
  assert.equal(DEMO_BIOME_TREE_COUNT, DEMO_FOREST_TREE_COUNT * 10);
  assert.equal(biome.length, DEMO_BIOME_TREE_COUNT);
  assert.equal(new Set(biome.map((chat) => chat.id)).size, DEMO_BIOME_TREE_COUNT);
  assert.ok(biome.every((chat) => maximumTreeDepth(chat) >= 5));
  assert.ok(
    biome.every((chat) =>
      Object.values(chat.nodes).every(
        (node) => node.parentId === null || Boolean(chat.nodes[node.parentId]),
      ),
    ),
  );
});
