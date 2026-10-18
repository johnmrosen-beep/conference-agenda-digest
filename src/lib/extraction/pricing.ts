// What each model costs, and how to turn a response's token counts into dollars.
// Prices are per million tokens (Anthropic API list prices, checked October 2026).
// If prices change, update them here; the app's estimates and spend limits all read this table.

export type ModelId = 'claude-haiku-5-5' | 'claude-sonnet-5-5'
export type Effort = 'low' | 'medium' | 'high'

interface PriceTier {
  input: number
  output: number
}

interface ModelInfo {
  label: string
  /** Normal prices. */
  base: PriceTier
  /** Haiku charges more once a single prompt passes 100k tokens. */
  longPrompt?: { aboveTokens: number; price: PriceTier }
}

export const MODELS: Record<ModelId, ModelInfo> = {
  'claude-haiku-5-5': {
    label: 'Claude Haiku 5.5 (fast, low cost)',
    base: { input: 0.1, output: 0.5 },
    longPrompt: { aboveTokens: 100_000, price: { input: 0.5, output: 2.5 } },
  },
  'claude-sonnet-5-5': {
    label: 'Claude Sonnet 5.5 (more capable, higher cost)',
    base: { input: 2, output: 10 },
  },
}

// Prompt caching multipliers: writing to the cache costs a bit more, reading from it far less.
const CACHE_WRITE = 1.25
const CACHE_READ = 0.1

/** The token counts every API response reports. */
export interface TokenUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
}

export function priceTier(model: ModelId, promptTokens: number): PriceTier {
  const info = MODELS[model]
  if (info.longPrompt && promptTokens > info.longPrompt.aboveTokens) return info.longPrompt.price
  return info.base
}

/** The dollar cost of one API call. Output includes Claude's thinking, which is billed as output. */
export function costOfCall(model: ModelId, usage: TokenUsage): number {
  const written = usage.cache_creation_input_tokens ?? 0
  const read = usage.cache_read_input_tokens ?? 0
  const prompt = usage.input_tokens + written + read
  const tier = priceTier(model, prompt)
  const inputCost =
    (usage.input_tokens + written * CACHE_WRITE + read * CACHE_READ) * tier.input
  return (inputCost + usage.output_tokens * tier.output) / 1_000_000
}

export function formatUsd(amount: number): string {
  if (amount > 0 && amount < 0.01) return '< $0.01'
  return `$${amount.toFixed(2)}`
}
