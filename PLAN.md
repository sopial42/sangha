# Sangha — plan v1 (démo locale)

> **Statut au 2026-09-23 : démo locale livrée** (jalons 0 à 4). Écarts avec le plan initial, décidés pendant le spike :
> - Une session est un process Claude **longue durée en streaming input**, pas un `query()` par message, car les
>   sous-agents tournent en arrière-plan et font leur rapport après la fin du tour.
> - Le cycle de vie des moines vient des messages `task_started` / `task_progress` / `task_notification`
>   (plus fiables que les hooks), et le quota de `rate_limit_event.unifiedWindows` (fenêtres 5 h et 7 j).
> - Un seul container : le serveur sert aussi le front buildé. SQLite via `node:sqlite`, sans dépendance native.
> - Prochaines étapes : auth web, validation des actions depuis l'UI (`canUseTool`), déploiement distant.
>
> **v2 (même jour) : le monastère multi-projets.** Un seul Bouddha, qui est maintenant un agent dispatcher avec
> ses propres outils MCP, et un seul pavillon. Autant de prêtres que de sessions, la robe à la couleur du projet,
> chacun dans son git worktree, avec ses novices à ses pieds. Un prêtre peut être un agent du repo
> (`kiat-team-lead` via l'option SDK `agent`) ou un rôle Sangha (lead, chat, review). Quand un prêtre ouvre les
> yeux (il a fini), la cloche sonne, une notification navigateur s'affiche et l'onglet affiche un badge.
> Pas d'auth ni d'intégration tickets pour l'instant (décision utilisateur).

Interface web pour piloter et visualiser des agents Claude Code via le **Claude Agent SDK**, facturée
**sur le quota de l'abonnement Max 20x** (pas d'API payante). Direction artistique : un monastère bouddhiste.
**Bouddha** est l'agent orchestrateur, chaque **moine** est un sous-agent.

## Décisions

| Sujet | Choix |
|---|---|
| Bouddha | Agent principal (orchestrateur). L'utilisateur ne parle qu'à lui |
| Backend | TypeScript / Node 22, Hono, `@anthropic-ai/claude-agent-sdk` |
| Front | Vite + React + TS, scène SVG + Framer Motion, Zustand |
| Transport | `POST /api/sessions/:id/messages` + `GET /api/sessions/:id/events` (SSE) |
| Persistance | JSONL natifs Claude Code (resume) + SQLite (index sessions + events) |
| Workspace | `./workspaces/*` monté, projet choisi par session |
| Auth Claude | `CLAUDE_CODE_OAUTH_TOKEN` (`claude setup-token`), **jamais** `ANTHROPIC_API_KEY` |
| Moines | Skills Superpowers + 4 agents custom |
| MVP | Chat Bouddha en stream, moines visibles en direct, jauge quota |
| Hors MVP | Validation des actions depuis l'UI (`canUseTool`), auth web, infra distante |

## Architecture

```
┌──────────── docker compose ────────────────────────────────────────────┐
│  web (nginx, build Vite) ──/api──►  server (Node, user non-root)       │
│                                      ├─ SessionRunner ─ query() SDK ──► claude CLI ──► quota Max
│                                      ├─ EventNormalizer (SDK msg → MonasteryEvent)
│                                      ├─ SSE hub      ├─ SQLite /data/sangha.db
│  volumes: ./workspaces → /workspaces   claude-home → /home/node/.claude   ./data → /data
└────────────────────────────────────────────────────────────────────────┘
```

## Repo

```
sangha/
├─ Makefile  docker-compose.yml  .env.example  PLAN.md
├─ packages/shared/        # types MonasteryEvent, Monk, Session (partagés front/back)
├─ apps/server/
│  ├─ src/index.ts         # Hono: routes + SSE
│  ├─ src/runner.ts        # query({prompt, options:{resume, cwd, agents, plugins, model}})
│  ├─ src/normalize.ts     # le cœur, testé contre des fixtures
│  ├─ src/monks.ts         # AgentDefinition + métadonnées visuelles (nom, couleur, robe)
│  ├─ src/db.ts            # better-sqlite3
│  └─ test/fixtures/*.jsonl  # flux SDK bruts enregistrés au spike
├─ apps/web/
│  ├─ src/scene/           # Monastery.tsx, Buddha.tsx, Monk.tsx (SVG)
│  ├─ src/chat/            # panneau Bouddha
│  ├─ src/quota/           # bâton d'encens = fenêtre 5h
│  └─ src/store.ts         # Zustand, alimenté par SSE ou par replay de fixture
└─ docker/server.Dockerfile  docker/web.Dockerfile
```

## Modèle d'événements (le contrat front ↔ back)

Le SDK émet `system(init)`, `assistant`, `user` (tool_result) et `result`. Chaque message porte un
`parent_tool_use_id`, ce qui permet de reconstruire l'arbre. Le normalizer produit :

