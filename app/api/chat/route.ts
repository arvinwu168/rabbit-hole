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
};

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "openai/gpt-oss-120b";
const DEFAULT_MAX_TOKENS = 256;
const MIN_MAX_TOKENS = 32;
const MAX_MAX_TOKENS = 1024;

function normalizeMaxTokens(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_MAX_TOKENS;
  return Math.min(MAX_MAX_TOKENS, Math.max(MIN_MAX_TOKENS, Math.floor(value)));
}

function inferenceHeaders(provider: string, model: string, maxTokens: number): HeadersInit {
  return {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Arbor-Provider": provider,
    "X-Arbor-Model": model,
    "X-Arbor-Max-Tokens": String(maxTokens),
  };
}

function responseFor(prompt: string, anchor?: string): string {
  const normalized = prompt.toLowerCase();

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

async function groqResponse(body: ChatRequest, request: Request, maxTokens: number): Promise<Response> {
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
      max_completion_tokens: maxTokens,
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

  if (provider === "groq") {
    return groqResponse(body, request, maxTokens);
  }

  const prompt = body.prompt ?? body.messages?.at(-1)?.content ?? "Explore this idea.";
  return new Response(createMockStream(responseFor(prompt, body.anchor), request.signal), {
    headers: inferenceHeaders("Mock", "simulated", maxTokens),
  });
}
