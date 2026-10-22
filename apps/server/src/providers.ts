import type { Engine, ModelChoice, Provider } from '@sangha/shared'
import type { Store } from './db'

const CLAUDE: ModelChoice[] = [
  { id: '', label: 'Claude · celui de l’agent', engine: 'claude', model: null },
  { id: 'opus', label: 'Claude Opus', engine: 'claude', model: 'opus' },
  { id: 'sonnet', label: 'Claude Sonnet', engine: 'claude', model: 'sonnet' },
  { id: 'haiku', label: 'Claude Haiku', engine: 'claude', model: 'haiku' },
]

// Listed by an endpoint but useless to drive an agent: embeddings, rerankers, speech, images.
const NOT_CHAT = /embed|rerank|whisper|tts|speech|transcri|stable-diffusion|flux|bge-|e5-/i
const LIST_TTL_MS = 5 * 60_000

/** Models an endpoint lists (OpenAI-style `GET {baseUrl}/models`), chat models only, sorted. */
export async function probeModels(p: Pick<Provider, 'baseUrl' | 'apiKey' | 'authToken'>): Promise<string[]> {
  const res = await fetch(`${p.baseUrl.replace(/\/+$/, '')}/models`, {
    headers: {
      ...(p.apiKey && { 'x-api-key': p.apiKey }),
      ...(p.authToken && { authorization: `Bearer ${p.authToken}` }),
      'anthropic-version': '2023-06-01',
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  const body = (await res.json()) as { data?: { id?: unknown }[] }
  return (body.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => typeof id === 'string' && !NOT_CHAT.test(id))
    .sort()
}

/** Your providers and the models a session can pick among them, endpoint lists cached a few minutes. */
export class Providers {
  private lists = new Map<string, { at: number; models: string[] }>()

  constructor(private store: Store) {}

  all(): Provider[] {
    return this.store.providers()
  }

  get(id: string): Provider | undefined {
    return this.all().find((p) => p.id === id)
  }

  save(p: Provider) {
    this.store.saveProvider(p)
    this.lists.delete(p.id)
  }

  remove(id: string) {
    this.store.removeProvider(id)
    this.lists.delete(id)
  }

  private async modelsOf(p: Provider): Promise<string[]> {
    if (p.models) return p.models
    const cached = this.lists.get(p.id)
    if (cached && Date.now() - cached.at < LIST_TTL_MS) return cached.models
    const models = await probeModels(p).catch((err: Error) => {
      console.error(`[provider ${p.name}] model list failed: ${err.message}`)
      return cached?.models ?? []
    })
    this.lists.set(p.id, { at: Date.now(), models })
    return models
  }

  /** Every model a session can run on: Claude's, then each provider's. */
  async choices(): Promise<ModelChoice[]> {
    const theirs = await Promise.all(
      this.all().map(async (p) =>
        (await this.modelsOf(p)).map((model): ModelChoice => ({ id: `${p.id}::${model}`, label: `${p.name} · ${model.split('/').pop()}`, engine: p.id, model })),
      ),
    )
    return [...CLAUDE, ...theirs.flat()]
  }

  async choice(key: string): Promise<ModelChoice | undefined> {
    return (await this.choices()).find((m) => m.id === key)
  }

  /**
   * Environment of a session's Claude Code process. Claude: the subscription only (an API key would bill the API).
   * A provider: its address and credentials, and every model alias and subagent pointed at the chosen model.
   */
  env(engine: Engine | undefined, model: string | null | undefined): Record<string, string> {
    const env = { ...process.env } as Record<string, string>
    delete env.ANTHROPIC_API_KEY // belt and braces: never bill the API
    const p = engine && engine !== 'claude' ? this.get(engine) : undefined
    if (!p || !model) return env
    delete env.CLAUDE_CODE_OAUTH_TOKEN
    return {
      ...env,
      ANTHROPIC_BASE_URL: p.baseUrl,
      ANTHROPIC_API_KEY: p.apiKey,
      ANTHROPIC_AUTH_TOKEN: p.authToken || 'not-needed',
      ANTHROPIC_MODEL: model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: model,
      ANTHROPIC_DEFAULT_OPUS_MODEL: model,
      CLAUDE_CODE_SUBAGENT_MODEL: model,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      API_TIMEOUT_MS: String(p.timeoutMs || 3_000_000),
    }
  }
}
