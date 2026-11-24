// Thin typed client for the support-agent API. Every call goes through `request()` so 429 / 402 / 404
// surface as a typed ApiError the UI can turn into a friendly state.
import {
  type AgentEvent,
  type AgentEventType,
  type ChaosFlags,
  type CreateTurnBody,
  type SessionView,
  type Tier,
  type TurnTrace,
  type VoiceTranscriptBody,
  type VoiceUsageBody,
  type ChatMessage,
  readSse,
} from '@sa/shared';

// Next only reads env files from apps/web, not the repo root, so default sensibly:
// dev → the local API on :8080; production builds → same origin (reverse proxy serves /api).
export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === 'development' ? 'http://localhost:8080' : '');

export type ApiErrorCode = 'rate_limited' | 'budget_exceeded' | 'not_found' | 'bad_request' | 'network' | 'internal' | 'http';

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface DemoInvoice {
  id: string;
  amount: number;
  date: string;
  description: string;
  status: 'paid' | 'refunded' | 'open';
  refund: 'refundable' | 'needs_human' | 'not_eligible';
  note: string;
}
export interface DemoCustomer {
  customerId: string;
  name: string;
  email: string;
  pin: string;
  tier: Tier;
  try: string;
  invoices?: DemoInvoice[];
}
export interface DemoInfo {
  customers: DemoCustomer[];
  thresholds: { high: number; low: number };
}
export interface Budget {
  todayUsd: number;
  dailyCapUsd: number;
  sessionCapUsd: number;
}
export interface VoiceToken {
  clientSecret: string;
  expiresAt: number;
  model: string;
  maxSessionSeconds: number;
}

const FRIENDLY: Partial<Record<ApiErrorCode, string>> = {
  rate_limited: "You're going a little fast. Give it a moment and try again.",
  budget_exceeded: 'This demo has reached its usage limit for today. Please come back tomorrow.',
  not_found: 'This conversation no longer exists. Start a new one.',
  network: "Can't reach the support service. Check your connection and try again.",
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error body */
  }
  const b = isRecord(body) ? body : {};
  const raw = typeof b.error === 'string' ? b.error : '';
  const code: ApiErrorCode =
    res.status === 429 || raw === 'rate_limited'
      ? 'rate_limited'
      : res.status === 402 || raw === 'budget_exceeded'
        ? 'budget_exceeded'
        : res.status === 404
          ? 'not_found'
          : res.status === 400
            ? 'bad_request'
            : res.status >= 500
              ? 'internal'
              : 'http';
  const headerRetry = Number(res.headers.get('Retry-After'));
  const retryAfterMs = typeof b.retryAfterMs === 'number' ? b.retryAfterMs : Number.isFinite(headerRetry) && headerRetry > 0 ? headerRetry * 1000 : undefined;
  const message = FRIENDLY[code] ?? (typeof b.message === 'string' ? b.message : `Request failed (${res.status}).`);
  return new ApiError(code, message, res.status, retryAfterMs);
}

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: init.body !== undefined ? { 'Content-Type': 'application/json', ...init.headers } : init.headers,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError('network', FRIENDLY.network!, 0);
  }
  if (!res.ok) throw await toApiError(res);
  return res;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await send(path, init);
  return (await res.json()) as T;
}

const body = (v: unknown) => JSON.stringify(v);

export const api = {
  health: () => json<{ ok: boolean; chunks: number; models: Record<string, string> }>('/api/health'),
  demo: () => json<DemoInfo>('/api/demo'),
  budget: () => json<Budget>('/api/budget'),
  createSession: () => json<SessionView>('/api/sessions', { method: 'POST' }),
  getSession: (id: string) => json<SessionView>(`/api/sessions/${encodeURIComponent(id)}`),
  traces: (id: string) => json<TurnTrace[]>(`/api/sessions/${encodeURIComponent(id)}/traces`),
  setChaos: (id: string, flags: ChaosFlags) => json<ChaosFlags>(`/api/sessions/${encodeURIComponent(id)}/chaos`, { method: 'PUT', body: body(flags) }),
  voiceToken: (id: string) => json<VoiceToken>(`/api/sessions/${encodeURIComponent(id)}/voice/token`, { method: 'POST' }),
  voiceTranscript: (id: string, b: VoiceTranscriptBody) => json<ChatMessage>(`/api/sessions/${encodeURIComponent(id)}/voice/transcript`, { method: 'POST', body: body(b) }),
  voiceUsage: (id: string, b: VoiceUsageBody, keepalive = false) =>
    json<{ costUsd: number }>(`/api/sessions/${encodeURIComponent(id)}/voice/usage`, { method: 'POST', body: body(b), keepalive }),

  /**
   * POST a turn and yield the SSE events as the typed AgentEvent union.
   * Throws ApiError for non-2xx responses (429 / 402 / 404) before any event is yielded.
   */
  async *turn(id: string, b: CreateTurnBody, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
    const res = await send(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: 'POST', body: body(b), ...(signal ? { signal } : {}) });
    if (!res.body) throw new ApiError('network', FRIENDLY.network!, res.status);
    for await (const frame of readSse(res.body, signal)) {
      let data: unknown;
      try {
        data = JSON.parse(frame.data);
      } catch {
        continue;
      }
      if (isAgentEvent(data)) yield data;
    }
  },
};

const EVENT_TYPES: ReadonlySet<string> = new Set<AgentEventType>([
  'turn.started',
  'step.started',
  'step.completed',
  'step.retry',
  'guardrail',
  'message.delta',
  'message.completed',
  'escalated',
  'session.updated',
  'trace',
  'error',
  'turn.completed',
]);

/** Structural guard: the server builds these from the same shared types, so we check the envelope only. */
export function isAgentEvent(v: unknown): v is AgentEvent {
  return isRecord(v) && typeof v.type === 'string' && EVENT_TYPES.has(v.type) && typeof v.turnId === 'string';
}
