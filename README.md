# Arbor

Arbor is a desktop-first prototype for tree-structured AI conversations. Each chat is a recursive tree: the main pane renders the path to the active node, while the sidebar lets you move between sibling ideas without flattening them into one timeline.

## Prototype features

- Recursive, filesystem-style chat navigation
- Root-to-active conversation paths
- Raw branches from any assistant turn
- Quote-anchored branches created from selected response text
- Four budget-conscious models routed through Vercel AI Gateway
- Independent direct-Groq GPT-OSS fallback with server-enforced output caps
- Direct v0 Mini and v0 Pro options that use the separate v0 credit balance
- Optional local ChatGPT relay that uses the user’s own signed-in browser session
- Simulated word-by-word streaming through a Next.js route handler
- Local persistence with a seeded demonstration tree
- One-click reset to the demo state

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Use a signed-in ChatGPT session

Arbor includes an experimental local relay for the interview prototype. It launches a dedicated Chrome, Chromium, or Edge profile and drives the public ChatGPT interface from a process bound to `127.0.0.1`. Arbor never asks for a ChatGPT username or password, and browser cookies never leave the local relay profile.

For the first sign-in, stop any running relay and run:

```bash
npm run relay:login
```

This opens the dedicated profile as ordinary Chrome with no automation or debugging connection. Complete the security verification, sign in, confirm the ChatGPT composer appears, and then quit that dedicated browser completely.

Now start the relay:

```bash
npm run relay
```

On macOS, the relay opens its dedicated Chrome window behind the terminal so the pairing token stays visible and easy to copy. `relay:login` still brings Chrome forward because that step requires interaction.

Then:

1. Copy the pairing token printed by the relay.
2. In Arbor, open the model controls and select **ChatGPT Relay**.
3. Paste the token and choose **Connect**.

Every Arbor node starts a fresh ChatGPT conversation containing only its root-to-current branch transcript. That keeps roots and sibling branches isolated. The relay keeps one verified, empty background conversation prewarmed, checks it out atomically for the next request, and prepares its replacement in the background. Each request tab is closed after Arbor captures the response. The relay selects ChatGPT **Instant** for lower response latency. Completed relay responses include an **Open in ChatGPT** link so you can inspect the underlying conversation.

The relay submits exactly one prompt for each explicit Arbor send and never retries prompts automatically. Up to three submitted generations may stream concurrently, but their page-preparation and submission phases are serialized, so queued prompts never launch as a burst. If ChatGPT reports an account-protection warning, Arbor opens a one-hour circuit breaker: queued and new prompts fail locally without loading another ChatGPT page. Health checks and response polling inspect the local browser DOM; they do not submit prompts. Restarting the relay reuses an already-running dedicated browser on its local debugging port instead of opening another Chrome window.

Relay diagnostics are written as JSON lines to `.arbor/chatgpt-relay.log`. Follow them while reproducing a problem with `tail -f .arbor/chatgpt-relay.log`. Each send gets a request ID and stage timings; prompt text, pairing tokens, cookies, and page contents are intentionally omitted. Override the path with `ARBOR_RELAY_LOG=/path/to/log npm run relay` when needed.

Completed relay turns also record a latency breakdown. **ChatGPT** is the observed interval from submitting the prompt in ChatGPT until Arbor detects a stable completed response; it includes ChatGPT web rendering, 250 ms DOM polling, and the 450 ms capture-stability window, so it is not a pure server-inference measurement. **Relay setup** covers local queueing, fresh-page checkout or preparation, model selection, transcript entry, and submission. **Arbor UI/network** is measured separately as end-to-end time minus the relay's total time. In development mode, the response header shows end-to-end, ChatGPT, and relay-setup values; hover it for detailed phases and whether the fresh-chat pool was ready.

These controls reduce accidental load but cannot guarantee account safety. The relay automates ChatGPT's public web interface rather than an officially supported integration API. Use it only as a private, single-user prototype; use the OpenAI API or another documented integration before distributing Arbor.

The first login must use `relay:login` with a visible browser. The normal relay starts Chrome itself and attaches through a debugging port bound to `127.0.0.1`; it does not add Playwright’s automated-launch flags or any bot-detection bypasses. After the session has been established, `ARBOR_RELAY_HEADLESS=1 npm run relay` can reuse the profile without a window, although visible mode is easier to recover when ChatGPT requests verification. Set `ARBOR_BROWSER_PATH` if the relay cannot find a locally installed browser.

