// Wire protocol: every event the API streams to the browser (SSE), for both text and voice turns.
import { z } from 'zod';
import { ChatMessage, Mode, SessionView, Ticket } from './domain';

export const SpanKind = z.enum(['turn', 'llm', 'tool', 'retrieval', 'guardrail', 'embed']);
export type SpanKind = z.infer<typeof SpanKind>;

export const Usage = z.object({
  inputTokens: z.number().int(),
  cachedInputTokens: z.number().int(),
  outputTokens: z.number().int(),
});
export type Usage = z.infer<typeof Usage>;

export const Span = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  name: z.string(),
  kind: SpanKind,
  startMs: z.number(), // offset from turn start
  durationMs: z.number(),
  status: z.enum(['ok', 'error', 'aborted']),
  model: z.string().optional(),
  usage: Usage.optional(),
  costUsd: z.number().optional(),
  attempt: z.number().int().optional(),
  /** Free-form, small. Prompts/results are stored here for the trace viewer (already redacted of PINs). */
  attrs: z.record(z.unknown()).optional(),
});
export type Span = z.infer<typeof Span>;

export const TurnTrace = z.object({
  turnId: z.string(),
  sessionId: z.string(),
  mode: Mode,
  userText: z.string(),
  startedAt: z.number(),
  durationMs: z.number(),
  firstStatusMs: z.number().nullable(), // time to first visible step indicator
  answerReadyMs: z.number().nullable(), // time until the validated answer is released
  spans: z.array(Span),
  totals: z.object({
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    costUsd: z.number(),
    llmCalls: z.number().int(),
    toolCalls: z.number().int(),
  }),
  outcome: z.string(),
});
export type TurnTrace = z.infer<typeof TurnTrace>;

export const ErrorCode = z.enum([
  'llm_timeout',
  'llm_rate_limited',
  'llm_unavailable',
  'tool_failed',
  'retrieval_unavailable',
  'budget_exceeded',
  'rate_limited',
  'aborted',
  'internal',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const GuardrailCheck = z.enum([
  'retrieval_confidence',
  'grounding_judge',
  'citation_integrity',
  'number_provenance',
  'escalation_policy',
  'tool_policy',
  'verification',
]);
export type GuardrailCheck = z.infer<typeof GuardrailCheck>;

const base = { turnId: z.string(), at: z.number() };

export const AgentEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('turn.started'), ...base, mode: Mode, userMessage: ChatMessage }),
  z.object({ type: z.literal('step.started'), ...base, stepId: z.string(), name: z.string(), label: z.string() }),
  z.object({
    type: z.literal('step.completed'),
    ...base,
    stepId: z.string(),
    name: z.string(),
    status: z.enum(['ok', 'error', 'blocked']),
    summary: z.string(),
    durationMs: z.number(),
  }),
  z.object({
    type: z.literal('step.retry'),
    ...base,
    stepId: z.string(),
    name: z.string(),
    attempt: z.number().int(),
    reason: z.string(),
    waitMs: z.number(),
  }),
  z.object({
    type: z.literal('guardrail'),
    ...base,
    check: GuardrailCheck,
    decision: z.enum(['pass', 'warn', 'fail', 'escalate']),
    score: z.number().optional(),
    threshold: z.number().optional(),
    detail: z.string(),
  }),
  z.object({ type: z.literal('message.delta'), ...base, messageId: z.string(), delta: z.string() }),
  z.object({ type: z.literal('message.completed'), ...base, message: ChatMessage }),
  z.object({ type: z.literal('escalated'), ...base, ticket: Ticket }),
  z.object({ type: z.literal('session.updated'), ...base, session: SessionView }),
  z.object({ type: z.literal('trace'), ...base, trace: TurnTrace }),
  z.object({
    type: z.literal('error'),
    ...base,
    code: ErrorCode,
    message: z.string(),
    retryable: z.boolean(),
  }),
  z.object({ type: z.literal('turn.completed'), ...base, durationMs: z.number(), outcome: z.string() }),
]);
export type AgentEvent = z.infer<typeof AgentEvent>;
export type AgentEventType = AgentEvent['type'];
/** Distributive Omit so each union member keeps its own fields. */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type AgentEventInput = DistributiveOmit<AgentEvent, 'turnId' | 'at'>;

// ---- HTTP request bodies ----
export const CreateTurnBody = z.object({
  text: z.string().trim().min(1).max(2000),
  mode: Mode.default('text'),
});
export type CreateTurnBody = z.infer<typeof CreateTurnBody>;

export const VoiceTranscriptBody = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().trim().min(1).max(4000),
  interrupted: z.boolean().optional(),
});
export type VoiceTranscriptBody = z.infer<typeof VoiceTranscriptBody>;

export const VoiceUsageBody = z.object({
  model: z.string(),
  audioIn: z.number().int(),
  audioCached: z.number().int(),
  audioOut: z.number().int(),
  textIn: z.number().int(),
  textCached: z.number().int(),
  textOut: z.number().int(),
  transcribeSeconds: z.number().optional(),
  latencyMs: z.array(z.number()).optional(), // speech-stop → first audio, per response
});
export type VoiceUsageBody = z.infer<typeof VoiceUsageBody>;
