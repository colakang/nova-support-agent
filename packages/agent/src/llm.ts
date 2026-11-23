// LLM client for the OpenAI Responses API with the failure policy we want to be able to explain:
//   429            → honour retry-after (capped), same model
//   timeout / 5xx  → retry once on the FALLBACK model (a slow primary shouldn't hold the customer)
//   flex capacity  → drop to the default tier
//   400            → no retry (a bad request won't get better)
// Plus: chaos injection for demos, a disk cache for evals, and per-call usage/cost for the trace.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { textCost, type Usage } from '@sa/shared';
import { OpenAIHttpError, openaiPost } from '@sa/shared/openai';

export type ServiceTier = 'default' | 'flex' | 'auto';

export interface FunctionTool { type: 'function'; name: string; description: string; parameters: object; strict: boolean }

export type InputItem =
  | { role: 'system' | 'developer' | 'user' | 'assistant'; content: string }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string };

export interface LlmRequest {
  model: string;
  instructions: string;
  input: InputItem[];
  tools?: FunctionTool[];
  toolChoice?: 'auto' | 'required';
  reasoning?: 'none' | 'minimal' | 'low' | 'medium';
  serviceTier?: ServiceTier;
  maxOutputTokens?: number;
  /** JSON-schema structured output (judge). */
  jsonSchema?: { name: string; schema: object };
}

export interface FunctionCall { callId: string; name: string; arguments: string }

export interface LlmResult {
  calls: FunctionCall[];
  text: string;
  usage: Usage;
  model: string;
  serviceTier: string;
  costUsd: number;
  attempts: number;
  cached: boolean;
}

export interface RetryInfo { attempt: number; reason: string; waitMs: number; nextModel: string }

/** One-shot failure injection, consumed by the first LLM call of a turn. */
export interface ChaosOnce { llmTimeout: boolean; llmRateLimit: boolean; used: boolean }

export interface LlmCallOptions {
  signal?: AbortSignal;
  timeoutMs: number;
  fallbackModel?: string;
  chaos?: ChaosOnce;
  onRetry?: (info: RetryInfo) => void;
  cacheDir?: string;
}

export class LlmError extends Error {
  constructor(message: string, readonly code: 'llm_timeout' | 'llm_rate_limited' | 'llm_unavailable' | 'aborted', readonly attempts: number) {
    super(message);
    this.name = 'LlmError';
  }
}

interface ResponsesApiResult {
  model: string;
  service_tier?: string;
  output: Array<{ type: string; call_id?: string; name?: string; arguments?: string; content?: Array<{ type: string; text?: string }> }>;
  usage?: { input_tokens: number; output_tokens: number; input_tokens_details?: { cached_tokens?: number } };
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new OpenAIHttpError('aborted', 'aborted', null)); }, { once: true });
  });

function body(req: LlmRequest, model: string, tier: ServiceTier) {
  return {
    model,
    instructions: req.instructions,
    input: req.input,
    ...(req.tools?.length ? { tools: req.tools, tool_choice: req.toolChoice ?? 'auto', parallel_tool_calls: true } : {}),
    ...(req.reasoning ? { reasoning: { effort: req.reasoning } } : {}),
    ...(req.maxOutputTokens ? { max_output_tokens: req.maxOutputTokens } : {}),
    ...(req.jsonSchema ? { text: { format: { type: 'json_schema', name: req.jsonSchema.name, schema: req.jsonSchema.schema, strict: true } } } : {}),
    service_tier: tier,
    store: false,
  };
}

function parse(r: ResponsesApiResult, attempts: number, cached: boolean): LlmResult {
  const calls: FunctionCall[] = [];
  let text = '';
  for (const o of r.output) {
    if (o.type === 'function_call') calls.push({ callId: o.call_id!, name: o.name!, arguments: o.arguments ?? '{}' });
    if (o.type === 'message') for (const c of o.content ?? []) if (c.type === 'output_text') text += c.text ?? '';
  }
  const usage: Usage = {
    inputTokens: r.usage?.input_tokens ?? 0,
    cachedInputTokens: r.usage?.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: r.usage?.output_tokens ?? 0,
  };
  const tier = r.service_tier ?? 'default';
  const costUsd = textCost(r.model, usage) * (tier === 'flex' ? 0.5 : 1);
  return { calls, text, usage, model: r.model, serviceTier: tier, costUsd: cached ? 0 : costUsd, attempts, cached };
}

