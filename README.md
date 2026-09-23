# ☸ Sangha

Un monastère pour piloter des agents Claude Code sur tous tes projets.

- **Bouddha** est l'agent à qui tu peux tout demander. Il connaît tes projets et les agents que chacun
  propose, et il lance les prêtres pour toi (« sur robia, lance le kiat team lead pour le ticket X ; sur
  robin, ouvre une conversation sur l'auth »).
- **Un pavillon de prière par projet**, à la couleur du projet, avec son nom sur la plaque. Un clic ouvre une
  session sur ce projet. Sa porte s'éclaire quand un de ses prêtres travaille. Le petit **+** à côté ajoute un
  projet ; **éteindre le grand encens** devant un pavillon retire le projet (confirmation demandée).
- **Toute session Claude Code lancée sur ta machine apparaît toute seule**, dans le pavillon de son repo git
  (un worktree compte pour son repo principal) ou de son dossier. Si le projet n'existe pas encore, il est
  ajouté. Une session ouverte mais inactive reste visible tant que son process `claude` tourne.
- **Un clic sur un prêtre ouvre sa session en plein écran** : sa conversation, un point d'avancement écrit par
  Haiku (la tâche, où il en est, ce qui reste), et à droite ses sous-agents, dont on déplie le fil.
- **Un prêtre = une session** Claude Code, assis devant le pavillon de son projet, dans son propre git
  worktree (branche `sangha/…`). Sa robe dit quel agent il est (un `kiat-team-lead` porte toujours la même). Il médite **les yeux fermés** pendant qu'il travaille, et garde **les yeux
  ouverts** quand il ne fait rien. Un **halo** l'entoure tant que tu n'as pas lu ses derniers mots : la cloche
  sonne, une notification apparaît, et un clic ouvre sa conversation.
- Quand il s'arrête, un **récap** de deux lignes apparaît au-dessus de lui : ✓ ce qui a été fait, → ce qui
  reste ou ce qu'il attend de toi. Il est écrit par un petit appel Haiku séparé (`SANGHA_RECAP_MODEL`), sur le quota.
- **Éteindre l'encens** à ses pieds congédie le prêtre : il quitte la cour et sa session est fermée.
- Sous chaque prêtre : **la branche git** sur laquelle il est en ce moment (`⎇ feat/x`) ; le repo, c'est son pavillon.
- **Les sessions lancées hors de Sangha** (ton terminal, ton IDE) apparaissent comme des prêtres marqués ⌨,
  nommés par leur agent (`kiat-team-lead`, sinon « Claude ») et titrés par le résumé de Claude Code, avec
  leurs sous-agents. Tu suis leur conversation en direct ; pour leur répondre, écris-leur là où elles
  tournent. Éteindre leur encens les renvoie de la cour (le terminal continue) jusqu'à leur prochaine activité.
- **La taille du contexte** de chaque session s'affiche sous le moine : normale jusqu'à 200K, orange au-delà,
  rouge dès 400K ; plus elle grossit, plus le moine s'affaisse. Dès 400K, quand la session s'arrête, Sangha lui
  demande s'il vaut mieux **continuer dans une session neuve**. Si elle répond OUI, elle écrit sa passation et
  Sangha ouvre la session neuve (même projet, dossier, branche et agent) ; si NON ou PLUS TARD, Sangha
  redemande tous les 100K. Le bouton **Repartir à neuf** pose la question tout de suite. Les moines en silence
  ne sont pas sollicités.
- **Les novices** (sous-agents) méditent à ses pieds pendant qu'ils travaillent, avec l'icône de leur outil
  en cours. Un clic montre ce qu'ils font. Un team lead peut en lancer autant qu'il veut.

Chaque interaction lance de vrais process Claude Code via le [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/overview),
qui consomment **le quota de ton abonnement Claude (Pro/Max), jamais l'API payante**. Le serveur refuse de
démarrer si `ANTHROPIC_API_KEY` est définie.

## Démarrage

```sh
make setup          # .env, dépendances npm, plugins épinglés
```

Ajoute tes projets avec **+ Projet** :
- **un dossier de ta machine**, laissé où il est : Sangha propose les repos où Claude Code a tourné ces 14
  derniers jours. Les prêtres travaillent dans des worktrees à côté, sans toucher ta copie ;
- **ou une URL git**, clonée dans `workspaces/`. Tout dossier copié dans `workspaces/` est aussi un projet.

**En local** (utilise ta session Claude Code déjà connectée sur la machine) :

```sh
make dev            # http://localhost:5173
```

En `make dev`, le serveur **ne redémarre pas** quand son code change : les sessions lancées par Sangha tournent
à l'intérieur, un redémarrage les couperait toutes. Pour prendre en compte une modification du serveur,
relance `make dev` (les sessions en cours apparaissent « interrompues », avec un bouton Reprendre).
`npm run dev:watch -w @sangha/server` garde le rechargement automatique, quand aucune session Sangha ne tourne.

**Déployé sur ta machine**, en arrière-plan, indépendant du terminal (build de production, interface et API
sur le même port, base dans `data/`) :

```sh
make serve          # http://127.0.0.1:8787
make status / make stop     # logs : data/sangha.log
```

Après une mise à jour du code : `make stop && make serve`.

**En Docker** (pour un serveur distant plus tard ; la détection des sessions de ta machine n'y fonctionne pas) :

```sh
make token          # claude setup-token → colle CLAUDE_CODE_OAUTH_TOKEN dans .env
make up             # http://127.0.0.1:8787
make logs / make down
```

## Prêtres

Pour chaque projet, un prêtre peut être :

| Prêtre | Ce qu'il fait | Modèle |
|---|---|---|
| **Un agent du projet** (`.claude/agents/*.md`, ex. `kiat-team-lead`) | Tourne comme agent principal, exactement comme `claude --agent kiat-team-lead`, et lance ses propres sous-agents | celui de sa définition |
| Team lead | Rôle Sangha : délègue à ses novices (architecte, back, front, reviewer) | `SANGHA_LEAD_MODEL` (opus) |
| Conversation | Discute du code, explore, modifie si tu le demandes | `SANGHA_WORKER_MODEL` (sonnet) |
| Review | Relit une branche ou un diff, lance les tests, rend une review | `SANGHA_WORKER_MODEL` (sonnet) |

Les agents du projet sont lus dans le worktree : ils doivent être **commités** dans le repo.
Bouddha tourne en `SANGHA_BUDDHA_MODEL` (sonnet). Les plugins chargés pour les prêtres (versions épinglées
dans `scripts/fetch-plugins.sh`) sont [superpowers](https://github.com/obra/superpowers),
[ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) et
[frontend-design](https://github.com/anthropics/claude-plugins-official).

**Congédier** un prêtre (encens, ou bouton dans sa vue, toujours après confirmation) supprime son worktree. Sa branche est gardée si
elle contient des commits. Une confirmation est demandée s'il travaille encore ou s'il reste des fichiers
modifiés non commités.
Si le serveur redémarre pendant qu'un prêtre travaille, il apparaît **interrompu**, avec un bouton **Reprendre**.

La jauge en haut à droite affiche le quota réel de l'abonnement : le bâton d'encens pour la fenêtre de 5 h,
les perles du mala pour la semaine. Le montant en `$` est l'équivalent API de la session ouverte : il n'est pas facturé.

## Architecture

```
apps/server   Hono + Agent SDK
  session.ts    un process Claude longue durée par prêtre (streaming input), fermé après 20 min
                d'inactivité puis repris (resume) ; statuts working / waiting / idle / error / interrupted
  buddha.ts     Bouddha : session dispatcher avec un serveur MCP in-process (list_projects,
                list_sessions, start_session, send_to_session, read_session)
  roles.ts      rôles Sangha + agents de projet (option SDK `agent`)
  projects.ts   projets = dossiers de workspaces/ + dossiers locaux enregistrés ; agents lus dans
                .claude/agents ; suggestions tirées de ~/.claude/projects
  observer.ts   sessions Claude Code externes : lit ~/.claude/projects/<dir>/<session>.jsonl (+ subagents/),
                rattachées à un projet par leur git common dir (worktrees compris) ; toutes les 4 s
  transcript.ts transcript Claude Code → MonasteryEvent (conversation externe, fils des sous-agents)
  recap.ts      appels Haiku sans outils : récap à l'arrêt, point d'avancement d'une session
  git.ts        worktrees par session
  normalize.ts  messages SDK → MonasteryEvent (testé sur un flux réel enregistré)
  db.ts         SQLite (node:sqlite) : sessions, journal d'événements, couleurs
apps/web      React + SVG + Motion
packages/shared  le contrat d'événements
```

- `GET /api/events` (SSE) : état de tout le monastère (snapshot, puis changements).
- `GET /api/sessions/:id/events` (SSE) : conversation d'une session (historique, puis direct).

Les worktrees vivent dans `workspaces/.worktrees/<projet>/`. Docker monte `workspaces/` **au même chemin
absolu** que sur la machine, pour que ces worktrees restent valides en `make dev` comme en `make up`.

## Sécurité

Les prêtres tournent en `bypassPermissions`, confinés dans le container (user non-root) et dans `workspaces/`.
Le port est lié à `127.0.0.1`. **Ne pas exposer ce service sans authentification devant** : il exécute du code.
Usage personnel uniquement : les conditions d'Anthropic interdisent d'offrir la connexion par abonnement à des tiers.

## Limites connues

- On ne peut pas écrire dans une session externe : elle tourne dans ton terminal, deux process sur la même
  session entreraient en conflit. Elles restent visibles tant que leur process tourne, ou que leur
  transcript a bougé dans les `SANGHA_EXTERNAL_WINDOW_MIN` dernières minutes (90 par défaut).
- Un projet retiré n'est pas ré-ajouté automatiquement ; l'ajouter à la main annule ce choix.
- La détection lit `~/.claude/projects` et la liste des process de la machine : elle marche en `make dev`,
  pas depuis le container Docker.
- Les projets locaux (hors `workspaces/`) ne sont visibles que par `make dev` ; Docker ne monte que `workspaces/`.
- On ne chatte pas directement avec un novice (le SDK ne le permet pas) : on passe par son prêtre.
- Cloner un repo privé depuis Docker demande des identifiants git dans le container (pas encore câblé) ;
  en local, tes identifiants habituels servent.
- Les MCP d'un projet (ex. Playwright pour kiat) doivent être installables dans le container pour tourner en Docker.
