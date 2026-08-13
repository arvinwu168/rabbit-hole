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

Then:

1. Copy the pairing token printed by the relay.
2. In Arbor, open the model controls and select **ChatGPT Relay**.
3. Paste the token and choose **Connect**.

Every Arbor node starts a fresh ChatGPT conversation containing only its root-to-current branch transcript. That keeps sibling branches isolated. The relay selects ChatGPT **Instant** for lower response latency and uses ChatGPT's in-page new-chat navigation when possible instead of fully reloading the site. Completed relay responses include an **Open in ChatGPT** link so you can inspect the underlying conversation.

The relay has conservative local traffic guards: one generation at a time, at least 15 seconds between prompt starts, and at most 20 prompts in a rolling hour. Health checks and response polling inspect the local browser DOM; they do not submit ChatGPT prompts. If ChatGPT shows its temporary “requests too quickly” protection message, the relay stops sending prompts for at least ten minutes and Arbor shows a cooldown state. Wait for the cooldown instead of repeatedly reconnecting or resubmitting; ChatGPT may keep the limit active longer than Arbor's local timer.

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
