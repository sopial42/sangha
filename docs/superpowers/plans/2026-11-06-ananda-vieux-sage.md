# Ananda, le vieux sage — plan d'implémentation

> **Pour les agents exécutants :** SOUS-COMPÉTENCE REQUISE : utiliser `superpowers:subagent-driven-development` (recommandé) ou `superpowers:executing-plans` pour exécuter ce plan tâche par tâche. Les étapes utilisent la syntaxe case à cocher (`- [ ]`).

**Goal :** Donner à Sangha un moine conseiller, Ananda, qui relit à bas coût (appels uniques, sans outils) les retours manuels, les signaux de fonctionnement de Sangha et les sessions des projets suivis, pour en tirer des suggestions d'amélioration que l'utilisateur vote en un clic — sans jamais rien modifier lui-même.

**Architecture :** Backend — quatre nouvelles tables SQLite (`feedback`, `elder_topics`, `elder_reports`, `elder_chat`), un réglage `elder` dans `settings`, trois modules de logique pure (`elderSchedule.due()`, `elderContext.buildContext()`, `elderParse.parseElderResponse()`) orchestrés par une classe `Elder` (tick minute, verrou mémoire, appel `query()` du SDK façon `recap.ts`), diffusés par le flux global existant via un nouvel événement `GlobalEvent` `elder`. Frontend — un client API et un slice de store Zustand, un bouton de commentaire par message dans `Chat.tsx` et un vote 👍/👎 de conversation dans l'en-tête, une scène `Elder.tsx` (Ananda sous l'arbre de la Bodhi, barbe en spirale animée par une petite chaîne de ressorts) et un panneau (sujets, rapports, discussion, réglages).

**Tech Stack :** `apps/server` (Hono, `@anthropic-ai/claude-agent-sdk`, `node:sqlite`, vitest) ; `apps/web` (Vite, React 19, Zustand, `motion`, SVG) — `apps/web` n'a pas vitest : sa logique pure est vérifiée par `tsc --noEmit` + `vite build`, pas par des tests unitaires.

**Spec :** `docs/superpowers/specs/2026-11-06-ananda-vieux-sage-design.md`

## Global Constraints

- Aucune suppression, aucune commande destructive : ce plan ne touche qu'à des fichiers applicatifs (code), jamais à l'infra.
- Aucune nouvelle dépendance npm (ni vitest pour `apps/web`, ni librairie de physique : la chaîne de ressorts de la barbe est ~60 lignes de TypeScript pur).
- Textes UI en français avec accents.
- Messages de commit en français, phrase descriptive orientée utilisateur, terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `elder.ts` reste un orchestrateur : la logique pure et testable sans base de données vit dans `elderSchedule.ts`, `elderContext.ts`, `elderParse.ts`.
- Au plus 5 sujets nouveaux par passage ; jamais de rappel d'un sujet rejeté ; `newItems = 0` → aucun appel au modèle.
- Deux implémenteurs en parallèle après la Tâche 1 (contrat partagé) : `[BACK]` (Tâches 2 à 8) et `[FRONT]` (Tâches 9 à 12), chacun exécuté séquentiellement par son propre implémenteur.

## Review Focus

