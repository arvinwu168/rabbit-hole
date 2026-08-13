import test from "node:test";
import assert from "node:assert/strict";
import { buildContinuationMessages } from "../lib/conversation-tree.ts";
import {
  isColorTheme,
  oppositeColorTheme,
  resolveColorTheme,
} from "../lib/theme.ts";

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
