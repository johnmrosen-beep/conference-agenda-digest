// The one place that talks to the Claude API. Every call goes through callStructured, which:
//   - asks for an answer in a fixed JSON shape (structured outputs),
//   - streams the reply, so long answers don't hit network timeouts,
//   - adds the call's cost to a SpendGuard and refuses to start once the limit is reached,
//   - turns API problems into plain-language errors.

import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { z } from 'zod'
import { costOfCall, formatUsd, type Effort, type ModelId, type TokenUsage } from './pricing'

/**
 * Creates an API client from the user's own key. `dangerouslyAllowBrowser` is the SDK's
 * acknowledgement that the key lives in the browser. That is the design here: each visitor
 * uses their own key, and the page's security policy only allows it to be sent to Anthropic.
 */
export function createClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 3 })
}

/** Stops a run once the money spent reaches the limit the user agreed to. */
export class SpendGuard {
  spentUsd = 0
  constructor(readonly limitUsd: number) {}

  record(costUsd: number) {
    this.spentUsd += costUsd
  }

  /** Called before every API request. */
  check() {
    if (this.spentUsd >= this.limitUsd) {
      throw new SpendLimitReached(
        `Stopped at your spending limit of ${formatUsd(this.limitUsd)} (spent ${formatUsd(this.spentUsd)}).`,
      )
    }
  }
}

export class SpendLimitReached extends Error {}

/** A problem with one call that the run can survive (for example by splitting a chunk). */
export class CallFailed extends Error {
  constructor(
    message: string,
    readonly reason: 'cut_off' | 'refused' | 'unreadable' | 'api_error',
    /** The billed call behind the failure, if one was made. */
    readonly record: CallRecord | null = null,
  ) {
    super(message)
  }
}

/** A problem that should stop the whole run, such as a rejected key. */
export class RunStopped extends Error {}

export interface CallRecord {
  label: string
  model: ModelId
  usage: TokenUsage
  costUsd: number
  seconds: number
}

export interface StructuredCall<S extends z.ZodType> {
  client: Anthropic
  model: ModelId
  effort: Effort
  system: string
  user: string
  schema: S
  maxTokens: number
  guard: SpendGuard
  label: string
  signal?: AbortSignal
}

function translateApiError(error: unknown): Error {
  if (error instanceof Anthropic.APIUserAbortError) return new RunStopped('Cancelled.')
  if (error instanceof Anthropic.AuthenticationError) {
    return new RunStopped('Anthropic did not accept this API key. Check it in step 1.')
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return new RunStopped('This API key is not allowed to use this model.')
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new RunStopped(
      'Anthropic is limiting how fast this key can send requests, or the account is out of credit. Wait a minute or check your Console billing, then try again.',
    )
  }
  if (error instanceof Anthropic.APIError) {
    return new CallFailed(`The API returned an error (${error.status ?? 'network'}): ${error.message}`, 'api_error')
  }
  return error instanceof Error ? error : new Error(String(error))
}

export async function callStructured<S extends z.ZodType>(
  call: StructuredCall<S>,
): Promise<{ data: z.infer<S>; record: CallRecord }> {
  call.guard.check()
  const started = performance.now()

  const message = await call.client.messages
    .stream(
      {
        model: call.model,
        max_tokens: call.maxTokens,
        system: call.system,
        messages: [{ role: 'user', content: call.user }],
        output_config: { effort: call.effort, format: zodOutputFormat(call.schema) },
      },
      { signal: call.signal },
    )
    .finalMessage()
    .catch((error: unknown) => {
      throw translateApiError(error)
    })

  const costUsd = costOfCall(call.model, message.usage)
  call.guard.record(costUsd)
  const record: CallRecord = {
    label: call.label,
    model: call.model,
    usage: message.usage,
    costUsd,
    seconds: (performance.now() - started) / 1000,
  }

  if (message.stop_reason === 'refusal') {
    throw new CallFailed(`Claude declined to process ${call.label}.`, 'refused', record)
  }
  if (message.stop_reason === 'max_tokens') {
    throw new CallFailed(`The answer for ${call.label} was too long and got cut off.`, 'cut_off', record)
  }

  // Structured outputs already guarantee the shape; checking again with Zod costs nothing and
  // protects against surprises.
  const checked = call.schema.safeParse(message.parsed_output)
  if (!checked.success) {
    throw new CallFailed(`The answer for ${call.label} didn't match the expected format.`, 'unreadable', record)
  }
  return { data: checked.data, record }
}

/** Counts the tokens in a prompt without running it (free). Used for the cost estimate. */
export async function countPromptTokens(
  client: Anthropic,
  model: ModelId,
  system: string,
  user: string,
): Promise<number> {
  try {
    const result = await client.messages.countTokens({
      model,
      system,
      messages: [{ role: 'user', content: user }],
    })
    return result.input_tokens
  } catch (error) {
    throw translateApiError(error)
  }
}
