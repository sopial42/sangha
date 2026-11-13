# Sangha landing page: brief

## What it is

A local web app that runs and follows Claude Code sessions across all your projects. Every project is a zone on an isometric board and every session is a 3D pebble whose face and floor ring show its state. Opening one gives the full conversation, its subagents, branch and context, and you reply from there. It runs on your machine and on your Claude Pro or Max subscription through the Claude Agent SDK.

## Who it is for

Developers who already run several Claude Code sessions at once (one per feature, per repo, or a team lead with subagents) and lose track of which one finished, which one is waiting for an answer, and which one has grown too big to be useful.

Their objections, in order:
1. "Does it cost me API money?" No: it refuses to start if `ANTHROPIC_API_KEY` is set and uses the subscription quota.
2. "Does my code leave my machine?" It listens on 127.0.0.1 only. Sessions talk to Anthropic exactly as Claude Code already does.
3. "Do I have to start everything from it?" No: sessions started in a terminal or IDE show up on their project automatically.
4. "Will sessions trample each other?" Each session started from Sangha works in its own git worktree, on its own branch.
5. "Is it maintained / can I trust it?" The code is on GitHub. (verify) There is no license file yet: add one before calling it open source.

## The one action

Get it from GitHub and run `make setup && make dev`. Secondary: read how it works on the page.

## Proof we can use (all real, checked in the code on 2026-11-13)

- Runs on 127.0.0.1:8787, refuses to start with an API key (server code).
- Each Sangha session has its own worktree on a `sangha/…` branch (`git.ts`).
- Picks up outside sessions from `~/.claude/projects` and the process list (`observer.ts`); Linux and macOS.
- Context shown per session; past 400K tokens it proposes a fresh session that keeps branch, worktree and agent.
- Two-line recap per stop, written by a small model.
- Remote Control: continue a conversation from claude.ai.

Not available, never invent: user counts, GitHub stars (0 today), testimonials, company logos, benchmarks.

## Brand

The app's own identity: "riverbed at night". Background #0d0d0e, surfaces #161617 / #1e1e20, hairlines #2e2e31, text #edebe7, muted #9c9b97, one accent coral #f2785c used only for "needs you", stone #d9d4cb, amber #f2b35c, danger #f06a6e. Inter, one family. The pebble (3D renders in `apps/web/src/assets/pebbles`) is the only character and the logo.

## References

- rerun.build (the user's reference): one character used everywhere, the product map as the hero, dark hero then calmer sections, inline character in the headline.
- Mobbin sections, per section, listed in DESIGN.md.

## Images

Real assets only: the 3D pebble renders, the product screenshots from demo data (`docs/screenshot.png`, captures from `scripts/readme-screenshot`). No generated product UI.
