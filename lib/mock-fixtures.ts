export const MOCK_FIXTURES = [
  {
    id: "anchored",
    command: "anchored",
    label: "Anchored branch",
    description: "Respond to the currently selected passage; first branch from selected response text.",
    keywords: ["anchor", "quote", "selection", "branch"],
  },
  {
    id: "markdown-formatting",
    command: "markdown",
    label: "Markdown formatting",
    description: "Exercise headings, tables, code, Mermaid, task lists, and literal break tags.",
    keywords: ["format", "table", "mermaid", "hdd"],
  },
  {
    id: "long-response",
    command: "long",
    label: "Long response",
    description: "Render a long, sectioned answer for scrolling, selection, and branch testing.",
    keywords: ["scroll", "selection", "branch"],
  },
  {
    id: "slow-stream",
    command: "slow",
    label: "Slow streaming",
    description: "Stream a short deterministic response slowly to inspect loading behavior.",
    keywords: ["loading", "stream", "latency"],
  },
  {
    id: "simulated-error",
    command: "error",
    label: "Simulated error",
    description: "Return a deliberate provider error to exercise the interrupted-generation state.",
    keywords: ["failure", "failed", "503"],
  },
] as const;

export type MockFixtureSelection = (typeof MOCK_FIXTURES)[number];
export type MockFixtureId = MockFixtureSelection["id"];
export type StaticMockFixtureId = Exclude<MockFixtureId, "anchored">;

export function getMockFixtureSelection(id: string): MockFixtureSelection | undefined {
  return MOCK_FIXTURES.find((fixture) => fixture.id === id || fixture.command === id);
}
