# Ananda, le vieux sage — design

Date : 2026-11-06 · Statut : à relire

## But

Un vieux moine, **Ananda** (le cousin de Bouddha, celui qui se souvenait de tous ses enseignements), assis sous
un arbre de la Bodhi, relit ce qui se passe dans le monastère et en tire une liste de **suggestions
d'amélioration**. Il ne modifie jamais rien lui-même : il propose, l'utilisateur tranche en un clic.

Ses entrées, par ordre d'importance :

1. **Retours manuels** : commentaires et 👍/👎 posés par l'utilisateur sur une conversation entière ou sur un
   message précis.
2. **Sangha** : signaux récurrents dans le fonctionnement de Sangha (un MCP qui échoue souvent, des demandes qui
   reviennent, des renouvellements ou des sessions confiées à Bouddha en boucle, des erreurs).
3. **Projet** : les conversations des prêtres d'un projet suivi, pour suggérer des améliorations de ses outils
   (`CLAUDE.md`, `.claude/agents`, skills).

Contrainte forte : **consommer peu de tokens**. Le système d'inférence de Sangha est en cours d'évolution :
on fait **au plus simple** (appels uniques, sans outils) en attendant de meilleures run loops.

Hors périmètre (plus tard) : confier un sujet accepté à un prêtre (v2) ; brancher Ananda sur des agents et
workflows hors Sangha (v3, chaque monastère apporte ses outils, Sangha orchestre).

## Rythme

Le rythme dépend du moteur choisi dans ses réglages (un `ModelChoice`, comme pour un prêtre).

| Moteur | Rapport | Fin de conversation |
|---|---|---|
| Claude (abonnement) | **Hebdomadaire**, jeudi 12:00 | non |
| Fournisseur (ex. OVH AI Endpoint, modèle flash) | **Quotidien**, le matin (08:00 par défaut) | oui, si la conversation a un retour non traité |

- **Claude, garde de quota** : le passage hebdomadaire n'a lieu que si la fenêtre **7 jours** est utilisée à
  **20 % ou moins** (seuil réglable). La fenêtre 5 h est ignorée. Le quota connu est le dernier `QuotaState`
  reçu (`sevenDay.utilization`) ; s'il est inconnu, la condition est fausse. Si la condition est fausse à
  l'échéance, Ananda retente **toutes les heures jusqu'au vendredi 23:00**, puis enregistre un rapport
  « semaine sautée : quota » sans appel au modèle.
- **Fin de conversation** (moteur fournisseur seulement) : une session est finie quand elle passe au nirvana,
  ou quand elle est inactive depuis 30 min après son dernier tour. Si elle a au moins un retour non traité, un
  passage « fin de conversation » a lieu, restreint à cette session.
- **Rien de nouveau, pas d'appel** : si le contexte assemblé ne contient aucun élément nouveau depuis le
  dernier passage, aucun appel n'est fait et aucun rapport n'est écrit.
- **Médite maintenant** : un bouton force un passage immédiat, quel que soit le moteur et le quota.
- Les heures sont celles du serveur (heure locale).

## Données (SQLite, `apps/server/src/db.ts`)

```sql
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  event_seq INTEGER,            -- message commenté ; NULL = la conversation entière
  rating TEXT,                  -- 'up' | 'down' | NULL
  comment TEXT,                 -- facultatif
  excerpt TEXT NOT NULL,        -- contexte figé au moment du retour (message commenté et voisins, tronqué)
  created_at INTEGER NOT NULL,
  processed_at INTEGER          -- NULL tant qu'Ananda ne l'a pas lu
);
CREATE TABLE IF NOT EXISTS elder_topics (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,          -- 'manual' | 'sangha' | 'project:<nom>'
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  evidence TEXT NOT NULL,       -- JSON : ids de feedback et de sessions qui l'appuient
  status TEXT NOT NULL,         -- 'proposed' | 'accepted' | 'rejected' | 'done'
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS elder_reports (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,           -- 'daily' | 'weekly' | 'conversation' | 'manual' | 'skipped'
  text TEXT NOT NULL,
  topic_ids TEXT NOT NULL,      -- JSON : sujets créés ou mis à jour
  cost_usd REAL, tokens INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS elder_chat (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,           -- 'user' | 'elder'
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

Réglage `elder` dans la table `settings` (JSON) :

```ts
type ElderSettings = {
  enabled: boolean
  model: string                 // id de ModelChoice : 'sonnet' par défaut, ou '<provider>::<model>'
  levels: { manual: boolean; sangha: boolean; project: boolean }
  projects: string[]            // projets suivis quand levels.project
  dailyAt: string               // 'HH:MM', moteur fournisseur
  weekly: { day: number; at: string; maxWeekUsedPct: number }  // 4, '12:00', 20 — moteur Claude
  maxInputChars: number         // plafond du contexte envoyé (24 000 par défaut)
  lastRunAt: number | null      // borne « depuis le dernier passage »
}
```

Les votes : 👍 sur un sujet → `accepted`, 👎 → `rejected`, re-cliquer le même vote → `proposed`. Un sujet
accepté peut être marqué `done` à la main.

## Serveur (`apps/server/src/elder.ts`)

### Déclenchement

Un tick par minute, à côté des `setInterval` existants. Il appelle une fonction pure
`due(now, settings, quota, pending) → { kind, sessionId? } | null`, testée seule, qui applique les règles du
rythme ci-dessus. Un seul passage à la fois (verrou en mémoire).

### Assemblage du contexte

`buildContext(settings, since, store) → { text, newItems }`, chaque bloc seulement si son niveau est actif :

- **Retours** : les `feedback` non traités, avec leur extrait, leur note et leur commentaire.
- **Projet** : pour chaque projet suivi, les résumés (`ai_notes`) des sessions terminées depuis `since`.
- **Sangha** : agrégats calculés depuis la table `events` sur la période : échecs d'outils MCP par serveur,
  erreurs et interruptions de session, renouvellements, sessions confiées à Bouddha, coût total.
- **Mémoire** : les sujets ouverts (`proposed`, `accepted`) avec leur id, et les titres des sujets `rejected`
  (« ne pas reproposer »).

Les blocs sont tronqués pour tenir dans `maxInputChars`, retours manuels en priorité. `newItems = 0` → pas
d'appel.

### Appel

Le même mécanisme que `recap.ts` : `query()` du SDK, sans outils, `persistSession: false`, `outputFormat`
JSON schema, sur le modèle réglé ; pour un fournisseur, `env` reçoit `providerEnv(provider)`. Le prompt
système décrit Ananda (vieux sage bienveillant, français simple, concret) et ses règles : regrouper les
retours qui disent la même chose, ne jamais reproposer un sujet rejeté, préférer mettre à jour un sujet
existant plutôt qu'en créer un doublon, au plus 5 sujets nouveaux par passage.

Réponse attendue :

```ts
{ report: string,                         // 5 à 15 lignes
  topics: { id?: string,                  // id existant = mise à jour
            scope: string, title: string, detail: string,
            evidence: string[] }[] }
