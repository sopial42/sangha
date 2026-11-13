# Sangha landing page: copy (EN)

## Nav
Sangha logo · How it works · Features · Install · FAQ · [Get it on GitHub]

## 1. Hero
H1: Run ten Claude Code sessions and know which one needs you.
Subline: Sangha puts every session on your machine on one board. Working sessions breathe, finished ones turn coral, and the ones that grew too big tell you to start fresh. It runs locally, on your Claude subscription.
Primary CTA: Get it on GitHub
Secondary: See how it works
Visual: the live board (pebbles change state on their own, a session starts needing you, one gets a subagent).

Facts under the board (one line each):
- Runs on 127.0.0.1, nothing to host
- Uses your Pro or Max quota, never the paid API
- Picks up the sessions you start in a terminal
- Gives each session its own git worktree

## 2. The board
H2: Read the whole board in a second.
Body: Every project is a zone and every session is a pebble. You never read a status: its face and the ring on the floor tell you.
- Working: eyes closed, a slow glow on the floor. Its subagents sit beside it.
- Needs you: it turns coral and rings once, with a two-line recap of what it did and what it waits for.
- Error: crossed eyes and a red ring, with the message one click away.
- Ready to start fresh: it sits on a cairn that grows with its context. Past 400K tokens, Sangha offers a fresh session that keeps the branch, the worktree and the agent.

## 3. The session
H2: Open a session and you are in the conversation.
Body: The full thread, its tool calls and its subagents, with a recap pinned on top and everything about the session on the side.
- Done and next, in two lines: a small model writes what it did and what it waits for, every time it stops.
- Answer in one key: approve with Enter, hold off with Escape, or reply in your own words.
- Context, branch and subagents on the side: the size of the context, the pull request, the model, its MCP servers and the subagents it started.
- Hand it off when it gets heavy: one click starts a fresh session with a hand-off note, on the same branch.

## 4. Features
H2: Made for running many sessions at once.
- Your terminal sessions too: anything you run with `claude` in a terminal or an IDE shows up on its project, subagents included.
- One worktree per session: sessions started from Sangha work on their own `sangha/…` branch, so three of them can change the same repo.
- An orchestrator you can ask: press ⌘K and ask it to start, follow or hand off sessions across your projects.
- Your quota in sight: the five-hour and weekly windows, a reserve that pauses sessions before you run dry, and what each session would cost at API prices.
- Continue from your phone: hand a conversation to claude.ai with Remote Control and pick it up anywhere.
- An advisor that learns from you: comment on a message, and it turns your feedback into concrete improvements for your agents and projects.

## 5. Install
H2: Running in two commands.
Body: You need Node 24, pnpm, git, and Claude Code signed in on this machine.
Code: git clone https://github.com/sopial42/sangha && cd sangha
make setup
make dev
Then: Open http://127.0.0.1:8787 and add a project: a folder on your machine or a git URL.

## 6. FAQ
- Does it cost anything on top of my subscription? No. Sangha drives Claude Code through the Agent SDK on your Pro or Max quota, and refuses to start if an API key is set, so nothing is billed to the API.
- Does my code leave my machine? Sangha itself listens on 127.0.0.1 only and stores its data in a local SQLite file. Your sessions talk to Anthropic exactly as Claude Code already does.
- Do I have to start my sessions from Sangha? No. Sessions you start in a terminal or an IDE appear on their project on their own. Sessions started from Sangha add a worktree, a recap and replies from the board.
- Which systems does it run on? Linux and macOS. A Docker image exists for a remote host, without the detection of local sessions.
- Can several people use it? It is built for one person on their own machine. Anthropic's terms do not allow sharing subscription access.

## 7. Close
H2: Put every session on one board.
Body: Clone it, run two commands, and see which session needs you.
CTA: Get it on GitHub

## Footer
Sangha · GitHub · README · (verify) License
