import type { StaticMockFixtureId } from "@/lib/mock-fixtures";

type MockFixtureResponse = {
  response?: string;
  streamDelayMs?: number;
  error?: {
    status: number;
    message: string;
  };
};

const STORAGE_FORMAT_DEMO = [
  "# 3.5-inch hard-disk drives: a quick walk-through",
  "",
  "The 3.5-inch form factor is the workhorse of desktops, servers, NAS boxes, and external enclosures. Within that single size, drives trade off **capacity**, **speed**, **reliability**, power use, and cost.",
  "",
  "## 1. Interface: how the drive talks to the host",
  "",
  "| Interface | Typical connector | Max transfer rate* | Main use case | Compatibility notes |",
  "| --- | --- | ---: | --- | --- |",
  "| SATA I | 7-pin data + 15-pin power | 150 MB/s | Legacy desktops | Modern SATA ports remain backward compatible. |",
  "| SATA II | Same SATA connectors | 300 MB/s | Older desktops and enclosures | Works with SATA I and SATA III hosts. |",
  "| SATA III | Same SATA connectors | 600 MB/s | Current HDDs and many SSDs | The interface is faster than a mechanical disk's sustained throughput. |",
  "| SAS-3 | 29-pin combined connector | 1,200 MB/s | Enterprise servers | Requires a SAS controller; SATA controllers cannot drive SAS disks. |",
  "",
  "*The figures above are theoretical interface ceilings, not guaranteed disk throughput.*",
  "",
  "> **Practical rule:** for a modern desktop or NAS, SATA III is the default. Choose SAS only when the surrounding server infrastructure supports it.",
  "",
  "## 2. A simple selection flow",
  "",
  "```mermaid",
  "flowchart LR",
  "  A[Choose a workload] --> B{Always-on NAS?}",
  "  B -- Yes --> C[NAS-rated CMR drive]",
  "  B -- No --> D{Enterprise server?}",
  "  D -- Yes --> E[Enterprise SATA or SAS]",
  "  D -- No --> F[Desktop SATA drive]",
  "```",
  "",
  "## 3. Inspecting a drive in code",
  "",
  "Use a typed record when normalizing inventory data:",
  "",
  "```ts",
  "type Drive = {",
  "  model: string;",
  "  capacityTB: number;",
  "  rpm: 5400 | 7200;",
  "  recording: 'CMR' | 'SMR';",
  "};",
  "",
  "const suitableForNas = (drive: Drive) =>",
  "  drive.recording === 'CMR' && drive.capacityTB >= 8;",
  "```",
  "",
  "Inline values such as `7200 RPM`, `CMR`, and `SATA III` should remain visually distinct.",
  "",
  "## Buying checklist",
  "",
  "- [x] Confirm the interface and available bay size",
  "- [ ] Check whether the drive uses CMR or SMR recording",
  "- [ ] Compare workload rating and warranty",
  "- [ ] Verify noise and power requirements",
  "",
  "## Literal break-tag compatibility",
  "",
  "- 初次沸騰時先用中小火，待出現大量泡沫立即轉小火或暫時抬開鍋蓋。<br>- 使用寬口鍋或在鍋邊抹一層薄薄的油，可減少泡沫黏附。",
  "",
  "For most NAS purchases, recording technology and workload rating matter more than peak interface speed.",
].join("\n");

const LONG_RESPONSE_DEMO = [
  "# Long-response layout test",
  "",
  "This deterministic fixture is intentionally long enough to exercise vertical scrolling, text selection, copying, and branches created near the beginning, middle, or end of an answer.",
  "",
  "## Beginning: establish the idea",
  "",
  "Start with a concrete claim that can be selected independently: **a useful interface should preserve context without making context feel heavy**. The surrounding explanation should remain readable at normal widths and should not cause the conversation column to jump as content arrives.",
  "",
  "A short list checks repeated vertical rhythm:",
  "",
  "- Keep the primary path visually calm.",
  "- Make alternative branches easy to recognize.",
  "- Preserve the relationship between a quote and its follow-up.",
  "- Keep controls discoverable without dominating the answer.",
  "",
  "## Middle: create branchable passages",
  "",
  "The middle of a long response is where navigation behavior becomes visible. Select this sentence and create a quote-anchored branch to verify that the source passage remains legible after the new node appears.",
  "",
  "A second paragraph gives the layout enough height to test scrolling. Good branch navigation should let a developer move between siblings without losing the active path or confusing an older simulated answer with a new live-model response.",
  "",
  "### A compact comparison",
  "",
  "| Test | Expected result |",
  "| --- | --- |",
  "| Scroll | Composer remains available |",
  "| Select | Selection command appears near the quote |",
  "| Branch | New node retains its parent relationship |",
  "| Copy | Full response reaches the clipboard |",
  "",
  "## End: verify completion",
  "",
  "The final section should arrive without clipping or covering the composer. Once streaming completes, the message actions should become available and the model identity should name this exact fixture.",
  "",
  "> End-of-fixture marker: if you can read this sentence, the complete long response rendered.",
].join("\n");

const SLOW_STREAM_DEMO =
  "This response is intentionally streaming one small piece at a time. Watch the loading state, cursor, auto-scroll behavior, and the transition to completed message actions. The wording and timing are deterministic so repeated visual checks behave consistently.";

export function anchoredFixtureResponse(anchor: string): string {
  return `You branched from this specific passage: **“${anchor}”**.\n\nThat phrase matters because it contains an assumption the broader answer depends on. I would explore it in three passes: define precisely what it means, identify what evidence would make it true, and describe the cheapest way to test it. This keeps the branch tied to the original thought while giving it room to develop independently.`;
}

export const MOCK_FIXTURE_RESPONSES: Record<StaticMockFixtureId, MockFixtureResponse> = {
  "markdown-formatting": {
    response: STORAGE_FORMAT_DEMO,
    streamDelayMs: 24,
  },
  "long-response": {
    response: LONG_RESPONSE_DEMO,
    streamDelayMs: 18,
  },
  "slow-stream": {
    response: SLOW_STREAM_DEMO,
    streamDelayMs: 140,
  },
  "simulated-error": {
    error: {
      status: 503,
      message: "Simulated fixture error: the mock inference provider is unavailable.",
    },
  },
};
