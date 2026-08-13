# Arbor

Arbor is a desktop-first prototype for tree-structured AI conversations. Each chat is a recursive tree: the main pane renders the path to the active node, while the sidebar lets you move between sibling ideas without flattening them into one timeline.

## Prototype features

- Recursive, filesystem-style chat navigation
- Root-to-active conversation paths
- Raw branches from any assistant turn
- Quote-anchored branches created from selected response text
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

Every Arbor node starts a fresh ChatGPT conversation containing only its root-to-current branch transcript. That keeps roots and sibling branches isolated. Each user-initiated request gets a temporary background tab that is closed after Arbor captures the response. The relay selects ChatGPT **Instant** for lower response latency. Completed relay responses include an **Open in ChatGPT** link so you can inspect the underlying conversation.

The relay submits exactly one prompt for each explicit Arbor send, runs at most three generations concurrently, queues additional sends locally, and never retries prompts automatically. It does not impose an arbitrary per-minute or hourly quota. Health checks and response polling inspect the local browser DOM; they do not submit ChatGPT prompts. If ChatGPT itself shows a temporary usage warning, Arbor blocks new sends only while that warning remains visible. Restarting the relay reuses an already-running dedicated browser on its local debugging port instead of opening another Chrome window.

Relay diagnostics are written as JSON lines to `.arbor/chatgpt-relay.log`. Follow them while reproducing a problem with `tail -f .arbor/chatgpt-relay.log`. Each send gets a request ID and stage timings; prompt text, pairing tokens, cookies, and page contents are intentionally omitted. Override the path with `ARBOR_RELAY_LOG=/path/to/log npm run relay` when needed.

Completed relay turns also record a latency breakdown. **ChatGPT** is the observed interval from submitting the prompt in ChatGPT until Arbor detects a stable completed response; it includes ChatGPT web rendering, 250 ms DOM polling, and the 450 ms capture-stability window, so it is not a pure server-inference measurement. **Arbor** is end-to-end time minus that observed ChatGPT interval and includes local queueing, background-tab setup, transcript entry, and loopback transport. In development mode, the response header shows the end-to-end, ChatGPT, and Arbor values; hover it for the detailed phases.

These controls reduce accidental load but cannot guarantee account safety. The relay automates ChatGPT's public web interface rather than an officially supported integration API. Use it only as a private, single-user prototype; use the OpenAI API or another documented integration before distributing Arbor.

The first login must use `relay:login` with a visible browser. The normal relay starts Chrome itself and attaches through a debugging port bound to `127.0.0.1`; it does not add Playwright’s automated-launch flags or any bot-detection bypasses. After the session has been established, `ARBOR_RELAY_HEADLESS=1 npm run relay` can reuse the profile without a window, although visible mode is easier to recover when ChatGPT requests verification. Set `ARBOR_BROWSER_PATH` if the relay cannot find a locally installed browser.

This is a demo integration, not an official ChatGPT API. It depends on ChatGPT’s rendered UI and may break when that UI changes. The official account-backed authorization documented for custom clients applies to [Codex App Server](https://learn.chatgpt.com/docs/app-server), not a general-purpose ChatGPT web API.

## Test with Groq

Add a server-side key to `.env.local`:

```bash
GROQ_API_KEY=gsk_your_key_here
```

Restart the development server after changing the key. The development controls above the composer let you switch between the mock and Groq APIs and choose a maximum output of 128, 256, 512, or 1,024 tokens. Use the sliders button in the header to hide or restore the model controls, and the flask button to enable or disable development-only testing UI while reviewing the clean product UI. Both choices persist across reloads. The output cap is automatic until you choose one, and the server enforces a hard 1,024-token ceiling.

The Groq key is never sent to the browser. The `/api/chat` route calls Groq with native `fetch` and converts its event stream into the plain-text stream consumed by the UI.

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

The `/api/chat` route supports both a local mock and Groq's OpenAI-compatible API without changing the tree interaction model.
