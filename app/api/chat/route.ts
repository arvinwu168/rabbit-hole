type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type InferenceProvider = "mock" | "groq";

type ChatRequest = {
  messages?: ChatMessage[];
  prompt?: string;
  anchor?: string;
  provider?: InferenceProvider;
  maxTokens?: number;
  devMode?: boolean;
};

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "openai/gpt-oss-120b";
const MIN_MAX_TOKENS = 32;
const MAX_MAX_TOKENS = 1024;

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

function normalizeMaxTokens(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(MAX_MAX_TOKENS, Math.max(MIN_MAX_TOKENS, Math.floor(value)));
}

function inferenceHeaders(provider: string, model: string, maxTokens?: number): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Arbor-Provider": provider,
    "X-Arbor-Model": model,
  };

  if (maxTokens) headers["X-Arbor-Max-Tokens"] = String(maxTokens);
  return headers;
}

function responseFor(prompt: string, anchor?: string, fixturesEnabled = false): string {
  const normalized = prompt.toLowerCase();

  if (
    fixturesEnabled &&
    /3[.\s-]?5.?inch|hard.?disk|hard drive|hdd|storage format|markdown demo/.test(normalized)
  ) {
    return STORAGE_FORMAT_DEMO;
  }

  if (/metric|measure|signal|success/.test(normalized)) {
    return "Start with the earliest behavior that proves value moved from one person to another. A useful metric should be **specific, observable, and close to the product’s core job**.\n\nI would track: completion of the core workflow, an invitation or share, and a meaningful action by the recipient. The last event is the strongest signal because it shows the product is creating a loop rather than collecting passive sign-ups.";
  }

  if (/test|experiment|validate/.test(normalized)) {
    return "Run the smallest test that could disprove the idea. Recruit a narrow cohort, define one behavior you expect to change, and put a short clock on the experiment.\n\n- Keep the audience consistent.\n- Change one meaningful part of the experience.\n- Watch behavior, not stated preference.\n- Write the decision rule before seeing the result.\n\nThe goal is not certainty. It is learning which assumption deserves the next week of work.";
  }

  if (/price|pricing|paid|upgrade|limit/.test(normalized)) {
    return "Place the boundary where personal value becomes organizational value. Let an individual understand and complete the core job; charge for coordination, scale, governance, or repeatability.\n\nThat creates a boundary users can explain to themselves: *I am paying because this now matters to my team*, not because the product arbitrarily stopped working.";
  }

  if (/against|risk|wrong|counter|fail/.test(normalized)) {
    return "The strongest argument against this direction is that it may optimize the interface before the underlying behavior is proven. A tree can preserve alternatives, but it can also encourage endless exploration instead of synthesis.\n\nThe product should therefore make the active path calm and readable, keep branches lightweight, and eventually help users compare or close branches. The tree is useful only if it improves decisions—not merely if it records more thinking.";
  }

  if (anchor) {
    return `That phrase matters because it contains an assumption the broader answer depends on: **“${anchor}”**.\n\nI would explore it in three passes: define precisely what it means, identify what evidence would make it true, and describe the cheapest way to test it. This keeps the branch tied to the original thought while giving it room to develop independently.`;
  }

  return "There are two useful ways to explore this branch. First, make the hidden assumption explicit: what must be true for the idea to work? Second, look for the nearest decision the exploration should change.\n\nA good next step is to write one concrete hypothesis, one counterargument, and one small test. That turns an interesting direction into something you can evaluate rather than simply continue discussing.";
}

function createMockStream(text: string, signal: AbortSignal): ReadableStream<Uint8Array> {
  const words = text.match(/\S+\s*/g) ?? [text];
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const word of words) {
        if (signal.aborted) break;
        controller.enqueue(encoder.encode(word));
        await new Promise((resolve) => setTimeout(resolve, 18 + Math.random() * 24));
      }
      controller.close();
    },
  });
}

function createGroqTextStream(upstream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = upstream.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let buffer = "";

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data:")) continue;

            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;

            const chunk = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const content = chunk.choices?.[0]?.delta?.content;
            if (content) controller.enqueue(encoder.encode(content));
          }
        }

        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

async function groqResponse(body: ChatRequest, request: Request, maxTokens?: number): Promise<Response> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return new Response("GROQ_API_KEY is not configured on the server.", { status: 503 });
  }

  const messages = body.messages?.length
    ? body.messages
    : [{ role: "user" as const, content: body.prompt ?? "Explore this idea." }];

  const upstream = await fetch(GROQ_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      stream: true,
      ...(maxTokens ? { max_completion_tokens: maxTokens } : {}),
    }),
    cache: "no-store",
    signal: request.signal,
  });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text();
    return new Response(detail || "Groq generation failed.", {
      status: upstream.status || 502,
      headers: inferenceHeaders("Groq", GROQ_MODEL, maxTokens),
    });
  }

  return new Response(createGroqTextStream(upstream.body), {
    headers: inferenceHeaders("Groq", GROQ_MODEL, maxTokens),
  });
}

export async function POST(request: Request) {
  let body: ChatRequest;

  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return new Response("Invalid JSON request body.", { status: 400 });
  }

  const provider: InferenceProvider = body.provider === "groq" ? "groq" : "mock";
  const maxTokens = normalizeMaxTokens(body.maxTokens);
  const fixturesEnabled = process.env.NODE_ENV !== "production" && body.devMode === true;

  if (provider === "groq") {
    return groqResponse(body, request, maxTokens);
  }

  const prompt = body.prompt ?? body.messages?.at(-1)?.content ?? "Explore this idea.";
  return new Response(createMockStream(responseFor(prompt, body.anchor, fixturesEnabled), request.signal), {
    headers: inferenceHeaders("Mock", "simulated", maxTokens),
  });
}
