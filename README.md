# Arbor

Arbor is a desktop-first prototype for tree-structured AI conversations. Each chat is a recursive tree: the main pane renders the path to the active node, while the sidebar lets you move between sibling ideas without flattening them into one timeline.

## Prototype features

- Recursive, filesystem-style chat navigation
- Root-to-active conversation paths
- Raw branches from any assistant turn
- Quote-anchored branches created from selected response text
- Simulated word-by-word streaming through a Next.js route handler
- Local persistence with a seeded demonstration tree
- One-click reset to the demo state

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

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
