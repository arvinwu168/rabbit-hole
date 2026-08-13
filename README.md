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

Restart the development server after changing the key. The development controls above the composer let you switch between the mock and Groq APIs and choose a maximum output of 128, 256, 512, or 1,024 tokens. Groq requests default to 256 output tokens, and the server enforces a hard 1,024-token ceiling.

The Groq key is never sent to the browser. The `/api/chat` route calls Groq with native `fetch` and converts its event stream into the plain-text stream consumed by the UI.

## Production check

```bash
npm run lint
npm run build
```

The `/api/chat` route supports both a local mock and Groq's OpenAI-compatible API without changing the tree interaction model.
