// Client-side model of one agent turn as it streams in: steps, retries, guardrails, draft text,
// ticket and error. A pure reducer over the shared AgentEvent union so it is easy to test and reason about.
import type { AgentEvent, ChatMessage, ErrorCode, Mode, Ticket } from '@sa/shared';

type Ev<T extends AgentEvent['type']> = Extract<AgentEvent, { type: T }>;

export type GuardrailEvent = Ev<'guardrail'>;

export interface StepRetry {
  attempt: number;
  reason: string;
  waitMs: number;
  at: number;
}

export interface StepState {
  stepId: string;
  name: string;
  label: string;
  status: 'running' | 'ok' | 'error' | 'blocked';
  summary?: string;
  durationMs?: number;
  retries: StepRetry[];
  startedAt: number;
}

/** Errors from the SSE `error` event plus client-side failures (HTTP status before the stream, dropped connection). */
export type TurnErrorCode = ErrorCode | 'network' | 'not_found' | 'http';

export interface TurnError {
  code: TurnErrorCode;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
  at: number;
}

export type ActivityStatus = 'pending' | 'running' | 'done' | 'error' | 'aborted';

export interface TurnActivity {
  /** Stable client key (turnId is unknown until turn.started). */
  key: string;
  turnId: string | null;
  mode: Mode;
  text: string;
  status: ActivityStatus;
  /** Timeline position of the tracker (before the answer). */
  seq: number;
  /** Timeline position of the ticket / error card (after the answer). */
  postSeq: number | null;
  steps: StepState[];
  guardrails: GuardrailEvent[];
  draft: string;
  answer: ChatMessage | null;
  ticket: Ticket | null;
  error: TurnError | null;
  durationMs: number | null;
  outcome: string | null;
  startedAt: number;
}

export function newActivity(key: string, text: string, mode: Mode, seq: number): TurnActivity {
  return {
    key, turnId: null, mode, text, status: 'pending', seq, postSeq: null,
    steps: [], guardrails: [], draft: '', answer: null, ticket: null, error: null,
    durationMs: null, outcome: null, startedAt: Date.now(),
  };
}

function patchStep(steps: StepState[], stepId: string, fn: (s: StepState) => StepState): StepState[] {
  return steps.map((s) => (s.stepId === stepId ? fn(s) : s));
}

/**
 * Apply one streamed event. `nextSeq` hands out timeline positions for things that must render after
 * the assistant message (ticket / error cards).
 */
export function reduceActivity(a: TurnActivity, e: AgentEvent, nextSeq: () => number): TurnActivity {
  switch (e.type) {
    case 'turn.started':
      return { ...a, turnId: e.turnId, status: 'running' };
    case 'step.started':
      if (a.steps.some((s) => s.stepId === e.stepId)) return a;
      return { ...a, steps: [...a.steps, { stepId: e.stepId, name: e.name, label: e.label, status: 'running', retries: [], startedAt: e.at }] };
    case 'step.retry':
      return { ...a, steps: patchStep(a.steps, e.stepId, (s) => ({ ...s, retries: [...s.retries, { attempt: e.attempt, reason: e.reason, waitMs: e.waitMs, at: e.at }] })) };
    case 'step.completed':
      return { ...a, steps: patchStep(a.steps, e.stepId, (s) => ({ ...s, status: e.status, summary: e.summary, durationMs: e.durationMs })) };
    case 'guardrail':
      return { ...a, guardrails: [...a.guardrails, e] };
    case 'message.delta':
      return { ...a, draft: a.draft + e.delta };
    case 'message.completed':
      return { ...a, answer: e.message, draft: '' };
    case 'escalated':
      return { ...a, ticket: e.ticket, postSeq: a.postSeq ?? nextSeq() };
    case 'error':
      return { ...a, status: 'error', error: { code: e.code, message: e.message, retryable: e.retryable, at: e.at }, postSeq: a.postSeq ?? nextSeq() };
    case 'turn.completed':
      return {
        ...a,
        durationMs: e.durationMs,
        outcome: e.outcome,
        status: a.error ? (e.outcome === 'aborted' ? 'aborted' : 'error') : e.outcome === 'aborted' ? 'aborted' : 'done',
        // Any step still spinning when the turn ends was cut short.
        steps: a.steps.map((s) => (s.status === 'running' ? { ...s, status: 'error', summary: s.summary ?? 'Stopped' } : s)),
      };
    case 'session.updated':
    case 'trace':
      return a;
  }
}

/** Close out a turn that ended without a turn.completed (network drop, abort, HTTP error). */
export function failActivity(a: TurnActivity, error: TurnError | null, status: ActivityStatus, nextSeq: () => number): TurnActivity {
  return {
    ...a,
    status,
    error: error ?? a.error,
    postSeq: error ? (a.postSeq ?? nextSeq()) : a.postSeq,
    steps: a.steps.map((s) => (s.status === 'running' ? { ...s, status: status === 'aborted' ? 'blocked' : 'error', summary: status === 'aborted' ? 'Cancelled' : 'Interrupted' } : s)),
  };
}
