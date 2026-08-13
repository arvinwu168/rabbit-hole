type MockMessage = {
  role: "user" | "assistant";
  content: string;
};

type MockRequest = {
  messages?: MockMessage[];
  prompt?: string;
  anchor?: string;
};

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

function splitForStreaming(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [text];
}

export async function POST(request: Request) {
  const body = (await request.json()) as MockRequest;
  const prompt = body.prompt ?? body.messages?.at(-1)?.content ?? "Explore this idea.";
  const words = splitForStreaming(responseFor(prompt, body.anchor));
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const word of words) {
        if (request.signal.aborted) break;
        controller.enqueue(encoder.encode(word));
        await new Promise((resolve) => setTimeout(resolve, 18 + Math.random() * 24));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Arbor-Provider": "mock",
    },
  });
}
