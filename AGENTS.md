# Sangha

Local web app that runs and follows Claude Code sessions across projects: a board of projects with one pebble per session, and a focus view per session. See README.md for what it does and how to run it.

## Layout

- `apps/server`: Hono + Claude Agent SDK + `node:sqlite`. One long-lived Claude process per session (`session.ts`), the orchestrator (`orchestrator.ts`), outside sessions picked up from `~/.claude/projects` (`observer.ts`), small-model summaries (`recap.ts`), worktrees (`git.ts`), storage and migrations (`db.ts`).
- `packages/shared`: the server/web contract (types, event names). Change it and both sides typecheck against it.
- `apps/web`: React 19, Vite, Zustand, Tailwind v4, shadcn/ui on **Base UI** (not Radix), Hugeicons.
  - `src/app`: top bar, sidebar, board, focus view and its session cards. `src/dialogs`: every dialog, lazy-loaded. `src/chat`: the conversation.
  - `src/lib/sessions.ts`: how a session maps to a pebble, a group and a status line.
- `apps/site`: the marketing landing page (Astro, Tailwind v4, static). It reuses the app's pebble sprites through the `@pebbles` alias; product shots come from demo data only. `pnpm site:dev`, `pnpm site:build`, `pnpm site:check`. Design decisions in `apps/site/DESIGN.md`.

## Commands

pnpm workspaces (`pnpm-workspace.yaml`, `pnpm-lock.yaml`): use pnpm, never npm or npx (`pnpm dlx` instead). Workspace packages depend on each other with `workspace:*`, and pnpm is strict: a package can only import what its own `package.json` declares. `make setup`, `make dev` (http://127.0.0.1:8787), `make test`, `make typecheck`, `make lint`. `make dev` does not restart the server on server changes (it would kill running sessions): restart it yourself.

## Conventions

- **English only**, in the UI, prompts, comments and docs. No em dashes. Plain vocabulary: session, subagent, orchestrator, advisor, closed sessions, set aside, hand-off, start fresh. The old monastery names survive only in `db.ts` migrations and env var fallbacks, to read old installs.
- **Stored data must keep working.** Renaming a table, an event type or a stored value needs a one-time migration in `db.ts` (`renameLegacyTables`, `once(...)`) and a test in `apps/server/test/legacyDb.test.ts`.
- **`cn` comes from `@/lib/utils`**, never from `"cn"`: the configured one knows the custom type scale (`text-meta`, `text-small`, `text-ui`, `text-chat`, `text-title`); the raw one drops the colour class next to them. ESLint enforces it. Re-check after `pnpm dlx shadcn@latest add`.
- **Tokens, not raw values**: spacing 4/8/12/16/24, radius `rounded-sm` 6 / `rounded-lg` 8 / `rounded-xl` 12, controls 32px. Colour means attention: `coral` only for "needs you", `danger` for errors, `amber` for warnings, everything else neutral.
- **Zustand**: select fields one by one, `useApp((s) => s.field)`. Never `useApp()` without a selector, never a selector that builds a new object (it re-renders forever in v5).
- **Motion** lives in `src/index.css` (`motion-popup`, `motion-dialog`, `motion-press`, `motion-collapse`, `motion-land`, `motion-swap`, `motion-ping`, `motion-breathe`, `motion-enter`, `motion-drawer`): strong ease-out, exits faster than entrances, transform and opacity only. Keyboard-driven changes (Esc, ←/→, ⌘B, ⌘K) never animate. On the board, `src/lib/seen.ts` makes animations play only for real changes, never on re-mount.
- **Pebbles** are 3D renders: `python3 apps/web/scripts/pebbles/build.py` regenerates `src/assets/pebbles` (needs Chrome and Pillow). Do not edit the sprites or `index.ts` there by hand.
- **README screenshot**: `scripts/readme-screenshot/build.sh` rebuilds `docs/screenshot.png` from demo data (needs `make dev` running). Never use real sessions in docs.
