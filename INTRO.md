# Rabbit Hole

## Summary

People use ChatGPT to explore ideas, but a conventional chat interface forces that exploration into a single, turn-by-turn timeline. Human curiosity is rarely that linear: one answer can spark several worthwhile questions at once. In a normal chat, pursuing one means postponing the others, keeping them in your head, or opening disconnected conversations and rebuilding their context.

Rabbit Hole is a tree-based AI chat built for that more natural way of thinking. It works like a familiar chat when the conversation is linear, but any response can support multiple follow-up branches. A branch can also be anchored to highlighted text, preserving the exact passage that triggered a question or “aha” moment. The sidebar presents the full tree like a folder hierarchy, while the main pane shows one coherent root-to-leaf conversation at a time and offers quick movement between alternatives. The result is an interface that makes it easier to follow an idea deeply without losing the other directions worth exploring.

## The problem

Most AI chat products model a conversation as a linked list: prompt, response, prompt, response. That structure works for completing a single task, but it creates friction during open-ended research, brainstorming, and learning. When a response suggests several possible directions, the user must either mix them into one increasingly tangled thread or remember to return to them later.

Rabbit Hole models the conversation as it actually develops: a tree. Each follow-up retains the context of its ancestors, while sibling branches remain separate and available. This lets users explore competing interpretations, ask side questions, or go deeper on one detail without damaging the clarity of the original conversation.

## Key decisions

- **Use two familiar views instead of a graph.** A node-link diagram makes the tree literal, but it also makes navigation and reading harder. Rabbit Hole uses a recursive, filesystem-style sidebar for orientation and a conventional conversation view for reading. The sidebar exposes the whole structure; the main pane renders only the selected root-to-leaf path. Branch controls in both panes make moving sideways easy without sacrificing readability.

- **Make text anchoring a core interaction.** New lines of thought often begin with a specific phrase in an answer. Users can highlight that phrase and choose **Branch from selection**, tying their follow-up to the source passage. The anchor remains visible in both the tree and conversation, so the origin of the question is never lost.

- **Keep the prototype lightweight.** There is no user account system, onboarding flow, or database. The private demo uses a shared-password gate, and each guest workspace is stored only for the current browser tab. That keeps the project focused on validating the conversation model rather than building production account infrastructure.

- **Design for fast, repeatable iteration.** Experiment mode includes slash commands for generating sample trees and deterministic fixtures for anchored branches, long answers, Markdown rendering, slow streams, and provider errors. These tools make interaction states reproducible without spending model tokens and made it much faster to test and refine the UI.

- **Keep model access flexible.** The same tree interface can use several models through Vercel AI Gateway, direct Groq and v0 integrations, a local mock provider, or an experimental ChatGPT browser relay. This makes it easier to compare providers, manage cost, and keep testing when one path is unavailable. The relay explores using a person's existing signed-in ChatGPT session, although ChatGPT's account-protection and bot-detection behavior makes it intentionally experimental rather than a production integration.

## How I used AI

The entire repository was written by AI; I did not write a line of code. That was a deliberate choice for a frontend prototype whose goal was to reach and evaluate a new interaction model as quickly as possible. AI handled implementation, refactoring, and test creation across the project.

I drove the work as the product designer and evaluator. I defined the problem, chose the tree and anchoring interactions, made the major UI and scope decisions, tested the product hands-on, identified bugs and awkward behavior, and directed each iteration. In other words, AI produced the code, while I supplied the product judgment: what should exist, how it should feel, what was not working, and when an iteration was good enough to keep.
