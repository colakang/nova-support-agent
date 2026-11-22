// Thin OpenAI REST client (fetch only, server-side). We own timeouts, retry-after parsing and
// error classification instead of relying on SDK defaults — those decisions are part of the
// resilience story and should be visible in code.

export type OpenAIErrorKind = 'timeout' | 'rate_limited' | 'server' | 'client' | 'aborted' | 'network';

export class OpenAIHttpError extends Error {
  constructor(
    message: string,
    readonly kind: OpenAIErrorKind,
    readonly status: number | null,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'OpenAIHttpError';
  }
  get retryable(): boolean {
    return this.kind === 'timeout' || this.kind === 'rate_limited' || this.kind === 'server' || this.kind === 'network';
  }
}

export interface PostOptions {
  apiKey?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  baseUrl?: string;
}

function parseRetryAfter(h: Headers): number | null {
  const ms = Number(h.get('retry-after-ms'));
  if (ms > 0) return ms;
  const s = Number(h.get('retry-after'));
  if (s > 0) return s * 1000;
  return null;
}

export async function openaiPost<T>(path: string, body: unknown, opts: PostOptions = {}): Promise<T> {
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new OpenAIHttpError('OPENAI_API_KEY not set', 'client', null);
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 30_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetch(`${opts.baseUrl ?? 'https://api.openai.com/v1'}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (opts.signal?.aborted) throw new OpenAIHttpError('request aborted by caller', 'aborted', null);
    if (timeout.aborted) throw new OpenAIHttpError(`timed out after ${opts.timeoutMs ?? 30_000}ms`, 'timeout', null);
    throw new OpenAIHttpError(`network error: ${(err as Error).message}`, 'network', null);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = text.slice(0, 300);
    try { msg = JSON.parse(text)?.error?.message ?? msg; } catch { /* keep raw */ }
    const kind: OpenAIErrorKind = res.status === 429 ? 'rate_limited' : res.status >= 500 ? 'server' : 'client';
    throw new OpenAIHttpError(`OpenAI ${res.status}: ${msg}`, kind, res.status, parseRetryAfter(res.headers));
  }
  try {
    return (await res.json()) as T;
  } catch (err) {
    if (opts.signal?.aborted) throw new OpenAIHttpError('request aborted by caller', 'aborted', null);
    if (timeout.aborted) throw new OpenAIHttpError('timed out reading body', 'timeout', null);
    throw err;
  }
}