```ts
type MonasteryEvent =
  | { t: 'session.started'; sessionId; model; agents: string[] }
  | { t: 'buddha.text'; delta }                                    // parent_tool_use_id == null
  | { t: 'monk.summoned'; monkId /* tool_use_id */; agentType; task } // tool_use name ∈ {Task, Agent}
  | { t: 'monk.tool'; monkId; tool; summary }                      // tool_use avec parent == monkId
  | { t: 'monk.text'; monkId; delta }
  | { t: 'monk.done'; monkId; ok: boolean; result }                // tool_result du Task/Agent
  | { t: 'turn.done'; usage; costUsdEquiv; durationMs }
  | { t: 'quota'; status; resetsAt?; utilization? }                // rate_limit_event, à confirmer au spike
  | { t: 'error'; message }
```

Il faut gérer les deux noms de l'outil de délégation (`Task`, et `Agent` dans les versions récentes du CLI).
Les hooks `SubagentStart` et `SubagentStop` servent de filet de sécurité si un sous-agent démarre sans `tool_use` visible.

## Moines

- **Bouddha** (principal) : Opus, prompt d'orchestrateur, délègue et ne code pas lui-même.
- **Architecte** : Sonnet, lecture seule (Read, Grep, Glob), produit des plans.
- **Moine back** : Sonnet, Read, Edit, Write, Bash.
- **Moine front/UI** : Sonnet, avec les skills `frontend-design` et `ui-ux-pro-max`.
- **Reviewer** : Sonnet, lecture seule plus Bash pour les tests.
- **Superpowers** : chargé en plugin local (`plugins: [{type:'local', path:'/opt/plugins/superpowers'}]`),
  version épinglée dans l'image. Ses skills (brainstorming, writing-plans, subagent-driven-development, TDD,
  systematic-debugging) sont disponibles pour Bouddha. Les sous-agents qu'ils lancent apparaissent comme des
  « moines de passage » générés dynamiquement.

## Rendu

La scène est la cour du monastère : Bouddha sur une estrade au centre, les moines sur des coussins autour.
- `méditation` (idle) : respiration lente
- `convoqué` : se lève et marche vers le pavillon
- `travaille` : bulle avec l'outil en cours (📜 Read, 🖌 Edit, 🔔 Bash)
- `fini` : s'incline, puis regagne son coussin
- `erreur` : lanterne rouge

Au clic sur un moine, un tiroir s'ouvre avec son fil d'actions. La jauge quota est un bâton d'encens qui se
consume sur la fenêtre de 5h, avec des perles de mala pour le plafond hebdomadaire.
**Mode replay** : le front peut rejouer une fixture JSONL. On développe toute l'UI sans consommer de quota.

## Docker / Make

- `server.Dockerfile` : `node:22-slim` + git, ripgrep, clone de superpowers (tag épinglé), `USER node`.
  L'utilisateur non-root est obligatoire, car `bypassPermissions` refuse de tourner en root.
- **Garde-fou au boot** : si `ANTHROPIC_API_KEY` est définie, le serveur refuse de démarrer (sinon la facturation passe en API).
- En MVP : `permissionMode: 'bypassPermissions'`, confiné au container et à `/workspaces`.
- Makefile : `setup` (copie `.env`, rappelle `claude setup-token`), `dev` (sans Docker, hot reload),
  `up`, `down`, `logs`, `build`, `test`, `record` (enregistre une fixture), `deploy` (placeholder).
- Compose : ports liés à `127.0.0.1` uniquement tant qu'il n'y a pas d'auth web.

## Jalons

0. **Spike (½ j), à faire avant tout le reste**
   - Faire tourner le SDK dans le container avec le token OAuth et vérifier que la consommation part sur le quota.
   - Faire un run superpowers avec 2 sous-agents et enregistrer le flux brut dans `test/fixtures/`.
   - Vérifier la présence et la forme de `rate_limit_event`. Si l'événement n'existe pas, la jauge sera
     calculée localement (tokens + horodatage de la fenêtre).
   - Vérifier le chargement de superpowers et de `ui-ux-pro-max` en plugin local.
1. **Back** : normalizer (TDD sur les fixtures), runner avec resume et interruption, SSE, SQLite.
2. **Front** : chat, scène et tiroir d'un moine, le tout en mode replay.
3. **Branchement** en live, plus la jauge quota.
4. **Compose + Make + README** : `make up` doit donner une démo locale fonctionnelle.

## Risques

| Risque | Parade |
|---|---|
| Conditions d'utilisation : login abonnement dans un outil tiers | Usage perso uniquement, mono-utilisateur, jamais exposé à d'autres personnes |
| `ANTHROPIC_API_KEY` présente, donc facturation API | Refus au boot + `.env.example` explicite |
| Quota vidé par des sous-agents Opus en parallèle | Moines en Sonnet, jauge visible, bouton d'interruption |
| Format du stream SDK qui change | Normalizer isolé + fixtures + version du SDK épinglée |
| `bypassPermissions` avec une UI qui exécute du code | Container non-root, ports en localhost, auth obligatoire avant le serveur distant |
| Token OAuth expiré (~1 an) | Erreur claire dans l'UI + `make token` |

## Outillage pour construire le projet

- `/plugin marketplace add obra/superpowers-marketplace` puis `/plugin install superpowers@superpowers-marketplace`
- `/plugin marketplace add anthropics/claude-code` puis installer `agent-sdk-dev` et `frontend-design`
- Workflow : brainstorming → writing-plans → subagent-driven-development (un sous-agent par jalon),
  vérificateur `agent-sdk-dev` sur le back, `ui-ux-pro-max` + `frontend-design` sur la scène.