- Un retour posé sur un message précis doit viser exactement ce message (par `eventSeq`), pas la conversation entière : testé par `excerptAround` (Tâche 2) et par le `seq` porté sur `ChatItem` (Tâche 10).
- Le quota connu est *inconnu* (jamais vu) autant que *mauvais* (trop utilisé) : les deux doivent bloquer le passage hebdomadaire de la même façon, testé dans `due()` (Tâche 4).
- Un sujet déjà rejeté ne doit jamais revenir, même si le modèle le reprend avec un titre légèrement différent et sans id : `parseElderResponse` ne peut filtrer que par id connu, donc c'est le bloc Mémoire de `buildContext` qui porte la liste des titres rejetés au modèle, testé dans `buildContext()` (Tâche 5).
- Une réponse du modèle mal formée (JSON partiel, champ manquant) ne doit marquer aucun retour comme traité ni avancer `lastRunAt`, pour que le passage suivant réessaie : testé dans `Elder.runPass` (Tâche 7).
- Un glisser de la pointe de la barbe inférieur à 4 px doit quand même ouvrir le panneau (c'est un clic), un glisser supérieur ne doit jamais l'ouvrir : vérifié par le typecheck + une assertion explicite dans `isDragGesture` (Tâche 11), faute de vitest côté web.

## File Structure

**Partagé**
- `packages/shared/src/index.ts` — types `Feedback`, `ElderTopic`, `ElderReport`, `ElderChatTurn`, `ElderSettings`, `ElderSettingsPatch`, `ElderState` ; nouveaux membres `tool.error` sur `MonasteryEvent` et `elder` sur `GlobalEvent`.

**Backend**
- `apps/server/src/db.ts` — 4 tables SQL, méthodes `Store` pour `feedback`, `elder_topics`, `elder_reports`, `elder_chat`, `excerptAround`, `elderSanghaStats`.
- `apps/server/src/normalize.ts` — détecte l'échec d'un outil MCP sur le fil principal et émet `tool.error`.
- `apps/server/src/elderSchedule.ts` *(nouveau)* — `due()` pur : décide quand Ananda passe (hebdomadaire/quotidien/fin de conversation/semaine sautée).
- `apps/server/src/elderContext.ts` *(nouveau)* — `buildContext()` pur : assemble et tronque le contexte envoyé au modèle.
- `apps/server/src/elderParse.ts` *(nouveau)* — `parseElderResponse()` pur : valide la réponse du modèle.
- `apps/server/src/elder.ts` *(nouveau)* — classe `Elder` : réglages, tick minute, verrou, appel du modèle, votes, discussion, diffusion.
- `apps/server/src/index.ts` — routes `/api/elder*` et `/api/feedback*`, câblage de `Elder` dans le flux SSE `/api/events`.

**Frontend**
- `apps/web/src/api.ts` — client des nouvelles routes, gestion de l'événement global `elder`.
- `apps/web/src/store.ts` — `ChatItem.seq`, `Dialog` `{ kind: 'elder' }`, `elderBadge`.
- `apps/web/src/chat/Chat.tsx` — bouton « commenter pour Ananda » par message, marque sur un message déjà commenté.
- `apps/web/src/SessionView.tsx` — 👍/👎 + commentaire facultatif pour la conversation entière, dans l'en-tête.
- `apps/web/src/scene/elderBeard.ts` *(nouveau)* — physique pure de la barbe (chaîne de points, verlet, contrainte de distance).
- `apps/web/src/scene/Elder.tsx` *(nouveau)* — Ananda sous l'arbre de la Bodhi, pastille, lueur, barbe interactive.
- `apps/web/src/scene/Monastery.tsx` — place `Elder` dans un espace libre de la scène.
- `apps/web/src/Dialogs.tsx` — `ElderDialog` : sujets, rapports, discussion, médite maintenant, réglages.

---

### Tâche 1 [SHARED] : types partagés et contrat d'API exact

**Files:**
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: rien (première tâche).
- Produces: tous les types ci-dessous, consommés par toutes les tâches suivantes. Contrat d'API exact ci-dessous, consommé par les tâches `[FRONT]` sans attendre l'implémentation `[BACK]`.

#### Contrat d'API exact

| Méthode | Chemin | Corps | Réponse |
|---|---|---|---|
| GET | `/api/elder` | — | `ElderState` |
| PUT | `/api/elder/settings` | `ElderSettingsPatch` | `ElderSettings` (fusionné et validé) |
| POST | `/api/elder/run` | — | `202`, corps vide (déclenche « médite maintenant ») |
| POST | `/api/elder/ask` | `{ text: string }` | `{ reply: string }` |
| POST | `/api/elder/topics/:id/vote` | `{ vote: 'up' \| 'down' }` | `ElderTopic` |
| POST | `/api/elder/topics/:id/done` | — | `ElderTopic` |
| POST | `/api/feedback` | `{ sessionId: string; eventSeq?: number; rating?: 'up' \| 'down'; comment?: string }` | `Feedback`, `201` |
| GET | `/api/sessions/:id/feedback` | — | `Feedback[]` |

Toute erreur de validation renvoie `400 { error: string }` (via `UserError`, comme le reste de l'API).

- [ ] **Étape 1 : ajouter `tool.error` à `MonasteryEvent`**

Dans `packages/shared/src/index.ts`, remplacer la ligne 59 :

```ts
  | { t: 'error'; message: string }
```

par :

```ts
  | { t: 'error'; message: string }
  /** Un outil MCP a échoué sur le fil principal (jamais celui d'un novice) : ce qu'Ananda agrège par serveur. */
  | { t: 'tool.error'; tool: string; server: string; message: string }
```

- [ ] **Étape 2 : ajouter `elder` à `GlobalEvent`**

Remplacer la ligne 327 (dernier membre de `GlobalEvent`) :

```ts
  | { kind: 'host'; host: HostReport }
```

par :

```ts
  | { kind: 'host'; host: HostReport }
  /** Le nombre de sujets `proposed` d'Ananda a changé, ou un passage a commencé ou s'est terminé. */
  | { kind: 'elder'; proposed: number; running: boolean }
```

- [ ] **Étape 3 : ajouter les types d'Ananda en fin de fichier**

Après la fonction `envText` (fin du fichier), ajouter :

```ts
/** Un retour posé sur un message précis (eventSeq) ou sur la conversation entière (eventSeq: null). */
export type Feedback = {
  id: string
  sessionId: string
  eventSeq: number | null
  rating: 'up' | 'down' | null
  comment: string | null
  /** Le message commenté et ses voisins, figés au moment du retour, tronqués. */
  excerpt: string
  createdAt: number
  /** Null tant qu'Ananda ne l'a pas lu. */
  processedAt: number | null
}

export type ElderTopicStatus = 'proposed' | 'accepted' | 'rejected' | 'done'

/** Une suggestion d'amélioration : 'manual' | 'sangha' | 'project:<nom>'. */
export type ElderTopic = {
  id: string
  scope: string
  title: string
  detail: string
  /** Ids de feedback et de sessions qui l'appuient. */
  evidence: string[]
  status: ElderTopicStatus
  createdAt: number
  updatedAt: number
}

export type ElderReportKind = 'daily' | 'weekly' | 'conversation' | 'manual' | 'skipped'

export type ElderReport = {
  id: string
  kind: ElderReportKind
  text: string
  /** Sujets créés ou mis à jour par ce rapport. */
  topicIds: string[]
  costUsd: number | null
  tokens: number | null
  createdAt: number
}

export type ElderChatTurn = { id: number; role: 'user' | 'elder'; text: string; createdAt: number }

export type ElderSettings = {
  enabled: boolean
  /** Un id de ModelChoice : 'sonnet' par défaut, ou '<provider>::<model>'. */
  model: string
  levels: { manual: boolean; sangha: boolean; project: boolean }
  projects: string[]
  /** 'HH:MM', moteur fournisseur. */
  dailyAt: string
  /** day: 0-6 (convention JS, 4 = jeudi), at: 'HH:MM', maxWeekUsedPct: 0-100 — moteur Claude. */
  weekly: { day: number; at: string; maxWeekUsedPct: number }
  /** Plafond du contexte envoyé au modèle. */
  maxInputChars: number
  /** Borne « depuis le dernier passage » ; aussi ce qui marque une fenêtre hebdomadaire résolue. */
  lastRunAt: number | null
}

/** Un changement partiel de réglages : les objets imbriqués peuvent être partiels eux aussi. */
export type ElderSettingsPatch = Partial<Omit<ElderSettings, 'levels' | 'weekly'>> & {
  levels?: Partial<ElderSettings['levels']>
  weekly?: Partial<ElderSettings['weekly']>
}

export type ElderState = {
  settings: ElderSettings
  /** Best-effort : la vraie décision reste celle de `due()`. */
  nextRunAt: number | null
  running: boolean
  lastError: string | null
  topics: ElderTopic[]
  /** Les 10 derniers. */
  reports: ElderReport[]
  /** Les 20 derniers messages. */
  chat: ElderChatTurn[]
}
```

- [ ] **Étape 4 : vérifier la compilation**

Run: `npm run typecheck`
Expected: exit 0 (le paquet `shared` n'a pas de build propre, mais `apps/server` et `apps/web` l'importent en TS source — un échec de typage ailleurs apparaîtrait ici si un type était mal formé).

- [ ] **Étape 5 : commit**

```bash
git add packages/shared/src/index.ts
git commit -m "Ananda : types partagés et contrat d'API (retours, sujets, rapports, discussion, réglages)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tâche 2 [BACK] : `db.ts` — tables et accès aux données d'Ananda

**Files:**
- Modify: `apps/server/src/db.ts:4` (imports), `:62-168` (schéma), fin de la classe `Store` (`:625`), types de ligne en fin de fichier.
- Test: `apps/server/test/store.test.ts` (ajouts)

**Interfaces:**
- Consumes: `Feedback`, `ElderTopic`, `ElderReport`, `ElderChatTurn` (Tâche 1).
- Produces: `Store.addFeedback`, `.feedbackForSession`, `.pendingFeedback`, `.markFeedbackProcessed`, `.excerptAround`, `.elderTopics`, `.elderTopic`, `.upsertElderTopic`, `.elderReports`, `.addElderReport`, `.elderChat`, `.addElderChatMessage`, `.elderSanghaStats` — consommés par `elderContext.ts` (Tâche 5) et `elder.ts` (Tâche 7).

- [ ] **Étape 1 : écrire les tests (ils échouent : les méthodes n'existent pas)**

Ajouter à `apps/server/test/store.test.ts` :

```ts
import type { ElderTopic } from '@sangha/shared'

describe('feedback', () => {
  it('keeps feedback pending until marked processed', () => {
    const s = new Store(':memory:')
    s.createSession(row('a'))
    s.addFeedback({ id: 'f1', sessionId: 'a', eventSeq: 3, rating: 'down', comment: 'trop verbeux', excerpt: 'Lui : ...', createdAt: 1, processedAt: null })
    expect(s.pendingFeedback().map((f) => f.id)).toEqual(['f1'])
    s.markFeedbackProcessed(['f1'], 99)
    expect(s.pendingFeedback()).toEqual([])
    expect(s.feedbackForSession('a')[0]!.processedAt).toBe(99)
  })

  it('freezes an excerpt around the commented message, or the conversation tail when none is given', () => {
    const s = new Store(':memory:')
    s.createSession(row('a'))
    s.append('a', { t: 'user.message', text: 'un' })
    s.append('a', { t: 'buddha.text', text: 'deux' })
    s.append('a', { t: 'user.message', text: 'trois' })
    expect(s.excerptAround('a', 2)).toContain('deux')
    expect(s.excerptAround('a', null)).toContain('trois')
  })
})

describe('elder topics, reports and chat', () => {
  it('creates and updates a topic by id, reading it back', () => {
    const s = new Store(':memory:')
    const t: ElderTopic = { id: 't1', scope: 'sangha', title: 'MCP instable', detail: 'd', evidence: ['e1'], status: 'proposed', createdAt: 1, updatedAt: 1 }
    s.upsertElderTopic(t)
    s.upsertElderTopic({ ...t, status: 'accepted', updatedAt: 2 })
    expect(s.elderTopic('t1')!.status).toBe('accepted')
    expect(s.elderTopics()).toHaveLength(1)
  })

  it('keeps reports newest first', () => {
    const s = new Store(':memory:')
    s.addElderReport({ id: 'r1', kind: 'weekly', text: 'rien à signaler', topicIds: [], costUsd: 0.01, tokens: 500, createdAt: 1 })
    s.addElderReport({ id: 'r2', kind: 'manual', text: 'un sujet', topicIds: ['t1'], costUsd: null, tokens: null, createdAt: 2 })
    expect(s.elderReports().map((r) => r.id)).toEqual(['r2', 'r1'])
  })

  it('keeps the chat in order, oldest first, limited to the last N', () => {
    const s = new Store(':memory:')
    s.addElderChatMessage('user', 'un', 1)
    s.addElderChatMessage('elder', 'deux', 2)
    expect(s.elderChat(1).map((t) => t.text)).toEqual(['deux'])
    expect(s.elderChat().map((t) => t.text)).toEqual(['un', 'deux'])
  })
})

describe('elderSanghaStats', () => {
  it('aggregates tool failures by server, session errors, cost and renewals since a date', () => {
    const s = new Store(':memory:')
    s.createSession(row('a'))
    s.createSession(row('b'))
    s.append('a', { t: 'tool.error', tool: 'mcp__bitbucket__get_pr', server: 'bitbucket', message: 'timeout' })
    s.append('a', { t: 'tool.error', tool: 'mcp__bitbucket__list_prs', server: 'bitbucket', message: 'timeout' })
    s.append('a', { t: 'error', message: 'oops' })
    s.append('a', { t: 'turn.done', ok: true, costUsdEquiv: 1.5, durationMs: 1, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } })
    s.setSuccessor('a', 'b')
    const stats = s.elderSanghaStats(0)
    expect(stats.toolErrorsByServer).toEqual({ bitbucket: 2 })
    expect(stats.sessionErrors).toBe(1)
    expect(stats.costUsd).toBeCloseTo(1.5)
    expect(stats.renewals).toBe(1)
  })
})
```

- [ ] **Étape 2 : lancer les tests, vérifier qu'ils échouent**

Run: `npm test -w @sangha/server -- store.test.ts`
Expected: FAIL — `s.addFeedback is not a function` (et les suivantes).

- [ ] **Étape 3 : schéma — ajouter les 4 tables**

Dans `apps/server/src/db.ts`, remplacer la ligne 4 :

```ts
import type { AutonomyState, Engine, Envelope, MonasteryEvent, Provider, QueuedMessage, Quota, SessionInfo } from '@sangha/shared'
```

par :

```ts
import type { AutonomyState, Engine, Envelope, ElderChatTurn, ElderReport, ElderTopic, Feedback, MonasteryEvent, Provider, QueuedMessage, Quota, SessionInfo } from '@sangha/shared'
```

Puis, juste avant la ligne 168 (`);` qui ferme le bloc `this.db.exec`), ajouter :

```sql
      CREATE TABLE IF NOT EXISTS feedback (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        event_seq INTEGER,
        rating TEXT,
        comment TEXT,
        excerpt TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        processed_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS elder_topics (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT NOT NULL,
        evidence TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS elder_reports (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        topic_ids TEXT NOT NULL,
        cost_usd REAL,
        tokens INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS elder_chat (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
```

- [ ] **Étape 4 : méthodes `Store`**

Juste avant la fermeture de la classe `Store` (ligne 626, `}`), ajouter :

```ts
  addFeedback(f: Feedback) {
    this.db
      .prepare('INSERT INTO feedback (id, session_id, event_seq, rating, comment, excerpt, created_at, processed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(f.id, f.sessionId, f.eventSeq, f.rating, f.comment, f.excerpt, f.createdAt, f.processedAt)
  }

  feedbackForSession(sessionId: string): Feedback[] {
    return (this.db.prepare('SELECT * FROM feedback WHERE session_id = ? ORDER BY created_at').all(sessionId) as FeedbackRow[]).map(toFeedback)
  }

  pendingFeedback(): Feedback[] {
    return (this.db.prepare('SELECT * FROM feedback WHERE processed_at IS NULL ORDER BY created_at').all() as FeedbackRow[]).map(toFeedback)
  }

  markFeedbackProcessed(ids: string[], at: number) {
    const stmt = this.db.prepare('UPDATE feedback SET processed_at = ? WHERE id = ?')
    for (const id of ids) stmt.run(at, id)
  }

  /** Contexte figé pour un retour : le message commenté et ses voisins (ou la fin de la conversation), tronqué. */
  excerptAround(sessionId: string, eventSeq: number | null, maxChars = 1200): string {
    const all = this.events(sessionId)
    const line = (e: Envelope) => (e.ev.t === 'user.message' ? `Toi : ${e.ev.text}` : e.ev.t === 'buddha.text' ? `Lui : ${e.ev.text}` : null)
    const picked =
      eventSeq == null
        ? all.slice(-6)
        : (() => {
            const i = all.findIndex((e) => e.seq === eventSeq)
            return i < 0 ? [] : all.slice(Math.max(0, i - 2), i + 3)
          })()
    const text = picked.map(line).filter((t): t is string => !!t).join('\n\n')
    return text.length > maxChars ? `…${text.slice(-maxChars)}` : text
  }

  elderTopics(): ElderTopic[] {
    return (this.db.prepare('SELECT * FROM elder_topics ORDER BY updated_at DESC').all() as ElderTopicRow[]).map(toTopic)
  }

  elderTopic(id: string): ElderTopic | null {
    const r = this.db.prepare('SELECT * FROM elder_topics WHERE id = ?').get(id) as ElderTopicRow | undefined
    return r ? toTopic(r) : null
  }

  upsertElderTopic(t: ElderTopic) {
    this.db
      .prepare(
        `INSERT INTO elder_topics (id, scope, title, detail, evidence, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET scope = excluded.scope, title = excluded.title, detail = excluded.detail, evidence = excluded.evidence, status = excluded.status, updated_at = excluded.updated_at`,
      )
      .run(t.id, t.scope, t.title, t.detail, JSON.stringify(t.evidence), t.status, t.createdAt, t.updatedAt)
  }

  elderReports(limit = 10): ElderReport[] {
    return (this.db.prepare('SELECT * FROM elder_reports ORDER BY created_at DESC LIMIT ?').all(limit) as ElderReportRow[]).map(toReport)
  }

  addElderReport(r: ElderReport) {
    this.db
      .prepare('INSERT INTO elder_reports (id, kind, text, topic_ids, cost_usd, tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(r.id, r.kind, r.text, JSON.stringify(r.topicIds), r.costUsd, r.tokens, r.createdAt)
  }

  elderChat(limit = 20): ElderChatTurn[] {
    return (this.db.prepare('SELECT * FROM elder_chat ORDER BY id DESC LIMIT ?').all(limit) as ElderChatRow[]).map(toChatTurn).reverse()
  }

  addElderChatMessage(role: 'user' | 'elder', text: string, at: number) {
    this.db.prepare('INSERT INTO elder_chat (role, text, created_at) VALUES (?, ?, ?)').run(role, text, at)
  }

  /** Agrégats pour le bloc « Sangha » du contexte d'Ananda : échecs d'outils MCP, erreurs, interruptions, renouvellements, prêtres confiés à Bouddha, coût total, depuis `since`. */
  elderSanghaStats(since: number): { toolErrorsByServer: Record<string, number>; sessionErrors: number; interruptions: number; renewals: number; shepherded: number; costUsd: number } {
    const rows = this.db
      .prepare(`SELECT session_id, ev FROM events WHERE at >= ? AND (ev LIKE '{"t":"tool.error"%' OR ev LIKE '{"t":"error"%' OR ev LIKE '{"t":"turn.done"%')`)
      .all(since) as { session_id: string; ev: string }[]
    const toolErrorsByServer: Record<string, number> = {}
    let sessionErrors = 0
    let costUsd = 0
    for (const { ev: raw } of rows) {
      const ev = JSON.parse(raw) as MonasteryEvent
      if (ev.t === 'tool.error') toolErrorsByServer[ev.server] = (toolErrorsByServer[ev.server] ?? 0) + 1
      else if (ev.t === 'error') sessionErrors++
      else if (ev.t === 'turn.done') costUsd += ev.costUsdEquiv
    }
    const busySessions = new Set(
      (this.db.prepare(`SELECT DISTINCT session_id FROM events WHERE at >= ? AND ev LIKE '{"t":"busy"%'`).all(since) as { session_id: string }[]).map((r) => r.session_id),
    )
    let interruptions = 0
    for (const id of busySessions) {
      const last = this.lastEvent(id, 'busy')
      if (last && last.ev.busy && last.at >= since) interruptions++
    }
    const renewals = (
      this.db.prepare('SELECT COUNT(*) AS n FROM successors s JOIN sessions sess ON sess.id = s.next_id WHERE sess.created_at >= ?').get(since) as { n: number }
    ).n
    const shepherded = (this.db.prepare('SELECT value FROM shepherds').all() as { value: string }[]).filter((r) => (JSON.parse(r.value) as Shepherd).seenAt >= since).length
    return { toolErrorsByServer, sessionErrors, interruptions, renewals, shepherded, costUsd }
  }
```

En fin de fichier (après `const toSession = ...`), ajouter les types de ligne et convertisseurs :

```ts
type FeedbackRow = { id: string; session_id: string; event_seq: number | null; rating: string | null; comment: string | null; excerpt: string; created_at: number; processed_at: number | null }
const toFeedback = (r: FeedbackRow): Feedback => ({
  id: r.id,
  sessionId: r.session_id,
  eventSeq: r.event_seq,
  rating: r.rating as Feedback['rating'],
  comment: r.comment,
  excerpt: r.excerpt,
  createdAt: r.created_at,
  processedAt: r.processed_at,
})

type ElderTopicRow = { id: string; scope: string; title: string; detail: string; evidence: string; status: string; created_at: number; updated_at: number }
const toTopic = (r: ElderTopicRow): ElderTopic => ({
  id: r.id,
  scope: r.scope,
  title: r.title,
  detail: r.detail,
  evidence: JSON.parse(r.evidence),
  status: r.status as ElderTopic['status'],
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

type ElderReportRow = { id: string; kind: string; text: string; topic_ids: string; cost_usd: number | null; tokens: number | null; created_at: number }
const toReport = (r: ElderReportRow): ElderReport => ({
  id: r.id,
  kind: r.kind as ElderReport['kind'],
  text: r.text,
  topicIds: JSON.parse(r.topic_ids),
  costUsd: r.cost_usd,
  tokens: r.tokens,
  createdAt: r.created_at,
})

type ElderChatRow = { id: number; role: string; text: string; created_at: number }
const toChatTurn = (r: ElderChatRow): ElderChatTurn => ({ id: r.id, role: r.role as ElderChatTurn['role'], text: r.text, createdAt: r.created_at })
```

- [ ] **Étape 5 : lancer les tests, vérifier qu'ils passent**

Run: `npm test -w @sangha/server -- store.test.ts`
Expected: PASS, toutes les nouvelles `describe` vertes.

- [ ] **Étape 6 : commit**

```bash
git add packages/shared/src/index.ts apps/server/src/db.ts apps/server/test/store.test.ts
git commit -m "Ananda : les retours, sujets, rapports et la discussion prennent place en base

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tâche 3 [BACK] : `normalize.ts` — détecter l'échec d'un outil MCP

**Files:**
- Modify: `apps/server/src/normalize.ts`
- Test: `apps/server/test/normalize.test.ts` (ajouts)

**Interfaces:**
- Consumes: `tool.error` (Tâche 1).
- Produces: `Normalizer` émet `{ t: 'tool.error', tool, server, message }` pour un outil `mcp__<server>__...` en échec sur le fil principal — consommé par `Store.elderSanghaStats` (déjà écrit, Tâche 2) via les événements persistés.

- [ ] **Étape 1 : écrire les tests (ils échouent)**

Ajouter à `apps/server/test/normalize.test.ts` :

```ts
describe('Normalizer on MCP tool failures', () => {
  const toolUse = (id: string, name: string, parent: string | null = null) => ({
    type: 'assistant',
    parent_tool_use_id: parent,
    message: { content: [{ type: 'tool_use', id, name, input: {} }] },
  })
  const toolResult = (toolUseId: string, isError: boolean, content: unknown = 'boom', parent: string | null = null) => ({
    type: 'user',
    parent_tool_use_id: parent,
    message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: isError, content }] },
  })

  it('reports an MCP tool failure on the main thread, with its server', () => {
    const n = new Normalizer()
    n.push(toolUse('toolu_1', 'mcp__bitbucket__get_pr') as never)
    const evs = n.push(toolResult('toolu_1', true, 'timeout') as never)
    expect(evs).toEqual([{ t: 'tool.error', tool: 'mcp__bitbucket__get_pr', server: 'bitbucket', message: 'timeout' }])
  })

  it('ignores a successful tool result', () => {
    const n = new Normalizer()
    n.push(toolUse('toolu_1', 'mcp__bitbucket__get_pr') as never)
    expect(n.push(toolResult('toolu_1', false) as never)).toEqual([])
  })

  it('ignores a non-MCP tool failure (Bash, Read…)', () => {
    const n = new Normalizer()
    n.push(toolUse('toolu_1', 'Bash') as never)
    expect(n.push(toolResult('toolu_1', true) as never)).toEqual([])
  })

  it('ignores a novice’s own tool failure (parent set)', () => {
    const n = new Normalizer()
    n.push(toolUse('toolu_1', 'mcp__bitbucket__get_pr', 'toolu_monk') as never)
    expect(n.push(toolResult('toolu_1', true, 'boom', 'toolu_monk') as never)).toEqual([])
  })
})
```

- [ ] **Étape 2 : lancer les tests, vérifier qu'ils échouent**

Run: `npm test -w @sangha/server -- normalize.test.ts`
Expected: FAIL — `n.push` sur un message `type: 'user'` retourne `[]` par le `default` actuel, pas `tool.error`.

- [ ] **Étape 3 : implémenter**

Dans `apps/server/src/normalize.ts`, ajouter un champ à la classe `Normalizer` (après les déclarations existantes de `monkByTask`/`taskByMonk`, ligne 17) :

```ts
  // tool_use id -> ce qui a été appelé et par qui (pour relier le tool_result qui suit, un message plus tard)
  private toolUseNames = new Map<string, { name: string; parent: string | null }>()
```

Ajouter un cas dans `push()` (après le `case 'assistant': ...`) :

```ts
      case 'user':
        return this.toolResults(m)
```

Dans `private assistant(...)`, élargir le type du bloc itéré (ligne 110) pour inclure `id` :

```ts
    for (const block of content as Array<{ type: string; text?: string; name?: string; input?: unknown; id?: string }>) {
```

et, dans la branche `tool_use` (avant le `if (!parent && SUMMON_TOOLS.has(block.name)) continue`), ajouter :

```ts
        if (block.id) this.toolUseNames.set(block.id, { name: block.name, parent })
```

Ajouter la méthode (après `private assistant(...)`) :

```ts
  private toolResults(m: Extract<SDKMessage, { type: 'user' }>): MonasteryEvent[] {
    const content = m.message.content
    if (!Array.isArray(content)) return []
    const out: MonasteryEvent[] = []
    for (const block of content as Array<{ type: string; tool_use_id?: string; is_error?: boolean; content?: unknown }>) {
      if (block.type !== 'tool_result' || !block.is_error || !block.tool_use_id) continue
      const used = this.toolUseNames.get(block.tool_use_id)
      if (!used || used.parent) continue // seuls les outils de son propre fil nourrissent le bloc Sangha d'Ananda
      const parts = used.name.split('__')
      if (parts.length < 2 || parts[0] !== 'mcp') continue // pas un outil MCP : Ananda ne suit que les échecs de serveur
      out.push({ t: 'tool.error', tool: used.name, server: parts[1]!, message: toolErrorMessage(block.content) })
    }
    return out
  }
```

Ajouter la fonction utilitaire (à côté de `truncate`, fin de fichier) :

```ts
function toolErrorMessage(content: unknown): string {
  if (typeof content === 'string') return truncate(content.replace(/\s+/g, ' ').trim(), 200)
  if (Array.isArray(content)) {
    const text = content.find((b): b is { type: string; text?: string } => typeof b === 'object' && b !== null && (b as { type?: string }).type === 'text')?.text
    if (typeof text === 'string') return truncate(text.replace(/\s+/g, ' ').trim(), 200)
  }
  return 'échec'
}
```

- [ ] **Étape 4 : lancer les tests, vérifier qu'ils passent**

Run: `npm test -w @sangha/server -- normalize.test.ts`
Expected: PASS.

- [ ] **Étape 5 : commit**

```bash
git add apps/server/src/normalize.ts apps/server/test/normalize.test.ts
git commit -m "Ananda : les échecs d'outils MCP du fil principal deviennent un événement, par serveur

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tâche 4 [BACK] : `elderSchedule.ts` — `due()`, pur

**Files:**
- Create: `apps/server/src/elderSchedule.ts`
- Test: `apps/server/test/elderSchedule.test.ts`

**Interfaces:**
- Consumes: `ElderSettings`, `Quota` (Tâche 1).
- Produces: `due(now, settings, quota, pending): ElderPass | null`, `elderEngine(model): 'claude' | 'provider'`, `type PendingSession`, `type ElderPass` — consommés par `elder.ts` (Tâche 7).

- [ ] **Étape 1 : écrire les tests (ils échouent)**

Créer `apps/server/test/elderSchedule.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import type { ElderSettings, Quota } from '@sangha/shared'
import { due, elderEngine, type PendingSession } from '../src/elderSchedule'

const SETTINGS: ElderSettings = {
  enabled: true,
  model: 'sonnet',
  levels: { manual: true, sangha: true, project: false },
  projects: [],
  dailyAt: '08:00',
  weekly: { day: 4, at: '12:00', maxWeekUsedPct: 20 },
  maxInputChars: 24_000,
  lastRunAt: null,
}
const PROVIDER_SETTINGS: ElderSettings = { ...SETTINGS, model: 'ovh::llama-4' }

const quota = (pct: number | null): Quota | null => (pct === null ? null : { status: 'allowed', fiveHour: null, sevenDay: { utilization: pct / 100, resetsAt: null } })

// 2026-01-01 est un jeudi ; 2026-01-02 un vendredi.
const THURSDAY_NOON = new Date(2026, 0, 1, 12, 0, 0).getTime()
const FRIDAY_2300 = new Date(2026, 0, 2, 23, 0, 0).getTime()

describe('elderEngine', () => {
  it('reads claude from a bare alias, a provider from provider::model', () => {
    expect(elderEngine('sonnet')).toBe('claude')
    expect(elderEngine('')).toBe('claude')
    expect(elderEngine('ovh::llama-4')).toBe('provider')
  })
})

describe('due — weekly (Claude)', () => {
  it('fires at Thursday 12:00 when the week quota is OK', () => {
    expect(due(THURSDAY_NOON, SETTINGS, quota(15), [])).toEqual({ kind: 'weekly' })
  })

  it('does not fire when the week quota is over the threshold', () => {
    expect(due(THURSDAY_NOON, SETTINGS, quota(30), [])).toBeNull()
  })

  it('does not fire when the quota is unknown', () => {
    expect(due(THURSDAY_NOON, SETTINGS, null, [])).toBeNull()
  })

  it('retries hourly: still null with bad quota, fires once quota clears', () => {
    const at16 = THURSDAY_NOON + 4 * 3600_000
    expect(due(at16, SETTINGS, quota(30), [])).toBeNull()
    expect(due(at16, SETTINGS, quota(10), [])).toEqual({ kind: 'weekly' })
  })

  it('gives up at Friday 23:00, recording a skip, and never twice for the same week', () => {
    expect(due(FRIDAY_2300 - 1, SETTINGS, quota(90), [])).toBeNull()
    expect(due(FRIDAY_2300 + 1, SETTINGS, quota(90), [])).toEqual({ kind: 'skipped' })
    const resolved = { ...SETTINGS, lastRunAt: FRIDAY_2300 + 1 }
    expect(due(FRIDAY_2300 + 2, resolved, quota(90), [])).toBeNull()
  })

  it('does nothing once disabled', () => {
    expect(due(THURSDAY_NOON, { ...SETTINGS, enabled: false }, quota(10), [])).toBeNull()
  })

  it('does not refire the same week once already run', () => {
    const ranToday = { ...SETTINGS, lastRunAt: THURSDAY_NOON }
    expect(due(THURSDAY_NOON + 1000, ranToday, quota(5), [])).toBeNull()
  })
})

describe('due — daily and end-of-conversation (a fournisseur)', () => {
  const morning = new Date(2026, 0, 5, 8, 0, 0).getTime()
  const session = (over: Partial<PendingSession>): PendingSession => ({ id: 's1', archived: false, idleMs: 0, hasPendingFeedback: false, ...over })

  it('fires once at dailyAt', () => {
    expect(due(morning, PROVIDER_SETTINGS, null, [])).toEqual({ kind: 'daily' })
  })

  it('does not refire later the same day', () => {
    expect(due(morning + 1, { ...PROVIDER_SETTINGS, lastRunAt: morning }, null, [])).toBeNull()
  })

  it('fires on a session sent to nirvana with an unprocessed feedback', () => {
    const noon = morning + 4 * 3600_000
    expect(due(noon, { ...PROVIDER_SETTINGS, lastRunAt: morning }, null, [session({ archived: true, hasPendingFeedback: true })])).toEqual({ kind: 'conversation', sessionId: 's1' })
  })

  it('fires on 30 min of inactivity with an unprocessed feedback', () => {
    const noon = morning + 4 * 3600_000
    expect(due(noon, { ...PROVIDER_SETTINGS, lastRunAt: morning }, null, [session({ idleMs: 31 * 60_000, hasPendingFeedback: true })])).toEqual({ kind: 'conversation', sessionId: 's1' })
  })

  it('does nothing for a finished session with no feedback', () => {
    const noon = morning + 4 * 3600_000
    expect(due(noon, { ...PROVIDER_SETTINGS, lastRunAt: morning }, null, [session({ archived: true, hasPendingFeedback: false })])).toBeNull()
  })

  it('does not fire on a live session still under 30 minutes idle', () => {
    const noon = morning + 4 * 3600_000
    expect(due(noon, { ...PROVIDER_SETTINGS, lastRunAt: morning }, null, [session({ idleMs: 5 * 60_000, hasPendingFeedback: true })])).toBeNull()
  })
})
```

- [ ] **Étape 2 : lancer les tests, vérifier qu'ils échouent**

Run: `npm test -w @sangha/server -- elderSchedule.test.ts`
Expected: FAIL — le module `../src/elderSchedule` n'existe pas.

- [ ] **Étape 3 : implémenter**

Créer `apps/server/src/elderSchedule.ts` :

```ts
import type { ElderSettings, Quota } from '@sangha/shared'

export type ElderPass = { kind: 'weekly' } | { kind: 'daily' } | { kind: 'conversation'; sessionId: string } | { kind: 'skipped' }

export type PendingSession = {
  id: string
  /** Il est parti au nirvana : une conversation finie, quel que soit son temps d'inactivité. */
  archived: boolean
  /** Millisecondes depuis la fin de son dernier tour (ignoré si `archived`). */
  idleMs: number
  /** Au moins un retour sur lui n'a pas encore `processedAt`. */
  hasPendingFeedback: boolean
}

const INACTIVE_MS = 30 * 60_000
const SKIP_HOUR = 23 // « vendredi 23:00 » : le jour suivant le jour hebdomadaire, à cette heure

/** 'claude' : Ananda pense avec l'abonnement (rythme hebdomadaire) ; 'provider' : un fournisseur (quotidien + fin de conversation). */
export const elderEngine = (model: string): 'claude' | 'provider' => (model.includes('::') ? 'provider' : 'claude')

function atTime(base: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date(base)
  d.setHours(h || 0, m || 0, 0, 0)
  return d
}

/** Occurrence la plus récente de `day` (0-6, convention JS) à `at`, à ou avant `now`. */
function lastOccurrence(now: Date, day: number, at: string): Date {
  const diff = (now.getDay() - day + 7) % 7
  const d = new Date(now)
  d.setDate(d.getDate() - diff)
  const t = atTime(d, at)
  return t > now ? new Date(t.getTime() - 7 * 86_400_000) : t
}

const quotaOk = (quota: Quota | null, maxPct: number) => !!quota?.sevenDay && quota.sevenDay.utilization * 100 <= maxPct

export function due(now: number, settings: ElderSettings, quota: Quota | null, pending: PendingSession[]): ElderPass | null {
  if (!settings.enabled) return null
  const nowD = new Date(now)
  const lastRun = settings.lastRunAt

  if (elderEngine(settings.model) === 'claude') {
    const windowStart = lastOccurrence(nowD, settings.weekly.day, settings.weekly.at)
    if (nowD < windowStart) return null
    if (lastRun != null && lastRun >= windowStart.getTime()) return null
    if (quotaOk(quota, settings.weekly.maxWeekUsedPct)) return { kind: 'weekly' }
    const windowEnd = atTime(new Date(windowStart.getTime() + 86_400_000), `${SKIP_HOUR}:00`)
    return nowD > windowEnd ? { kind: 'skipped' } : null
  }

  const todayAt = atTime(nowD, settings.dailyAt)
  if (nowD >= todayAt && (lastRun == null || lastRun < todayAt.getTime())) return { kind: 'daily' }
  const finished = pending.find((p) => p.hasPendingFeedback && (p.archived || p.idleMs >= INACTIVE_MS))
  return finished ? { kind: 'conversation', sessionId: finished.id } : null
}
```

- [ ] **Étape 4 : lancer les tests, vérifier qu'ils passent**

Run: `npm test -w @sangha/server -- elderSchedule.test.ts`
Expected: PASS.

- [ ] **Étape 5 : commit**

```bash
git add apps/server/src/elderSchedule.ts apps/server/test/elderSchedule.test.ts
git commit -m "Ananda : la règle de rythme (hebdomadaire sous garde de quota, quotidien, fin de conversation)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tâche 5 [BACK] : `elderContext.ts` — `buildContext()`, pur

**Files:**
- Create: `apps/server/src/elderContext.ts`
- Test: `apps/server/test/elderContext.test.ts`

**Interfaces:**
- Consumes: `Store` (Tâche 2), `ElderSettings` (Tâche 1).
- Produces: `buildContext(settings, since, store, sessionId?): { text: string; newItems: number }` — consommé par `elder.ts` (Tâche 7).

- [ ] **Étape 1 : écrire les tests (ils échouent)**

Créer `apps/server/test/elderContext.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import type { ElderSettings, SessionRow } from '@sangha/shared'
import { Store } from '../src/db'
import { buildContext } from '../src/elderContext'

const SETTINGS: ElderSettings = {
  enabled: true,
  model: 'sonnet',
  levels: { manual: true, sangha: true, project: true },
  projects: ['robia'],
  dailyAt: '08:00',
  weekly: { day: 4, at: '12:00', maxWeekUsedPct: 20 },
  maxInputChars: 24_000,
  lastRunAt: null,
}

const row = (id: string, project = 'robia'): Omit<SessionRow, 'worktree' | 'baseSha' | 'archivedAt' | 'lastSeenSeq'> & { worktree: null; baseSha: null; archivedAt: null; lastSeenSeq: number } => ({
  id,
  project,
  agent: 'lead',
  title: 't',
  createdAt: 1,
  claudeSessionId: null,
  branch: null,
  worktree: null,
  baseSha: null,
  archivedAt: null,
  lastSeenSeq: 0,
})

describe('buildContext', () => {
  it('is empty with newItems = 0 when there is nothing new', () => {
    const store = new Store(':memory:')
    expect(buildContext(SETTINGS, 0, store)).toEqual({ text: '', newItems: 0 })
  })

  it('includes pending feedback, counted in newItems', () => {
    const store = new Store(':memory:')
    store.createSession(row('a') as never)
    store.addFeedback({ id: 'f1', sessionId: 'a', eventSeq: null, rating: 'down', comment: 'trop long', excerpt: 'x', createdAt: 1, processedAt: null })
    const ctx = buildContext(SETTINGS, 0, store)
    expect(ctx.text).toContain('trop long')
    expect(ctx.newItems).toBe(1)
  })

  it('omits the feedback block when the manual level is off', () => {
    const store = new Store(':memory:')
    store.createSession(row('a') as never)
    store.addFeedback({ id: 'f1', sessionId: 'a', eventSeq: null, rating: 'down', comment: 'trop long', excerpt: 'x', createdAt: 1, processedAt: null })
    const ctx = buildContext({ ...SETTINGS, levels: { ...SETTINGS.levels, manual: false } }, 0, store)
    expect(ctx.text).not.toContain('trop long')
    expect(ctx.newItems).toBe(0)
  })

  it('excludes a project not followed', () => {
    const store = new Store(':memory:')
    store.createSession(row('a', 'other') as never)
    store.archive('a')
    store.setNote('a', 'nirvana', String(store.getSession('a')!.archivedAt), { summary: 'résumé secret' })
    const ctx = buildContext(SETTINGS, 0, store) // 'other' n'est pas dans settings.projects
    expect(ctx.text).not.toContain('résumé secret')
  })

  it('restricts to one session for a conversation-end pass, skipping the project and sangha blocks', () => {
    const store = new Store(':memory:')
    store.createSession(row('a') as never)
    store.createSession(row('b') as never)
    store.addFeedback({ id: 'f1', sessionId: 'a', eventSeq: null, rating: 'up', comment: 'pour a', excerpt: 'x', createdAt: 1, processedAt: null })
    store.addFeedback({ id: 'f2', sessionId: 'b', eventSeq: null, rating: 'up', comment: 'pour b', excerpt: 'x', createdAt: 1, processedAt: null })
    const ctx = buildContext(SETTINGS, 0, store, 'a')
    expect(ctx.text).toContain('pour a')
    expect(ctx.text).not.toContain('pour b')
    expect(ctx.newItems).toBe(1)
  })

  it('truncates to maxInputChars, feedback first', () => {
    const store = new Store(':memory:')
    store.createSession(row('a') as never)
    store.addFeedback({ id: 'f1', sessionId: 'a', eventSeq: null, rating: null, comment: 'x'.repeat(100), excerpt: 'y'.repeat(100), createdAt: 1, processedAt: null })
    const ctx = buildContext({ ...SETTINGS, maxInputChars: 50 }, 0, store)
    expect(ctx.text.length).toBeLessThanOrEqual(80)
  })
})
```

- [ ] **Étape 2 : lancer les tests, vérifier qu'ils échouent**

Run: `npm test -w @sangha/server -- elderContext.test.ts`
Expected: FAIL — le module `../src/elderContext` n'existe pas.

- [ ] **Étape 3 : implémenter**

Créer `apps/server/src/elderContext.ts` :

```ts
import type { ElderSettings } from '@sangha/shared'
import type { Store } from './db'

export type ElderContext = { text: string; newItems: number }

function feedbackBlock(store: Store, sessionId: string | undefined, maxItems = 50): { text: string; count: number } {
  const rows = store.pendingFeedback().filter((f) => !sessionId || f.sessionId === sessionId).slice(0, maxItems)
  if (!rows.length) return { text: '', count: 0 }
  const lines = rows.map((f) => `- [${f.id}] ${f.rating ?? 'sans note'}${f.comment ? ` : ${f.comment}` : ''}\n  ${f.excerpt}`)
  return { text: lines.join('\n'), count: rows.length }
}

function projectBlock(store: Store, projects: string[], since: number): { text: string; count: number } {
  if (!projects.length) return { text: '', count: 0 }
  const rows = store.archivedSessions().filter((r) => projects.includes(r.project) && (r.archivedAt ?? 0) >= since)
  const withSummary = rows.map((r) => ({ r, summary: store.note<{ summary: string }>(r.id, 'nirvana')?.value.summary ?? null })).filter((x): x is { r: typeof rows[number]; summary: string } => !!x.summary)
  if (!withSummary.length) return { text: '', count: 0 }
  return { text: withSummary.map(({ r, summary }) => `- (${r.project}) ${r.title} : ${summary}`).join('\n'), count: withSummary.length }
}

function sanghaBlock(store: Store, since: number): { text: string; hasNew: boolean } {
  const stats = store.elderSanghaStats(since)
  const lines: string[] = []
  const errs = Object.entries(stats.toolErrorsByServer)
  if (errs.length) lines.push(`Échecs d'outils MCP : ${errs.map(([s, n]) => `${s} (${n})`).join(', ')}`)
  if (stats.sessionErrors) lines.push(`Erreurs de session : ${stats.sessionErrors}`)
  if (stats.interruptions) lines.push(`Sessions interrompues : ${stats.interruptions}`)
  if (stats.renewals) lines.push(`Renouvellements (session neuve) : ${stats.renewals}`)
  if (stats.shepherded) lines.push(`Sessions confiées à Bouddha : ${stats.shepherded}`)
  if (stats.costUsd > 0) lines.push(`Coût total (équivalent API) : ${stats.costUsd.toFixed(2)} $`)
  return { text: lines.join('\n'), hasNew: lines.length > 0 }
}

function memoryBlock(store: Store): string {
  const topics = store.elderTopics()
  const open = topics.filter((t) => t.status === 'proposed' || t.status === 'accepted')
  const rejected = topics.filter((t) => t.status === 'rejected')
  const lines: string[] = []
  if (open.length) lines.push(`Sujets ouverts :\n${open.map((t) => `- [${t.id}] (${t.status}) ${t.title}`).join('\n')}`)
  if (rejected.length) lines.push(`Déjà rejetés, ne pas reproposer :\n${rejected.map((t) => `- ${t.title}`).join('\n')}`)
  return lines.join('\n\n')
}

function fit(blocks: { label: string; text: string }[], max: number): string {
  let budget = max
  const parts: string[] = []
  for (const b of blocks) {
    if (!b.text || budget <= 0) continue
    const take = b.text.length > budget ? `${b.text.slice(0, Math.max(0, budget - 1))}…` : b.text
    parts.push(`## ${b.label}\n${take}`)
    budget -= take.length
  }
  return parts.join('\n\n')
}

/** Le contexte envoyé au modèle, par blocs actifs selon le niveau, tronqué à `maxInputChars` (retours en priorité).
 *  `sessionId` : un passage de fin de conversation, restreint à cette session (ses retours, rien d'autre). */
export function buildContext(settings: ElderSettings, since: number, store: Store, sessionId?: string): ElderContext {
  const feedback = settings.levels.manual || sessionId ? feedbackBlock(store, sessionId) : { text: '', count: 0 }
  const project = !sessionId && settings.levels.project ? projectBlock(store, settings.projects, since) : { text: '', count: 0 }
  const sangha = !sessionId && settings.levels.sangha ? sanghaBlock(store, since) : { text: '', hasNew: false }
  const memory = memoryBlock(store)

  const text = fit(
    [
      { label: 'Retours', text: feedback.text },
      { label: 'Projets suivis', text: project.text },
      { label: 'Sangha', text: sangha.text },
      { label: 'Mémoire', text: memory },
    ],
    settings.maxInputChars,
  )
  const newItems = feedback.count + project.count + (sangha.hasNew ? 1 : 0)
  return { text, newItems }
}
```

- [ ] **Étape 4 : lancer les tests, vérifier qu'ils passent**

Run: `npm test -w @sangha/server -- elderContext.test.ts`
Expected: PASS.

- [ ] **Étape 5 : commit**

```bash
git add apps/server/src/elderContext.ts apps/server/test/elderContext.test.ts
git commit -m "Ananda : assemblage du contexte envoyé au modèle, par niveau, tronqué aux retours en priorité

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tâche 6 [BACK] : `elderParse.ts` — validation de la réponse du modèle, pur

**Files:**
- Create: `apps/server/src/elderParse.ts`
- Test: `apps/server/test/elderParse.test.ts`

**Interfaces:**
- Consumes: `ElderSettings['levels']` (Tâche 1).
- Produces: `parseElderResponse(raw, knownTopicIds, levels, projects): ElderAnswer | null`, `type ElderTopicDraft` — consommés par `elder.ts` (Tâche 7).

- [ ] **Étape 1 : écrire les tests (ils échouent)**

Créer `apps/server/test/elderParse.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { parseElderResponse } from '../src/elderParse'

const LEVELS = { manual: true, sangha: true, project: true }
const PROJECTS = ['robia']

describe('parseElderResponse', () => {
  it('rejects anything without a report', () => {
    expect(parseElderResponse({ topics: [] }, new Set(), LEVELS, PROJECTS)).toBeNull()
    expect(parseElderResponse(null, new Set(), LEVELS, PROJECTS)).toBeNull()
  })

  it('keeps a topic update when its id is known', () => {
    const out = parseElderResponse({ report: 'rien à signaler', topics: [{ id: 't1', scope: 'sangha', title: 'x', detail: 'y', evidence: [] }] }, new Set(['t1']), LEVELS, PROJECTS)
    expect(out?.topics).toEqual([{ id: 't1', scope: 'sangha', title: 'x', detail: 'y', evidence: [] }])
  })

  it('treats an unknown id as a new topic (drops the id), keeping the title', () => {
    const out = parseElderResponse({ report: 'r', topics: [{ id: 'ghost', scope: 'sangha', title: 'x', detail: 'y', evidence: [] }] }, new Set(['t1']), LEVELS, PROJECTS)
    expect(out?.topics).toEqual([{ scope: 'sangha', title: 'x', detail: 'y', evidence: [] }])
  })

  it('rejects a scope from a disabled level, or an unfollowed project', () => {
    const levelsOff = { manual: true, sangha: false, project: true }
    const out = parseElderResponse(
      {
        report: 'r',
        topics: [
          { scope: 'sangha', title: 'a', detail: 'd', evidence: [] },
          { scope: 'project:ghost', title: 'b', detail: 'd', evidence: [] },
          { scope: 'project:robia', title: 'c', detail: 'd', evidence: [] },
        ],
      },
      new Set(),
      levelsOff,
      PROJECTS,
    )
    expect(out?.topics.map((t) => t.title)).toEqual(['c'])
  })

  it('caps new topics at 5, keeping updates uncapped', () => {
    const topics = Array.from({ length: 6 }, (_, i) => ({ scope: 'sangha', title: `t${i}`, detail: 'd', evidence: [] }))
    const out = parseElderResponse({ report: 'r', topics }, new Set(), LEVELS, PROJECTS)
    expect(out?.topics).toHaveLength(5)
  })

  it('rejects topics with an empty title or detail', () => {
    const out = parseElderResponse(
      { report: 'r', topics: [{ scope: 'sangha', title: '', detail: 'd', evidence: [] }, { scope: 'sangha', title: 't', detail: '', evidence: [] }] },
      new Set(),
      LEVELS,
      PROJECTS,
    )
    expect(out?.topics).toEqual([])
  })
})
```

- [ ] **Étape 2 : lancer les tests, vérifier qu'ils échouent**

Run: `npm test -w @sangha/server -- elderParse.test.ts`
Expected: FAIL — le module `../src/elderParse` n'existe pas.

- [ ] **Étape 3 : implémenter**

Créer `apps/server/src/elderParse.ts` :

```ts
import type { ElderSettings } from '@sangha/shared'

export type ElderTopicDraft = { id?: string; scope: string; title: string; detail: string; evidence: string[] }
export type ElderAnswer = { report: string; topics: ElderTopicDraft[] }

const MAX_NEW_TOPICS = 5

function scopeAllowed(scope: string, levels: ElderSettings['levels'], projects: string[]): boolean {
  if (scope === 'manual') return levels.manual
  if (scope === 'sangha') return levels.sangha
  const m = /^project:(.+)$/.exec(scope)
  return !!m && levels.project && projects.includes(m[1]!)
}

/** Ids inconnus traités comme nouveaux (titre requis), portée interdite rejetée, au plus 5 sujets nouveaux, champs vides rejetés. */
export function parseElderResponse(raw: unknown, knownTopicIds: Set<string>, levels: ElderSettings['levels'], projects: string[]): ElderAnswer | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  if (typeof rec.report !== 'string' || !rec.report.trim()) return null
  const rawTopics = Array.isArray(rec.topics) ? rec.topics : []
  let newCount = 0
  const topics: ElderTopicDraft[] = []
  for (const t of rawTopics) {
    const tr = t as Record<string, unknown> | null
    if (!tr || typeof tr !== 'object') continue
    const title = typeof tr.title === 'string' ? tr.title.trim() : ''
    const detail = typeof tr.detail === 'string' ? tr.detail.trim() : ''
    const scope = typeof tr.scope === 'string' ? tr.scope : ''
    if (!title || !detail || !scope) continue
    if (!scopeAllowed(scope, levels, projects)) continue
    const evidence = Array.isArray(tr.evidence) ? tr.evidence.filter((e): e is string => typeof e === 'string') : []
    const id = typeof tr.id === 'string' && knownTopicIds.has(tr.id) ? tr.id : undefined
    if (!id) {
      if (newCount >= MAX_NEW_TOPICS) continue
      newCount++
    }
    topics.push({ ...(id && { id }), scope, title, detail, evidence })
  }
  return { report: rec.report.trim(), topics }
}
```

- [ ] **Étape 4 : lancer les tests, vérifier qu'ils passent**

Run: `npm test -w @sangha/server -- elderParse.test.ts`
Expected: PASS.

- [ ] **Étape 5 : commit**

```bash
git add apps/server/src/elderParse.ts apps/server/test/elderParse.test.ts
git commit -m "Ananda : validation de la réponse du modèle (ids inconnus, portées interdites, 5 sujets au plus)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tâche 7 [BACK] : `elder.ts` — orchestrateur (tick, appel du modèle, votes, discussion)

**Files:**
- Create: `apps/server/src/elder.ts`
- Test: `apps/server/test/elder.test.ts`

**Interfaces:**
- Consumes: `Store` (Tâche 2), `due`/`PendingSession` (Tâche 4), `buildContext` (Tâche 5), `parseElderResponse` (Tâche 6), `Providers` (`apps/server/src/providers.ts`, existant), `UserError` (`apps/server/src/session.ts`, existant).
- Produces: `class Elder` avec `start()`, `stop()`, `subscribe()`, `settings()`, `setSettings()`, `state()`, `runPass(kind, sessionId?)`, `voteTopic(id, vote)`, `doneTopic(id)`, `addFeedback(input)`, `ask(text)` ; `DEFAULT_ELDER_SETTINGS`, `nextVoteStatus`, `mergeElderSettings` — consommés par `index.ts` (Tâche 8).

- [ ] **Étape 1 : écrire les tests (ils échouent)**

Créer `apps/server/test/elder.test.ts` :

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { ModelChoice, SessionSummary } from '@sangha/shared'
import { DEFAULT_ELDER_SETTINGS, Elder, mergeElderSettings, nextVoteStatus } from '../src/elder'
import { Store, type SessionRow } from '../src/db'
import type { Providers } from '../src/providers'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }))

const resultMessage = (structured_output: unknown) => ({ type: 'result', subtype: 'success', structured_output })
const CHOICE: ModelChoice = { id: 'sonnet', label: 'Claude Sonnet', engine: 'claude', model: 'sonnet' }
const fakeProviders = { choice: vi.fn().mockResolvedValue(CHOICE), env: vi.fn().mockReturnValue({}) } as unknown as Providers
const noSessions = (): SessionSummary[] => []

const row = (id: string): SessionRow => ({ id, project: 'p', agent: 'lead', title: 't', createdAt: 1, claudeSessionId: null, branch: null, worktree: null, baseSha: null, archivedAt: null, lastSeenSeq: 0 })

beforeEach(() => {
  vi.mocked(query).mockClear()
  vi.mocked(fakeProviders.choice).mockClear()
})

describe('mergeElderSettings', () => {
  it('merges nested levels/weekly patches onto the current settings', () => {
    const next = mergeElderSettings(DEFAULT_ELDER_SETTINGS, { levels: { project: true }, weekly: { maxWeekUsedPct: 30 } })
    expect(next.levels).toEqual({ manual: true, sangha: true, project: true })
    expect(next.weekly).toEqual({ day: 4, at: '12:00', maxWeekUsedPct: 30 })
  })

  it('rejects a malformed time, an out-of-range weekly day or threshold, and a tiny context cap', () => {
    expect(() => mergeElderSettings(DEFAULT_ELDER_SETTINGS, { dailyAt: '8:00' })).toThrow()
    expect(() => mergeElderSettings(DEFAULT_ELDER_SETTINGS, { weekly: { day: 7 } })).toThrow()
    expect(() => mergeElderSettings(DEFAULT_ELDER_SETTINGS, { weekly: { maxWeekUsedPct: 150 } })).toThrow()
    expect(() => mergeElderSettings(DEFAULT_ELDER_SETTINGS, { maxInputChars: 10 })).toThrow()
  })
})

describe('nextVoteStatus', () => {
  it('cycles proposed -> accepted -> proposed on repeated 👍, and rejects on 👎', () => {
    expect(nextVoteStatus('proposed', 'up')).toBe('accepted')
    expect(nextVoteStatus('accepted', 'up')).toBe('proposed')
    expect(nextVoteStatus('proposed', 'down')).toBe('rejected')
    expect(nextVoteStatus('rejected', 'down')).toBe('proposed')
  })
})

describe('Elder.runPass', () => {
  it('writes a report and topics from a successful model answer, and marks feedback processed', async () => {
    const store = new Store(':memory:')
    store.createSession(row('a'))
    store.addFeedback({ id: 'f1', sessionId: 'a', eventSeq: null, rating: 'down', comment: 'trop verbeux', excerpt: 'x', createdAt: 1, processedAt: null })
    store.setSetting('elder', { ...DEFAULT_ELDER_SETTINGS, enabled: true })
    vi.mocked(query).mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield resultMessage({ report: 'Un sujet à retenir.', topics: [{ scope: 'manual', title: 'Trop verbeux', detail: 'Plusieurs retours le disent', evidence: ['f1'] }] })
      },
    } as never)
    const elder = new Elder(store, fakeProviders, noSessions, () => null)
    await elder.runPass('manual')
    const state = elder.state()
    expect(state.reports[0]!.text).toBe('Un sujet à retenir.')
    expect(state.topics).toHaveLength(1)
    expect(state.topics[0]!.status).toBe('proposed')
    expect(store.pendingFeedback()).toEqual([])
    expect(state.lastError).toBeNull()
  })

  it('marks nothing processed and records the error when the model answer is invalid', async () => {
    const store = new Store(':memory:')
    store.addFeedback({ id: 'f1', sessionId: 'a', eventSeq: null, rating: 'down', comment: 'x', excerpt: 'x', createdAt: 1, processedAt: null })
    store.setSetting('elder', { ...DEFAULT_ELDER_SETTINGS, enabled: true })
    vi.mocked(query).mockReturnValue({ [Symbol.asyncIterator]: async function* () { yield resultMessage({ nope: true }) } } as never)
    const elder = new Elder(store, fakeProviders, noSessions, () => null)
    await elder.runPass('manual')
    expect(store.pendingFeedback()).toHaveLength(1)
    expect(elder.state().lastError).toBeTruthy()
  })

  it('does not call the model when there is nothing new and the pass is not manual', async () => {
    const store = new Store(':memory:')
    store.setSetting('elder', { ...DEFAULT_ELDER_SETTINGS, enabled: true })
    const elder = new Elder(store, fakeProviders, noSessions, () => null)
    await elder.runPass('weekly')
    expect(query).not.toHaveBeenCalled()
  })

  it('refuses two passes at once (in-memory lock)', async () => {
    const store = new Store(':memory:')
    store.addFeedback({ id: 'f1', sessionId: 'a', eventSeq: null, rating: 'down', comment: 'x', excerpt: 'x', createdAt: 1, processedAt: null })
    store.setSetting('elder', { ...DEFAULT_ELDER_SETTINGS, enabled: true })
    let release!: () => void
    vi.mocked(query).mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        await new Promise<void>((r) => (release = r))
        yield resultMessage({ report: 'r', topics: [] })
      },
    } as never)
    const elder = new Elder(store, fakeProviders, noSessions, () => null)
    const first = elder.runPass('manual')
    const second = elder.runPass('manual')
    release()
    await Promise.all([first, second])
    expect(query).toHaveBeenCalledTimes(1)
  })
})

describe('Elder.voteTopic / doneTopic', () => {
  it('👍 accepts a proposed topic, 👍 again un-votes it back to proposed', () => {
    const store = new Store(':memory:')
    store.upsertElderTopic({ id: 't1', scope: 'sangha', title: 'x', detail: 'd', evidence: [], status: 'proposed', createdAt: 1, updatedAt: 1 })
    const elder = new Elder(store, fakeProviders, noSessions, () => null)
    expect(elder.voteTopic('t1', 'up').status).toBe('accepted')
    expect(elder.voteTopic('t1', 'up').status).toBe('proposed')
  })

  it('refuses to mark done a topic that is not accepted', () => {
    const store = new Store(':memory:')
    store.upsertElderTopic({ id: 't1', scope: 'sangha', title: 'x', detail: 'd', evidence: [], status: 'proposed', createdAt: 1, updatedAt: 1 })
    const elder = new Elder(store, fakeProviders, noSessions, () => null)
    expect(() => elder.doneTopic('t1')).toThrow()
  })

  it('marks an accepted topic done', () => {
    const store = new Store(':memory:')
    store.upsertElderTopic({ id: 't1', scope: 'sangha', title: 'x', detail: 'd', evidence: [], status: 'accepted', createdAt: 1, updatedAt: 1 })
    const elder = new Elder(store, fakeProviders, noSessions, () => null)
    expect(elder.doneTopic('t1').status).toBe('done')
  })
})

describe('Elder.addFeedback', () => {
  it('freezes an excerpt and stores it pending', () => {
    const store = new Store(':memory:')
    store.createSession(row('a'))
    store.append('a', { t: 'buddha.text', text: 'bonjour' })
    const elder = new Elder(store, fakeProviders, noSessions, () => null)
    const f = elder.addFeedback({ sessionId: 'a', rating: 'up' })
    expect(f.excerpt).toContain('bonjour')
    expect(store.pendingFeedback()).toHaveLength(1)
  })
})
```

- [ ] **Étape 2 : lancer les tests, vérifier qu'ils échouent**

Run: `npm test -w @sangha/server -- elder.test.ts`
Expected: FAIL — le module `../src/elder` n'existe pas.

- [ ] **Étape 3 : implémenter**

Créer `apps/server/src/elder.ts` :

```ts
import { randomUUID } from 'node:crypto'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { ElderReportKind, ElderSettings, ElderSettingsPatch, ElderState, ElderTopic, ElderTopicStatus, Feedback, GlobalEvent, Quota, SessionSummary } from '@sangha/shared'
import type { Store } from './db'
import type { Providers } from './providers'
import { buildContext } from './elderContext'
import { due, type PendingSession } from './elderSchedule'
import { parseElderResponse } from './elderParse'
import { UserError } from './session'

export const DEFAULT_ELDER_SETTINGS: ElderSettings = {
  enabled: false,
  model: 'sonnet',
  levels: { manual: true, sangha: true, project: false },
  projects: [],
  dailyAt: '08:00',
  weekly: { day: 4, at: '12:00', maxWeekUsedPct: 20 },
  maxInputChars: 24_000,
  lastRunAt: null,
}

const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    report: { type: 'string', description: '5 à 15 lignes, en français, pour l’utilisateur.' },
    topics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Un id de sujet existant, pour le mettre à jour.' },
          scope: { type: 'string', description: "'manual' | 'sangha' | 'project:<nom>'" },
          title: { type: 'string' },
          detail: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
        },
        required: ['scope', 'title', 'detail', 'evidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['report', 'topics'],
  additionalProperties: false,
}

const SYSTEM = `Tu es Ananda, un vieux moine bienveillant assis sous l'arbre de la Bodhi. Tu relis ce qui se passe dans
le monastère et proposes des suggestions d'amélioration concrètes ; tu ne modifies jamais rien toi-même.
Règles : regroupe les retours qui disent la même chose en un seul sujet ; ne reproposes jamais un sujet déjà
rejeté (listé dans la Mémoire ci-dessous) ; préfère mettre à jour un sujet existant (en reprenant son id) plutôt
qu'en créer un doublon ; au plus 5 sujets nouveaux par passage. Écris "report" en français simple et concret,
5 à 15 lignes.`

function isHHMM(s: unknown): s is string {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
}

/** Fusionne un changement partiel (niveaux/hebdomadaire inclus) et vérifie qu'il reste sain. */
export function mergeElderSettings(current: ElderSettings, patch: ElderSettingsPatch): ElderSettings {
  const next: ElderSettings = { ...current, ...patch, levels: { ...current.levels, ...patch.levels }, weekly: { ...current.weekly, ...patch.weekly } }
  if (typeof next.enabled !== 'boolean') throw new UserError('enabled doit être vrai ou faux')
  if (typeof next.model !== 'string' || !next.model.trim()) throw new UserError('un moteur est requis')
  if (!isHHMM(next.dailyAt)) throw new UserError('heure quotidienne invalide (HH:MM)')
  if (!Number.isInteger(next.weekly.day) || next.weekly.day < 0 || next.weekly.day > 6) throw new UserError('jour hebdomadaire invalide (0-6)')
  if (!isHHMM(next.weekly.at)) throw new UserError('heure hebdomadaire invalide (HH:MM)')
  if (!Number.isFinite(next.weekly.maxWeekUsedPct) || next.weekly.maxWeekUsedPct < 0 || next.weekly.maxWeekUsedPct > 100) throw new UserError('seuil hebdomadaire invalide (0-100)')
  if (!Number.isInteger(next.maxInputChars) || next.maxInputChars < 1000) throw new UserError('plafond de contexte trop petit (min 1000)')
  if (!Array.isArray(next.projects) || !next.projects.every((p) => typeof p === 'string')) throw new UserError('projets suivis invalides')
  if (typeof next.levels.manual !== 'boolean' || typeof next.levels.sangha !== 'boolean' || typeof next.levels.project !== 'boolean') throw new UserError('niveaux invalides')
  return next
}

/** 👍 accepte, 👎 rejette, recliquer le même vote revient à « proposed ». */
export function nextVoteStatus(current: ElderTopicStatus, vote: 'up' | 'down'): ElderTopicStatus {
  const target: ElderTopicStatus = vote === 'up' ? 'accepted' : 'rejected'
  return current === target ? 'proposed' : target
}

/** Best-effort, pour l'affichage seulement : la vraie décision reste celle de `due()`. */
export function nextRunAt(now: number, settings: ElderSettings): number | null {
  if (!settings.enabled) return null
  const d = new Date(now)
  if (settings.model.includes('::')) {
    const [h, m] = settings.dailyAt.split(':').map(Number)
    const next = new Date(d)
    next.setHours(h ?? 0, m ?? 0, 0, 0)
    if (next <= d) next.setDate(next.getDate() + 1)
    return next.getTime()
  }
  const [h, m] = settings.weekly.at.split(':').map(Number)
  const next = new Date(d)
  next.setDate(next.getDate() + ((settings.weekly.day - next.getDay() + 7) % 7))
  next.setHours(h ?? 0, m ?? 0, 0, 0)
  if (next <= d) next.setDate(next.getDate() + 7)
  return next.getTime()
}

export class Elder {
  private running = false
  private lastError: string | null = null
  private timer: NodeJS.Timeout | null = null
  private listeners = new Set<(ev: Extract<GlobalEvent, { kind: 'elder' }>) => void>()

  constructor(
    private store: Store,
    private providers: Providers,
    private sessions: () => SessionSummary[],
    private quota: () => Quota | null,
  ) {}

  start() {
    this.timer = setInterval(() => void this.tick(), 60_000)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
  }

  subscribe(fn: (ev: Extract<GlobalEvent, { kind: 'elder' }>) => void) {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  private broadcast() {
    const proposed = this.store.elderTopics().filter((t) => t.status === 'proposed').length
    for (const fn of this.listeners) fn({ kind: 'elder', proposed, running: this.running })
  }

  settings(): ElderSettings {
    return this.store.setting<ElderSettings>('elder') ?? DEFAULT_ELDER_SETTINGS
  }

  setSettings(patch: ElderSettingsPatch): ElderSettings {
    const next = mergeElderSettings(this.settings(), patch)
    this.store.setSetting('elder', next)
    this.broadcast()
    return next
  }

  state(): ElderState {
    const settings = this.settings()
    return { settings, nextRunAt: nextRunAt(Date.now(), settings), running: this.running, lastError: this.lastError, topics: this.store.elderTopics(), reports: this.store.elderReports(), chat: this.store.elderChat() }
  }

  private pendingSessions(now: number): PendingSession[] {
    const pending = this.store.pendingFeedback()
    const hasPending = new Set(pending.map((f) => f.sessionId))
    const live: PendingSession[] = this.sessions()
      .filter((s) => hasPending.has(s.id))
      .map((s) => ({ id: s.id, archived: false, idleMs: s.status === 'waiting' ? now - (this.store.lastEvent(s.id, 'busy')?.at ?? now) : 0, hasPendingFeedback: true }))
    const liveIds = new Set(live.map((p) => p.id))
    const archived: PendingSession[] = this.store
      .archivedSessions()
      .filter((r) => hasPending.has(r.id) && !liveIds.has(r.id))
      .map((r) => ({ id: r.id, archived: true, idleMs: 0, hasPendingFeedback: true }))
    return [...live, ...archived]
  }

  private async tick() {
    if (this.running) return
    const pass = due(Date.now(), this.settings(), this.quota(), this.pendingSessions(Date.now()))
    if (!pass) return
    if (pass.kind === 'skipped') return this.skip()
    await this.runPass(pass.kind, pass.kind === 'conversation' ? pass.sessionId : undefined)
  }

  private skip() {
    this.store.addElderReport({ id: randomUUID(), kind: 'skipped', text: 'Semaine sautée : quota du plan trop utilisé.', topicIds: [], costUsd: null, tokens: null, createdAt: Date.now() })
    this.setSettings({ lastRunAt: Date.now() })
    this.broadcast()
  }

  /** Un passage programmé ou manuel. `sessionId` : restreint le contexte à une session (fin de conversation). */
  async runPass(kind: ElderReportKind, sessionId?: string) {
    if (this.running) return
    this.running = true
    this.lastError = null
    this.broadcast()
    try {
      const settings = this.settings()
      const since = settings.lastRunAt ?? 0
      const ctx = buildContext(settings, since, this.store, sessionId)
      if (ctx.newItems === 0 && kind !== 'manual') return
      const choice = await this.providers.choice(settings.model)
      if (!choice) throw new Error(`modèle indisponible : ${settings.model}`)
      const env = this.providers.env(choice.engine, choice.model)
      const knownIds = new Set(this.store.elderTopics().map((t) => t.id))
      const raw = await this.callModel(choice.model ?? choice.id, env, ctx.text)
      const parsed = parseElderResponse(raw, knownIds, settings.levels, settings.projects)
      if (!parsed) throw new Error('réponse du modèle invalide')
      this.applyAnswer(kind, parsed)
      const pending = sessionId ? this.store.pendingFeedback().filter((f) => f.sessionId === sessionId) : this.store.pendingFeedback()
      this.store.markFeedbackProcessed(pending.map((f) => f.id), Date.now())
      this.store.setSetting('elder', { ...settings, lastRunAt: Date.now() })
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e)
      console.error('[elder]', this.lastError)
    } finally {
      this.running = false
      this.broadcast()
    }
  }

  private applyAnswer(kind: ElderReportKind, parsed: { report: string; topics: { id?: string; scope: string; title: string; detail: string; evidence: string[] }[] }) {
    const now = Date.now()
    const topicIds: string[] = []
    for (const t of parsed.topics) {
      const existing = t.id ? this.store.elderTopic(t.id) : null
      const id = existing?.id ?? randomUUID()
      const topic: ElderTopic = { id, scope: t.scope, title: t.title, detail: t.detail, evidence: t.evidence, status: existing?.status ?? 'proposed', createdAt: existing?.createdAt ?? now, updatedAt: now }
      this.store.upsertElderTopic(topic)
      topicIds.push(id)
    }
    this.store.addElderReport({ id: randomUUID(), kind, text: parsed.report, topicIds, costUsd: null, tokens: null, createdAt: now })
  }

  private async callModel(model: string, env: Record<string, string>, input: string): Promise<unknown> {
    const q = query({ prompt: input, options: { model, systemPrompt: SYSTEM, tools: [], settingSources: [], plugins: [], persistSession: false, maxTurns: 3, outputFormat: { type: 'json_schema', schema: ANSWER_SCHEMA }, env } })
    for await (const m of q) {
      if (m.type !== 'result') continue
      return m.subtype === 'success' ? m.structured_output : null
    }
    return null
  }

  voteTopic(id: string, vote: 'up' | 'down'): ElderTopic {
    const t = this.store.elderTopic(id)
    if (!t) throw new UserError('sujet inconnu')
    const updated: ElderTopic = { ...t, status: nextVoteStatus(t.status, vote), updatedAt: Date.now() }
    this.store.upsertElderTopic(updated)
    this.broadcast()
    return updated
  }

  doneTopic(id: string): ElderTopic {
    const t = this.store.elderTopic(id)
    if (!t) throw new UserError('sujet inconnu')
    if (t.status !== 'accepted') throw new UserError('seul un sujet accepté peut être marqué fait')
    const updated: ElderTopic = { ...t, status: 'done', updatedAt: Date.now() }
    this.store.upsertElderTopic(updated)
    this.broadcast()
    return updated
  }

  addFeedback(input: { sessionId: string; eventSeq?: number; rating?: 'up' | 'down'; comment?: string }): Feedback {
    const f: Feedback = {
      id: randomUUID(),
      sessionId: input.sessionId,
      eventSeq: input.eventSeq ?? null,
      rating: input.rating ?? null,
      comment: input.comment?.trim() || null,
      excerpt: this.store.excerptAround(input.sessionId, input.eventSeq ?? null),
      createdAt: Date.now(),
      processedAt: null,
    }
    this.store.addFeedback(f)
    this.broadcast()
    return f
  }

  /** Une question libre, hors programme : sujets ouverts, 3 derniers rapports, 20 derniers messages. */
  async ask(text: string): Promise<{ reply: string }> {
    const settings = this.settings()
    const choice = await this.providers.choice(settings.model)
    if (!choice) throw new UserError(`modèle indisponible : ${settings.model}`)
    const env = this.providers.env(choice.engine, choice.model)
    const topics = this.store.elderTopics().filter((t) => t.status !== 'rejected')
    const reports = this.store.elderReports(3)
    const history = this.store.elderChat(20)
    const input = [
      topics.length ? `Sujets :\n${topics.map((t) => `- [${t.status}] ${t.title} : ${t.detail}`).join('\n')}` : '',
      reports.length ? `Derniers rapports :\n${reports.map((r) => `- ${r.text}`).join('\n')}` : '',
      history.length ? history.map((h) => `${h.role === 'user' ? 'Toi' : 'Ananda'} : ${h.text}`).join('\n') : '',
      `Toi : ${text}`,
    ]
      .filter(Boolean)
      .join('\n\n')
    this.store.addElderChatMessage('user', text, Date.now())
    const q = query({ prompt: input, options: { model: choice.model ?? choice.id, systemPrompt: SYSTEM, tools: [], settingSources: [], plugins: [], persistSession: false, maxTurns: 3, env } })
    let reply = ''
    for await (const m of q) if (m.type === 'result' && m.subtype === 'success') reply = m.result
    this.store.addElderChatMessage('elder', reply, Date.now())
    this.broadcast()
    return { reply }
  }
}
```

- [ ] **Étape 4 : lancer les tests, vérifier qu'ils passent**

Run: `npm test -w @sangha/server -- elder.test.ts`
Expected: PASS.

- [ ] **Étape 5 : commit**

```bash
git add apps/server/src/elder.ts apps/server/test/elder.test.ts
git commit -m "Ananda : l'orchestrateur — tick minute, appel du modèle, votes, discussion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tâche 8 [BACK] : `index.ts` — routes et câblage dans le flux global

**Files:**
- Modify: `apps/server/src/index.ts`

**Interfaces:**
- Consumes: `Elder` (Tâche 7), `UserError` (existant).
- Produces: les 8 routes du contrat (Tâche 1), un nouvel événement `elder` diffusé par `/api/events`.

- [ ] **Étape 1 : instancier `Elder`**

Dans `apps/server/src/index.ts`, après la ligne 23 (`import { type CreateSession, Sessions, UserError } from './session'`), ajouter :

```ts
import { Elder } from './elder'
```

Après la ligne 49 (`host.start()`), ajouter :

```ts
const elder = new Elder(store, sessions.providers, () => sessions.summaries(), () => sessions.quota)
elder.start()
```

- [ ] **Étape 2 : routes**

Après la section `providers`/avant `app.get('/api/sessions', ...)` (vers la ligne 128), ajouter :

```ts
app.get('/api/elder', (c) => c.json(elder.state()))
app.put('/api/elder/settings', async (c) => c.json(elder.setSettings(await c.req.json())))
app.post('/api/elder/run', async (c) => {
  await elder.runPass('manual')
  return c.body(null, 202)
})
app.post('/api/elder/ask', async (c) => {
  const { text } = await c.req.json<{ text: string }>()
  if (!text?.trim()) throw new UserError('message vide')
  return c.json(await elder.ask(text.trim()))
})
app.post('/api/elder/topics/:id/vote', async (c) => {
  const { vote } = await c.req.json<{ vote: 'up' | 'down' }>()
  if (vote !== 'up' && vote !== 'down') throw new UserError('vote invalide')
  return c.json(elder.voteTopic(c.req.param('id'), vote))
})
app.post('/api/elder/topics/:id/done', (c) => c.json(elder.doneTopic(c.req.param('id'))))
app.post('/api/feedback', async (c) => {
  const body = await c.req.json<{ sessionId: string; eventSeq?: number; rating?: 'up' | 'down'; comment?: string }>()
  if (!body.sessionId) throw new UserError('session manquante')
  if (!body.rating && !body.comment?.trim()) throw new UserError('note ou commentaire requis')
  if (!store.getSession(body.sessionId)) throw new UserError('session inconnue')
  return c.json(elder.addFeedback(body), 201)
})
app.get('/api/sessions/:id/feedback', (c) => c.json(store.feedbackForSession(c.req.param('id'))))
```

- [ ] **Étape 3 : diffuser `elder` dans le flux global**

Dans `app.get('/api/events', ...)` (ligne 310), après la ligne qui souscrit à `host` (`const unsubscribeHost = host.subscribe(...)`), ajouter :

```ts
    const unsubscribeElder = elder.subscribe((ev) => {
      queue.push(ev)
      wake?.()
    })
```

Et dans `stream.onAbort(() => { unsubscribe(); unsubscribeHost(); wake?.() })`, ajouter `unsubscribeElder()`.

- [ ] **Étape 4 : vérifier le serveur démarre et compile**

Run: `npm run typecheck`
Expected: exit 0.

Run: `npm test -w @sangha/server`
Expected: PASS, toutes les suites (y compris celles des tâches précédentes) vertes.

- [ ] **Étape 5 : commit**

```bash
git add apps/server/src/index.ts
git commit -m "Ananda : ses routes (réglages, médite maintenant, discussion, votes, retours) et son événement global

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tâche 9 [FRONT] : `api.ts` + `store.ts` — client et état partagé

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/store.ts`

**Interfaces:**
- Consumes: le contrat d'API exact et les types (Tâche 1) — ne dépend d'aucune tâche `[BACK]` postérieure.
- Produces: `api.elder()`, `api.saveElderSettings()`, `api.runElderNow()`, `api.askElder()`, `api.voteElderTopic()`, `api.doneElderTopic()`, `api.sendFeedback()`, `api.sessionFeedback()` ; `ChatItem` porte `seq` ; `Dialog` gagne `{ kind: 'elder' }` ; `useApp().elderBadge` — consommés par les Tâches 10, 11, 12.

- [ ] **Étape 1 : `store.ts` — `seq` sur les messages, `Dialog`, `elderBadge`**

Dans `apps/web/src/store.ts`, remplacer les lignes 22-24 :

```ts
export type ChatItem =
  | { kind: 'user'; text: string; at: number }
  | { kind: 'buddha'; text: string; at: number }
```

par :

```ts
export type ChatItem =
  | { kind: 'user'; text: string; at: number; seq: number }
  | { kind: 'buddha'; text: string; at: number; seq: number }
```

Remplacer les lignes 72-77 :

```ts
    case 'user.message':
      return { ...s, chat: [...s.chat, { kind: 'user', text: ev.text, at }] }
    case 'buddha.delta':
      return { ...s, draft: s.draft + ev.text }
    case 'buddha.text':
      return { ...s, draft: '', chat: [...s.chat, { kind: 'buddha', text: ev.text, at }] }
```

par :

```ts
    case 'user.message':
      return { ...s, chat: [...s.chat, { kind: 'user', text: ev.text, at, seq }] }
    case 'buddha.delta':
      return { ...s, draft: s.draft + ev.text }
    case 'buddha.text':
      return { ...s, draft: '', chat: [...s.chat, { kind: 'buddha', text: ev.text, at, seq }] }
```

(`seq` est déjà déstructuré au paramètre de `reduce`, ligne 62.)

Dans le type `Dialog` (ligne 145-159), ajouter avant le `| null` final :

```ts
  | { kind: 'elder' }
```

Dans `AppState` (après `host: HostReport | null`, ligne 180), ajouter :

```ts
  /** Le nombre de sujets `proposed` d'Ananda et s'il médite en ce moment, mis à jour par l'événement global `elder`. */
  elderBadge: { proposed: number; running: boolean } | null
```

Dans l'état initial de `useApp` (après `host: null,`, ligne 288), ajouter :

```ts
  elderBadge: null,
```

- [ ] **Étape 2 : `api.ts` — client et événement global**

Dans `apps/web/src/api.ts`, étendre l'import de types (ligne 1) avec `ElderState, ElderSettingsPatch, ElderTopic, Feedback`.

Dans l'objet `api` (après `setLibraryMcp: ...`, fin de l'objet), ajouter :

```ts
  /** Réglages, état, sujets, rapports et discussion d'Ananda. */
  elder: () => json<ElderState>('/api/elder'),
  saveElderSettings: (patch: ElderSettingsPatch) => json<ElderState['settings']>('/api/elder/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  runElderNow: () => json<void>('/api/elder/run', post()),
  askElder: (text: string) => json<{ reply: string }>('/api/elder/ask', post({ text })),
  voteElderTopic: (id: string, vote: 'up' | 'down') => json<ElderTopic>(`/api/elder/topics/${id}/vote`, post({ vote })),
  doneElderTopic: (id: string) => json<ElderTopic>(`/api/elder/topics/${id}/done`, post()),
  sendFeedback: (b: { sessionId: string; eventSeq?: number; rating?: 'up' | 'down'; comment?: string }) => json<Feedback>('/api/feedback', post(b)),
  sessionFeedback: (id: string) => json<Feedback[]>(`/api/sessions/${id}/feedback`),
```

Dans `openMonastery`'s `switch (ev.kind)` (après `case 'host': set({ host: ev.host }); break`), ajouter :

```ts
      case 'elder':
        set({ elderBadge: { proposed: ev.proposed, running: ev.running } })
        break
```

- [ ] **Étape 3 : vérifier la compilation**

Run: `tsc -p apps/web --noEmit`
Expected: exit 0.

Run: `npm run build -w @sangha/web`
Expected: exit 0, le build Vite réussit.

- [ ] **Étape 4 : commit**

```bash
git add apps/web/src/api.ts apps/web/src/store.ts
git commit -m "Ananda : le client web parle ses routes, le store porte son badge et le seq de chaque message

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tâche 10 [FRONT] : commenter pour Ananda — `Chat.tsx` et en-tête de conversation

**Files:**
- Modify: `apps/web/src/chat/Chat.tsx`
- Modify: `apps/web/src/SessionView.tsx`

**Interfaces:**
- Consumes: `api.sendFeedback`, `api.sessionFeedback` (Tâche 9), `ChatItem.seq` (Tâche 9).
- Produces: un bouton « commenter pour Ananda » par message, une marque sur un message déjà commenté, un contrôle 👍/👎 + commentaire dans l'en-tête pour la conversation entière.

- [ ] **Étape 1 : `Chat.tsx` — composant de commentaire**

Dans `apps/web/src/chat/Chat.tsx`, après `QuoteBlock` (après la ligne 63), ajouter :

```tsx
/** Un petit formulaire (👍/👎 + commentaire facultatif) pour un message précis, ou la conversation entière si `eventSeq` est absent. */
function FeedbackControl({ sessionId, eventSeq, commented, onDone }: { sessionId: string; eventSeq?: number; commented: boolean; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [rating, setRating] = useState<'up' | 'down' | null>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!open)
    return (
      <button
        type="button"
        className={`msg-feedback${commented ? ' commented' : ''}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen(true)}
        aria-label="Commenter pour Ananda"
        title={commented ? 'Déjà commenté pour Ananda' : 'Commenter pour Ananda'}
      >
        🪷
      </button>
    )
  const submit = async () => {
    if (!rating && !comment.trim()) return
    setBusy(true)
    setError(null)
    try {
      await api.sendFeedback({ sessionId, eventSeq, rating: rating ?? undefined, comment: comment.trim() || undefined })
      setOpen(false)
      setRating(null)
      setComment('')
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="msg-feedback-form" role="group" aria-label="Commenter pour Ananda">
      <button type="button" className={`icon-btn${rating === 'up' ? ' active' : ''}`} onClick={() => setRating((r) => (r === 'up' ? null : 'up'))} aria-label="Pouce levé" title="👍">
        👍
      </button>
      <button type="button" className={`icon-btn${rating === 'down' ? ' active' : ''}`} onClick={() => setRating((r) => (r === 'down' ? null : 'down'))} aria-label="Pouce baissé" title="👎">
        👎
      </button>
      <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Un mot pour Ananda (facultatif)…" />
      <button type="button" className="text-link" disabled={busy || (!rating && !comment.trim())} onClick={() => void submit()}>
        Envoyer
      </button>
      <button type="button" className="text-link" onClick={() => setOpen(false)}>
        Annuler
      </button>
      {error && <p className="form-error">{error}</p>}
    </div>
  )
}
```

- [ ] **Étape 2 : suivre les messages déjà commentés et brancher le bouton**

Dans `export function Chat(...)`, après la déclaration de `queued` (ligne 189), ajouter :

```ts
  const [commented, setCommented] = useState<Set<number>>(new Set())
  useEffect(() => {
    if (!sessionId) return void setCommented(new Set())
    api.sessionFeedback(sessionId).then(
      (list) => setCommented(new Set(list.map((f) => f.eventSeq).filter((s): s is number => s != null))),
      () => setCommented(new Set()),
    )
  }, [sessionId])
```

Dans `render(item, i)`, cas `'user'` (ligne 406-413) remplacer :

```tsx
      case 'user':
        return (
          <div key={i} data-i={i} className="msg msg-user">
            <ReplyButton onReply={(el) => replyRef.current('toi', item.text, el)} />
            <Time at={item.at} />
            <Said text={item.text} onQuote={(q) => goRef.current(q)} />
          </div>
        )
```

par :

```tsx
      case 'user':
        return (
          <div key={i} data-i={i} className="msg msg-user">
            <ReplyButton onReply={(el) => replyRef.current('toi', item.text, el)} />
            {sessionId && <FeedbackControl sessionId={sessionId} eventSeq={item.seq} commented={commented.has(item.seq)} onDone={() => setCommented((s) => new Set(s).add(item.seq))} />}
            <Time at={item.at} />
            <Said text={item.text} onQuote={(q) => goRef.current(q)} />
          </div>
        )
```

Cas `'buddha'` (lignes 414-423), ajouter la même ligne `{sessionId && <FeedbackControl .../>}` juste après `<ReplyButton .../>`.

- [ ] **Étape 3 : `SessionView.tsx` — 👍/👎 pour la conversation entière**

Dans `apps/web/src/SessionView.tsx`, importer `FeedbackControl` depuis `./chat/Chat` (l'exporter dans `Chat.tsx` : ajouter `export` devant `function FeedbackControl`). Dans l'en-tête `sv-head` (après le bloc `sv-note`, ligne ~698), ajouter, pour un prêtre non-Bouddha :

```tsx
            {!isBuddha && <FeedbackControl sessionId={s.id} commented={false} onDone={() => {}} />}
```

- [ ] **Étape 4 : vérifier la compilation**

Run: `tsc -p apps/web --noEmit`
Expected: exit 0.

Run: `npm run build -w @sangha/web`
Expected: exit 0.

- [ ] **Étape 5 : commit**

```bash
git add apps/web/src/chat/Chat.tsx apps/web/src/SessionView.tsx
git commit -m "Ananda : un bouton « commenter » sur chaque message, et un pouce pour toute la conversation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tâche 11 [FRONT] : scène — Ananda sous l'arbre de la Bodhi, barbe en ressorts

**Files:**
- Create: `apps/web/src/scene/elderBeard.ts`
- Create: `apps/web/src/scene/Elder.tsx`
- Modify: `apps/web/src/scene/Monastery.tsx`

**Interfaces:**
- Consumes: `useApp().elderBadge` (Tâche 9).
- Produces: `initBeard`, `step`, `isDragGesture` (purs, `elderBeard.ts`) ; `elderPosition`, `<Elder .../>` (`Elder.tsx`) ; `Elder` placé dans `Monastery.tsx`, ouvrant `{ kind: 'elder' }`.

- [ ] **Étape 1 : physique pure de la barbe**

Créer `apps/web/src/scene/elderBeard.ts` :

```ts
/** Un point de la barbe : sa position et sa précédente (intégration de Verlet, sans vitesse explicite). */
export type BeardPoint = { x: number; y: number; px: number; py: number }

export const BEARD_LINKS = 24
export const BEARD_LINK_LEN = 6

/** Une très longue barbe, enroulée en spirale serrée au repos, ancrée en (0,0) (son menton). */
export function initBeard(anchor: { x: number; y: number }, links = BEARD_LINKS, len = BEARD_LINK_LEN): BeardPoint[] {
  const pts: BeardPoint[] = []
  for (let i = 0; i < links; i++) {
    const angle = i * 0.9
    const r = len * (0.3 + i * 0.15)
    const x = anchor.x + Math.cos(angle) * r * 0.2
    const y = anchor.y + i * len * 0.4 + Math.sin(angle) * 2
    pts.push({ x, y, px: x, py: y })
  }
  return pts
}

/**
 * Un pas de physique : intégration de Verlet (vitesse implicite, légèrement amortie), gravité, le premier
 * point toujours ancré au menton, le dernier suivant le doigt pendant qu'on le tire, et une contrainte de
 * distance entre maillons consécutifs relaxée en plusieurs passes pour que la chaîne garde sa longueur.
 */
export function step(points: BeardPoint[], dt: number, anchor: { x: number; y: number }, drag: { x: number; y: number } | null, len = BEARD_LINK_LEN, gravity = 60): BeardPoint[] {
  const next = points.map((p) => {
    const vx = (p.x - p.px) * 0.98
    const vy = (p.y - p.py) * 0.98
    return { x: p.x + vx, y: p.y + vy + gravity * dt * dt, px: p.x, py: p.y }
  })
  next[0] = { ...anchor, px: anchor.x, py: anchor.y }
  if (drag) next[next.length - 1] = { x: drag.x, y: drag.y, px: drag.x, py: drag.y }
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 0; i < next.length - 1; i++) {
      const a = next[i]!
      const b = next[i + 1]!
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.hypot(dx, dy) || 0.0001
      const diff = (dist - len) / dist
      const moveA = i === 0 ? 0 : 0.5
      const moveB = drag && i + 1 === next.length - 1 ? 0 : 0.5
      a.x += dx * diff * moveA
      a.y += dy * diff * moveA
      b.x -= dx * diff * moveB
      b.y -= dy * diff * moveB
    }
  }
  return next
}

/** Un chemin SVG lissé passant par chaque maillon de la barbe. */
export function beardPath(points: BeardPoint[]): string {
  if (!points.length) return ''
  const [first, ...rest] = points
  return rest.reduce((d, p, i) => {
    const prev = points[i]!
    const mx = (prev.x + p.x) / 2
    const my = (prev.y + p.y) / 2
    return `${d} Q ${prev.x} ${prev.y} ${mx} ${my}`
  }, `M ${first!.x} ${first!.y}`)
}

/** Un glisser de plus de 4 px n'ouvre pas le panneau : c'est une vraie tentative de tirer la barbe. */
export const isDragGesture = (dx: number, dy: number) => Math.hypot(dx, dy) > 4
```

Cette logique n'a pas de suite de tests dédiée (`apps/web` n'a pas vitest) ; elle est vérifiée par le typecheck et le build de l'Étape 4, et visuellement en lançant `npm run dev`.

- [ ] **Étape 2 : le composant de scène**

Créer `apps/web/src/scene/Elder.tsx` :

```tsx
import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { BEARD_LINKS, beardPath, initBeard, isDragGesture, step, type BeardPoint } from './elderBeard'

/** Où Ananda s'assoit : un coin resté libre de la scène du monastère. */
export function elderPosition(width: number, mobile: boolean, height: number): { x: number; y: number } {
  return mobile ? { x: 70, y: height - 90 } : { x: 120, y: height - 140 }
}

const ANCHOR = { x: 0, y: -18 } // son menton, relatif à son centre

export function Elder({ x, y, proposed, running, onOpen }: { x: number; y: number; proposed: number; running: boolean; onOpen: () => void }) {
  const reducedMotion = useReducedMotion()
  const [points, setPoints] = useState<BeardPoint[]>(() => initBeard(ANCHOR))
  const dragRef = useRef<{ x: number; y: number } | null>(null)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const draggedRef = useRef(false)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    let last = performance.now()
    const loop = (now: number) => {
      const dt = Math.min(0.032, (now - last) / 1000)
      last = now
      setPoints((p) => step(p, dt, ANCHOR, dragRef.current))
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => void (rafRef.current && cancelAnimationFrame(rafRef.current))
  }, [])

  const clientToLocal = (svg: SVGSVGElement | null, clientX: number, clientY: number) => {
    const ctm = svg?.getScreenCTM()
    if (!svg || !ctm) return { x: clientX, y: clientY }
    const pt = svg.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    const p = pt.matrixTransform(ctm.inverse())
    return { x: p.x - x, y: p.y - y }
  }

  const onTipDown = (e: React.PointerEvent<SVGCircleElement>) => {
    const svg = e.currentTarget.ownerSVGElement
    const local = clientToLocal(svg, e.clientX, e.clientY)
    startRef.current = local
    draggedRef.current = false
    dragRef.current = local
    const onMove = (ev: PointerEvent) => {
      const p = clientToLocal(svg, ev.clientX, ev.clientY)
      if (startRef.current && isDragGesture(p.x - startRef.current.x, p.y - startRef.current.y)) draggedRef.current = true
      dragRef.current = p
    }
    const onUp = () => {
      dragRef.current = null
      if (!draggedRef.current) onOpen() // un tap sur la pointe, sans glisser : ouvre le panneau comme un clic
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const tip = points[points.length - 1]!

  return (
    <g transform={`translate(${x} ${y})`} className="elder clickable" role="button" tabIndex={0} aria-label="Ananda : ses suggestions" onClick={onOpen} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen()}>
      <title>Ananda, sous l'arbre de la Bodhi</title>
      <defs>
        <radialGradient id="elderGlow">
          <stop offset="0" stopColor="#d7e8c8" stopOpacity="0.9" />
          <stop offset="1" stopColor="#d7e8c8" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* l'arbre de la Bodhi : un tronc et des feuilles en cœur */}
      <path d="M-4 -70 Q-2 -40 0 -10" fill="none" stroke="#6b4a2a" strokeWidth="6" strokeLinecap="round" />
      {[
        [-34, -92], [-14, -104], [10, -102], [30, -88], [-22, -78], [4, -82], [22, -70], [-6, -66],
      ].map(([lx, ly], i) => (
        <path key={i} d={`M${lx} ${ly} Q${lx! - 6} ${ly! - 10} ${lx!} ${ly! - 16} Q${lx! + 6} ${ly! - 10} ${lx!} ${ly}`} fill="#7fae5c" opacity="0.9" />
      ))}

      {/* lueur douce pendant un passage */}
      {running && (
        <motion.circle r={60} fill="url(#elderGlow)" animate={{ opacity: [0.4, 0.8, 0.4], scale: [1, 1.08, 1] }} transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }} />
      )}

      {/* le vieux sage, assis */}
      <motion.g
        animate={!reducedMotion && !dragRef.current ? { rotate: [-1, 1, -1] } : { rotate: 0 }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
        style={{ originX: '50%', originY: '100%' }}
      >
        <ellipse cy="10" rx="30" ry="14" fill="#8a6a46" />
        <path d="M-20 -30 Q0 -40 20 -30 L16 4 Q0 10 -16 4 Z" fill="#c7a46a" />
        <circle cy="-40" r="14" fill="#e8c79a" />
        {/* la barbe : la chaîne de points, en spirale au repos */}
        <path d={beardPath(points)} fill="none" stroke="#e9e4d8" strokeWidth="3.5" strokeLinecap="round" />
        <circle cx={tip.x} cy={tip.y} r={9} fill="transparent" onPointerDown={onTipDown} style={{ cursor: 'grab', touchAction: 'none' }} />
      </motion.g>

      {proposed > 0 && (
        <g transform="translate(24 -56)">
          <circle r="11" fill="#d94f4f" />
          <text y="4" textAnchor="middle" className="elder-badge-text">{proposed}</text>
        </g>
      )}
      <text y="38" textAnchor="middle" className="scene-name">Ananda</text>
    </g>
  )
}
```

- [ ] **Étape 3 : câbler `Elder` dans `Monastery.tsx`**

Dans `apps/web/src/scene/Monastery.tsx`, ajouter l'import (ligne 11, après l'import de `Moon`) :

```ts
import { Elder, elderPosition } from './Elder'
```

Dans `export function Monastery()`, ajouter `elderBadge` à la déstructuration de `useApp()` (ligne 204) :

```ts
  const { sessions, projects, profiles, selectedId, view, set, moonArrivals, closing, closingAck, elderBadge } = useApp()
```

Après le rendu de `<Moon .../>` (ligne 546), ajouter :

```tsx
      {(() => {
        const pos = elderPosition(width, mobile, effectiveHeight)
        return <Elder x={pos.x} y={pos.y} proposed={elderBadge?.proposed ?? 0} running={elderBadge?.running ?? false} onOpen={() => set({ dialog: { kind: 'elder' } })} />
      })()}
```

- [ ] **Étape 4 : vérifier la compilation et le build**

Run: `tsc -p apps/web --noEmit`
Expected: exit 0.

Run: `npm run build -w @sangha/web`
Expected: exit 0.

- [ ] **Étape 5 : commit**

```bash
git add apps/web/src/scene/elderBeard.ts apps/web/src/scene/Elder.tsx apps/web/src/scene/Monastery.tsx
git commit -m "Ananda prend place dans la scène, sous l'arbre de la Bodhi, sa barbe enroulée en ressorts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tâche 12 [FRONT] : panneau d'Ananda — sujets, rapports, discussion, réglages

**Files:**
- Modify: `apps/web/src/Dialogs.tsx`

**Interfaces:**
- Consumes: `api.elder`, `api.saveElderSettings`, `api.runElderNow`, `api.askElder`, `api.voteElderTopic`, `api.doneElderTopic` (Tâche 9) ; `Dialog` `{ kind: 'elder' }` (Tâche 9).
- Produces: `ElderDialog`, branché dans `Dialogs()`.

- [ ] **Étape 1 : le composant**

Dans `apps/web/src/Dialogs.tsx`, ajouter l'import de types en tête de fichier (`ElderState`, `ElderTopic`, `ElderTopicStatus`), puis, avant `export function Dialogs()` (ligne 1099), ajouter :

```tsx
function ElderDialog({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<ElderState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'topics' | 'reports' | 'chat' | 'settings'>('topics')
  const [statusFilter, setStatusFilter] = useState<ElderTopicStatus | 'all'>('all')
  const [chatText, setChatText] = useState('')
  const [chatBusy, setChatBusy] = useState(false)

  const load = () => api.elder().then(setState, (e: unknown) => setError(message(e)))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void load(), [])

  const vote = async (id: string, v: 'up' | 'down') => {
    try {
      await api.voteElderTopic(id, v)
      await load()
    } catch (e) {
      setError(message(e))
    }
  }
  const markDone = async (id: string) => {
    try {
      await api.doneElderTopic(id)
      await load()
    } catch (e) {
      setError(message(e))
    }
  }
  const meditateNow = async () => {
    try {
      await api.runElderNow()
      await load()
    } catch (e) {
      setError(message(e))
    }
  }
  const sendChat = async () => {
    const text = chatText.trim()
    if (!text) return
    setChatBusy(true)
    try {
      await api.askElder(text)
      setChatText('')
      await load()
    } catch (e) {
      setError(message(e))
    } finally {
      setChatBusy(false)
    }
  }
  const saveSettings = async (patch: Parameters<typeof api.saveElderSettings>[0]) => {
    try {
      await api.saveElderSettings(patch)
      await load()
    } catch (e) {
      setError(message(e))
    }
  }

  if (!state) return <Modal onClose={onClose} title="Ananda">{error ? <p className="form-error">{error}</p> : <p>Chargement…</p>}</Modal>

  const byScope = (topics: ElderTopic[]) => {
    const groups = new Map<string, ElderTopic[]>()
    for (const t of topics) groups.set(t.scope, [...(groups.get(t.scope) ?? []), t])
    return [...groups.entries()]
  }
  const topics = state.topics.filter((t) => statusFilter === 'all' || t.status === statusFilter)

  return (
    <Modal onClose={onClose} title="Ananda, le vieux sage">
      <div className="elder-dialog">
        <nav className="elder-tabs" role="tablist">
          {(['topics', 'reports', 'chat', 'settings'] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
              {{ topics: 'Sujets', reports: 'Rapports', chat: 'Discussion', settings: 'Réglages' }[k]}
            </button>
          ))}
        </nav>

        <div className="elder-status">
          {state.running ? <p>Médite en ce moment…</p> : <p>Prochain passage : {state.nextRunAt ? new Date(state.nextRunAt).toLocaleString('fr-FR') : 'désactivé'}</p>}
          {state.lastError && <p className="form-error">Dernière erreur : {state.lastError}</p>}
          <button type="button" className="btn btn-ghost" disabled={state.running} onClick={() => void meditateNow()}>
            Médite maintenant
          </button>
        </div>

        {error && <p className="form-error">{error}</p>}

        {tab === 'topics' && (
          <div className="elder-topics">
            <div className="elder-filters">
              {(['all', 'proposed', 'accepted', 'rejected', 'done'] as const).map((f) => (
                <button key={f} type="button" className={statusFilter === f ? 'active' : ''} onClick={() => setStatusFilter(f)}>
                  {f === 'all' ? 'Tous' : f}
                </button>
              ))}
            </div>
            {byScope(topics).map(([scope, list]) => (
              <section key={scope} className="elder-scope">
                <h4>{scope}</h4>
                <ul>
                  {list.map((t) => (
                    <li key={t.id} className="elder-topic">
                      <b>{t.title}</b> <span className="muted small">({t.status})</span>
                      <p>{t.detail}</p>
                      <div className="elder-topic-actions">
                        <button type="button" className={`icon-btn${t.status === 'accepted' ? ' active' : ''}`} onClick={() => void vote(t.id, 'up')} aria-label="Approuver">👍</button>
                        <button type="button" className={`icon-btn${t.status === 'rejected' ? ' active' : ''}`} onClick={() => void vote(t.id, 'down')} aria-label="Rejeter">👎</button>
                        {t.status === 'accepted' && (
                          <button type="button" className="text-link" onClick={() => void markDone(t.id)}>
                            Marquer fait
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {tab === 'reports' && (
          <ul className="elder-reports">
            {state.reports.map((r) => (
              <li key={r.id}>
                <time>{new Date(r.createdAt).toLocaleString('fr-FR')}</time> <span className="muted small">({r.kind})</span>
                <p>{r.text}</p>
              </li>
            ))}
          </ul>
        )}

        {tab === 'chat' && (
          <div className="elder-chat">
            <ul>
              {state.chat.map((h) => (
                <li key={h.id} className={h.role === 'user' ? 'msg-user' : 'msg-buddha'}>
                  {h.text}
                </li>
              ))}
            </ul>
            <form onSubmit={(e) => (e.preventDefault(), void sendChat())}>
              <input value={chatText} onChange={(e) => setChatText(e.target.value)} placeholder="Une question pour Ananda…" disabled={chatBusy} />
              <button type="submit" className="btn btn-primary" disabled={chatBusy || !chatText.trim()}>
                Envoyer
              </button>
            </form>
          </div>
        )}

        {tab === 'settings' && (
          <div className="elder-settings">
            <label>
              <input type="checkbox" checked={state.settings.enabled} onChange={(e) => void saveSettings({ enabled: e.target.checked })} /> Activé
            </label>
            <label>
              Moteur
              <input value={state.settings.model} onChange={(e) => void saveSettings({ model: e.target.value })} placeholder="sonnet, ou provider::model" />
            </label>
            {(['manual', 'sangha', 'project'] as const).map((lvl) => (
              <label key={lvl}>
                <input type="checkbox" checked={state.settings.levels[lvl]} onChange={(e) => void saveSettings({ levels: { [lvl]: e.target.checked } })} /> {lvl}
              </label>
            ))}
            <label>
              Projets suivis
              <input value={state.settings.projects.join(', ')} onChange={(e) => void saveSettings({ projects: e.target.value.split(',').map((p) => p.trim()).filter(Boolean) })} />
            </label>
            <label>
              Heure quotidienne (fournisseur)
              <input value={state.settings.dailyAt} onChange={(e) => void saveSettings({ dailyAt: e.target.value })} />
            </label>
            <label>
              Seuil hebdomadaire (% max de quota utilisé)
              <input type="number" value={state.settings.weekly.maxWeekUsedPct} onChange={(e) => void saveSettings({ weekly: { maxWeekUsedPct: Number(e.target.value) } })} />
            </label>
            <label>
              Plafond du contexte
              <input type="number" value={state.settings.maxInputChars} onChange={(e) => void saveSettings({ maxInputChars: Number(e.target.value) })} />
            </label>
          </div>
        )}
      </div>
    </Modal>
  )
}
```

- [ ] **Étape 2 : brancher la route du dialogue**

Dans `export function Dialogs()`, après `if (dialog.kind === 'host') return <HostDialog onClose={close} />` (ligne 1115), ajouter :

```tsx
  if (dialog.kind === 'elder') return <ElderDialog onClose={close} />
```

(`Modal` et `message` sont déjà utilisés ailleurs dans ce fichier pour d'autres dialogues — s'assurer que leurs signatures correspondent à celles déjà en place ; sinon, suivre le patron exact de `HostDialog` ou `Nirvana` pour l'enveloppe modale et le helper d'erreur.)

- [ ] **Étape 3 : vérifier la compilation et le build**

Run: `tsc -p apps/web --noEmit`
Expected: exit 0.

Run: `npm run build -w @sangha/web`
Expected: exit 0.

- [ ] **Étape 4 : commit**

```bash
git add apps/web/src/Dialogs.tsx
git commit -m "Ananda : son panneau — sujets groupés par portée, rapports, discussion, réglages, médite maintenant

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Risques et points d'attention

- **`toolUseNames` dans `Normalizer` (Tâche 3) grossit sans jamais être purgée** pour les outils réussis (seuls les échecs sont consommés) : risque mineur de mémoire sur une très longue session, du même ordre que les cartes `monkByTask`/`taskByMonk` déjà présentes dans la classe — acceptable, à surveiller si un profilage futur le signale.
- **`elderSanghaStats` (Tâche 2) scanne toute la table `events` filtrée par `at >= since`** sans index dédié sur `at` : correct pour le volume actuel de Sangha (un seul utilisateur, quelques sessions), à revoir si `events` grossit beaucoup.
- **Le composant `Elder.tsx` (Tâche 11) n'a pas de test automatisé** (`apps/web` n'a pas vitest) : sa physique (`elderBeard.ts`) et son geste (`isDragGesture`) sont vérifiés par construction/typecheck ; une vérification visuelle manuelle (`npm run dev`) reste nécessaire avant de considérer la Tâche 11 terminée.
- **Positionnement exact d'Ananda dans la scène** (`elderPosition`) : les coordonnées proposées sont un point de départ raisonnable (coin libre, loin des pavillons) ; l'agencement précis (chevauchement avec la lune, un pavillon ou le burner) se règle visuellement, pas par un test.
- **`PUT /api/elder/settings` accepte un `ElderSettingsPatch`** dont les sous-objets (`levels`, `weekly`) peuvent être partiels : `mergeElderSettings` les fusionne clé par clé avant validation — un appelant qui enverrait un `weekly` complet fonctionne tout aussi bien (fusion idempotente).

## Self-review notes (author)

- Couverture de la spec : Rythme → Tâche 4 (`due`) ; Données/SQLite → Tâche 2 ; Serveur/Déclenchement+Verrou → Tâche 7 (`tick`, `this.running`) ; Assemblage du contexte → Tâche 5 ; Appel + Validation → Tâches 6-7 ; Discussion → Tâche 7 (`ask`) ; Routes → Tâche 8 ; Diffusion GlobalEvent → Tâches 1, 8, 9 ; Interface web (Conversation, Scène, Barbe, Panneau) → Tâches 10, 11, 12 ; Tests listés dans la spec → Tâches 2 à 7 (chaque suite nommée y correspond un par un).
- Pas de placeholder : chaque tâche contient le code réel (implémentation et tests), aucune dépendance externe nouvelle.
- Cohérence des signatures vérifiée : `due(now, settings, quota, pending)`, `buildContext(settings, since, store, sessionId?)`, `parseElderResponse(raw, knownTopicIds, levels, projects)`, `Elder(store, providers, sessions, quota)` utilisés à l'identique entre la tâche qui les définit et celles qui les consomment.
- Review Focus : les 5 lignes ci-dessus pointent chacune vers le test qui les couvre, dans la tâche qui possède le code concerné.
## Amendements du lead (prioritaires sur le texte des tâches)

1. **`lastRunAt` n'avance pas sur un passage « fin de conversation »** : seuls `daily`, `weekly`, `manual` et `skipped` l'avancent, sinon le rapport quotidien suivant perdrait les résumés de projet et les signaux Sangha de la période. Test dans `elder.test.ts`.
2. **`POST /api/elder/run` ne bloque pas** : il lance `void elder.runPass('manual')` et répond `202` tout de suite ; le panneau suit l'état par l'événement global `elder`.
3. **Ananda est activé par défaut** (`DEFAULT_ELDER_SETTINGS.enabled = true`) : le passage hebdomadaire est déjà protégé par la garde de quota.
4. **Environnement du fournisseur** : vérifier l'API réelle de `Providers`/`providerEnv` dans `providers.ts` et `session.ts` (la méthode `providers.env(...)` du plan n'existe peut-être pas) ; pour Claude, retirer `ANTHROPIC_API_KEY` de l'env comme `recap.ts`. Renseigner `costUsd`/`tokens` du rapport depuis le message `result` (`total_cost_usd`, `usage`).
5. **La barbe revient en spirale** : au repos, chaque point est attiré par un ressort vers sa position de repos sur une spirale enroulée (relative au menton), en plus de la contrainte de distance ; pendant le glisser, la pointe suit le doigt. La boucle `requestAnimationFrame` ne tourne que pendant un glisser et jusqu'à ce que la barbe soit revenue au repos (pas de rendu React à 60 fps en permanence). `prefers-reduced-motion` : pas de balancement au repos.
6. **Réglages en français et en vrais contrôles** : moteur choisi dans la même liste de modèles que celle des prêtres (`ModelChoice` existants), niveaux libellés « Retours manuels », « Sangha », « Projets », projets suivis en cases à cocher depuis la liste des projets, jour + heure de l'hebdomadaire, statuts des filtres en français (Proposés, Acceptés, Rejetés, Faits).
7. **Placement dans la scène** : vérifier visuellement qu'Ananda ne chevauche ni la lune, ni l'étang aux lotus, ni un pavillon, sur bureau et sur téléphone.