```

Validation : ids inconnus ignorés (traités comme nouveaux s'ils ont un titre), portée d'un niveau désactivé
ou d'un projet non suivi rejetée, au plus 5 nouveaux, champs vides rejetés. Ensuite : écriture du rapport,
des sujets, `processed_at` sur les retours lus, `lastRunAt`. En cas d'erreur du modèle : rien n'est marqué
traité, l'erreur est journalisée et visible dans le panneau ; le passage suivant réessaie.

### Discussion

`POST /api/elder/ask { text }` : un appel unique sans outils, contexte = sujets ouverts, 3 derniers
rapports, 20 derniers messages de `elder_chat`. Réponse en texte libre, enregistrée dans `elder_chat`. Ananda
ne modifie rien depuis la discussion.

### Routes

- `GET /api/elder` → réglages, état (prochain passage prévu, passage en cours, dernière erreur), sujets,
  10 derniers rapports, discussion.
- `PUT /api/elder/settings`
- `POST /api/elder/run` → médite maintenant.
- `POST /api/elder/ask`
- `POST /api/elder/topics/:id/vote { vote: 'up' | 'down' }`, `POST /api/elder/topics/:id/done`
- `POST /api/feedback { sessionId, eventSeq?, rating?, comment? }` → l'extrait est calculé côté serveur.
- `GET /api/sessions/:id/feedback`

Les changements sont diffusés aux clients par le flux global existant (`GlobalEvent`), avec un nouvel
événement `elder` (nombre de sujets `proposed`, passage en cours).

## Interface (`apps/web`)

- **Conversation (`chat/Chat.tsx`)** : sur chaque message, à côté de « citer », un bouton « commenter pour
  Ananda » qui ouvre un petit champ (commentaire + 👍/👎). Dans l'en-tête de la conversation : 👍/👎 en un clic
  pour la conversation entière, et un commentaire facultatif. Un message déjà commenté porte une petite marque.
- **Scène (`scene/Elder.tsx`)** : Ananda assis sous un arbre de la Bodhi (feuilles en cœur), dans un espace
  libre de la scène du monastère, dans le style SVG + `motion` existant (`LotusPond.tsx`, `Buddha.tsx`).
  Pastille avec le nombre de sujets `proposed`. Pendant un passage, une lueur douce.
- **La barbe** : une très longue barbe enroulée en spirale, faite d'une chaîne d'environ 24 points reliés par
  des ressorts. On attrape sa pointe à la souris (ou au doigt) et on la déroule ; relâchée, elle revient
  s'enrouler. Aucun effet autre que visuel. Un glisser de plus de 4 px n'ouvre pas le panneau. Avec
  `prefers-reduced-motion`, pas de balancement au repos.
- **Panneau d'Ananda** (clic sur lui) :
  - **Sujets**, groupés par portée, chacun avec 👍/👎 en un clic, son détail et ses preuves (lien vers la
    conversation) ; filtres par statut.
  - **Rapports** : les derniers, du plus récent au plus ancien.
  - **Discussion** : un fil simple avec Ananda.
  - **Médite maintenant**, état (prochain passage, dernière erreur).
  - **Réglages** : activé, moteur, les trois niveaux, projets suivis, heure du quotidien, jour/heure/seuil de
    l'hebdomadaire, plafond du contexte.

## Tests (vitest)

- `due()` : jeudi 12:00 avec quota OK / non OK / inconnu, nouvelles tentatives horaires, abandon vendredi
  23:00, quotidien fournisseur, fin de conversation (nirvana, 30 min d'inactivité, sans retour → rien),
  Ananda désactivé.
- `buildContext()` : niveaux désactivés, projets non suivis exclus, plafond respecté avec les retours en
  priorité, `newItems = 0`.
- Validation de la réponse : ids inconnus, portée interdite, plus de 5 nouveaux, champs vides.
- Votes : cycle `proposed` ↔ `accepted` / `rejected`.
- Routes `feedback` et `elder` (extrait calculé, vote, réglages).