This is a demo integration, not an official ChatGPT API. It depends on ChatGPT’s rendered UI and may break when that UI changes. The official account-backed authorization documented for custom clients applies to [Codex App Server](https://learn.chatgpt.com/docs/app-server), not a general-purpose ChatGPT web API.

## Use AI Gateway and the direct Groq fallback

Add server-side credentials to `.env.local`:

```dotenv
AI_GATEWAY_API_KEY=your_gateway_key_here
GROQ_API_KEY=gsk_your_key_here
V0_API_KEY=your_v0_key_here
```

`AI_GATEWAY_API_KEY` funds Gateway models, `GROQ_API_KEY` keeps the independent direct-Groq backup available, and `V0_API_KEY` uses the separate v0 credit balance. Restart the development server after changing any key.

The model picker provides these paths:

- **AI Gateway · GPT-OSS 120B** — the default baseline, with Gateway choosing a cost-efficient inference provider
- **AI Gateway · Grok 4.1 Fast** — a fast, low-cost xAI model
- **AI Gateway · Gemini 2.5 Flash Lite** — a budget-oriented Google model
- **AI Gateway · Claude Haiku 4.5** — a fast, budget-oriented Anthropic model
- **Groq Direct · GPT-OSS 120B** — bypasses Gateway and uses `GROQ_API_KEY`
- **v0 Direct · v0 Mini** — the lowest-cost current v0 model for fast web-development tasks
- **v0 Direct · v0 Pro** — a more capable v0 model for web-development work
- **ChatGPT Relay · Instant** — uses the separate local signed-in browser relay
- **Mock · Simulated** — uses no model credits

The direct Groq path is a deliberate manual fallback, so a failed Gateway request cannot silently trigger a second paid generation. Paid API paths default to a 512-token output cap. The model controls let you choose Automatic, 128, 256, 512, or 1,024 tokens. Numeric choices are clamped by the server to a hard maximum of 1,024 even if the UI is bypassed. Automatic omits the output-token field, allowing the model to stop naturally at an end condition or its provider-defined maximum; it can therefore cost more than a numeric cap. Gateway requests are tagged for Arbor and ask Gateway to prefer the lowest-cost available provider.

The current v0 Platform API does not expose an output-token cap. Arbor therefore disables thinking, image generation, MCP servers, and skills for v0 requests and asks for concise Markdown responses. Each v0 request creates a private, `source: arbor` v0 chat containing the current Arbor branch transcript; these chats appear in the v0 account and consume v0 credits rather than AI Gateway credits.

Neither key is sent to the browser. The `/api/chat` route uses AI SDK Core for Gateway streaming and native `fetch` for the independent Groq path. Both feed the same incremental response UI, while Gateway stream errors are carried explicitly so account or provider failures are visible instead of appearing as empty answers.

## Test offline with Mock fixtures

Enable development mode with the flask button, then type `/` in the composer. `/fixture` opens the complete fixture catalog; type after it to filter, use ↑/↓ to select, and press Enter to choose. Choosing a fixture immediately adds its command—for example, `/fixture markdown`—as a test turn, switches the provider to Mock, and streams that fixture response. No placeholder prompt is needed.

Available commands:

- `/demo tree` — add one randomized conversation tree without calling a model
- `/demo forest` — add three randomized conversation trees without calling a model
- `/fixture anchored` — respond to an active quote-anchored branch
- `/fixture markdown` — headings, tables, code, Mermaid, tasks, and break tags
- `/fixture long` — long-answer scrolling, selection, and branching
- `/fixture slow` — deterministic slow streaming and loading states
- `/fixture error` — simulated provider failure
- `/help` — return these rules as a local `Arbor · Help` chat response

The demo commands are additive, so they preserve chats already in the workspace. The anchored fixture requires selecting response text and choosing **Branch from selection** first. Fixture names and descriptions live in `lib/mock-fixtures.ts`; their deterministic payloads live in `lib/mock-fixture-responses.ts`. The API rejects unknown, production, or non-Mock named fixture requests so the test path stays explicit. Demo trees and `/help` are generated locally and never call an inference provider.

## Production check

```bash
npm run lint
npm run build
```

The `/api/chat` route supports AI Gateway, direct Groq, direct v0, and the local mock without changing the tree interaction model. Run `npm test` for the provider-catalog and relay unit tests.