export async function callLlm(req: LlmRequest, opts: LlmCallOptions): Promise<LlmResult> {
  const cacheKey = opts.cacheDir && !opts.chaos?.llmTimeout && !opts.chaos?.llmRateLimit
    ? createHash('sha256').update(JSON.stringify(body(req, req.model, req.serviceTier ?? 'default'))).digest('hex').slice(0, 32)
    : null;
  if (cacheKey && opts.cacheDir) {
    const f = join(opts.cacheDir, `${cacheKey}.json`);
    if (existsSync(f)) return parse(JSON.parse(readFileSync(f, 'utf8')) as ResponsesApiResult, 0, true);
  }

  let model = req.model;
  let tier: ServiceTier = req.serviceTier ?? 'default';
  let lastErr: OpenAIHttpError | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (opts.signal?.aborted) throw new LlmError('aborted', 'aborted', attempt - 1);
    try {
      // ---- chaos (demo only): fail the first call of the turn in a controlled way
      if (opts.chaos && !opts.chaos.used && (opts.chaos.llmRateLimit || opts.chaos.llmTimeout)) {
        opts.chaos.used = true;
        if (opts.chaos.llmRateLimit) throw new OpenAIHttpError('OpenAI 429: Rate limit reached (simulated)', 'rate_limited', 429, 1500);
        const hang = Math.min(opts.timeoutMs, 4000); // simulated hang, shortened so demos don't stall
        await sleep(hang, opts.signal);
        throw new OpenAIHttpError(`timed out after ${hang}ms (simulated)`, 'timeout', null);
      }
      const raw = await openaiPost<ResponsesApiResult>('/responses', body(req, model, tier), { ...(opts.signal ? { signal: opts.signal } : {}), timeoutMs: opts.timeoutMs });
      if (cacheKey && opts.cacheDir) {
        mkdirSync(opts.cacheDir, { recursive: true });
        writeFileSync(join(opts.cacheDir, `${cacheKey}.json`), JSON.stringify(raw));
      }
      return parse(raw, attempt, false);
    } catch (err) {
      if (!(err instanceof OpenAIHttpError)) throw err;
      if (err.kind === 'aborted') throw new LlmError('aborted', 'aborted', attempt);
      lastErr = err;
      if (!err.retryable || attempt === 3) break;
      let waitMs: number;
      let reason: string;
      if (tier === 'flex' && (err.kind === 'timeout' || (err.kind === 'rate_limited' && /resource|capacity|unavailable/i.test(err.message)))) {
        // Flex is queue-based: when it's congested the same model on the default tier answers in
        // seconds. Switching tier beats switching to a weaker model.
        tier = 'default';
        waitMs = 0;
        reason = `flex ${err.kind === 'timeout' ? 'timed out' : 'capacity unavailable'} → default tier`;
      } else if (err.kind === 'rate_limited') {
        waitMs = Math.min(err.retryAfterMs ?? 1000 * 2 ** attempt, 8000);
        reason = `rate limited (429), retry-after ${(waitMs / 1000).toFixed(1)}s`;
      } else {
        waitMs = 250;
        if (opts.fallbackModel && opts.fallbackModel !== model) model = opts.fallbackModel;
        reason = `${err.kind === 'timeout' ? 'timeout' : `upstream ${err.status ?? err.kind}`} → ${model}`;
      }
      opts.onRetry?.({ attempt: attempt + 1, reason, waitMs, nextModel: model });
      if (waitMs) {
        try { await sleep(waitMs, opts.signal); } catch { throw new LlmError('aborted', 'aborted', attempt); }
      }
    }
  }
  const code = lastErr?.kind === 'timeout' ? 'llm_timeout' : lastErr?.kind === 'rate_limited' ? 'llm_rate_limited' : 'llm_unavailable';
  throw new LlmError(lastErr?.message ?? 'LLM call failed', code, 3);
}
