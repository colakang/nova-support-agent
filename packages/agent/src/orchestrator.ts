// The orchestrator: a bounded, state-gated tool loop.
//
//   context (code) → LLM picks tools → tools enforce policy → … → respond → guardrails → release
//
// Autonomy lives inside fences:
//   - which tools exist is decided by session state (availableTools), not by the prompt
//   - every answer passes validateRespond (+ judge in the grey zone) before the customer sees it
//   - violations go back to the model as tool feedback (max N repairs); then a safe fallback
//   - hard rules (legal language, "talk to a human", 2nd frustration, approval needed) are
//     enforced by code: the model is told, and validation refuses to release until a ticket exists
import { z } from 'zod';
import type { AgentEvent, AgentEventInput, ChatMessage, Mode, SessionFacts, SessionState, TurnTrace } from '@sa/shared';
import { classifyConfirmation, redactPins } from '@sa/shared';
import { RetrievalUnavailableError, type Retriever } from '@sa/rag';
import {
  type CustomerDirectory, FRUSTRATION_ESCALATE_AT, LEGAL_RE, MAX_VERIFY_FAILURES, PENDING_ACTION_TTL_MS, type RefundLedger, TOOL_LABELS, TOOL_SPECS,
  type ToolContext, ToolFailure, type ToolName, type ToolOutcome, availableTools, executeTool, newTurnState, overlay,
} from '@sa/tools';
import { type ChaosOnce, type FunctionTool, type InputItem, LlmError, type ServiceTier, callLlm } from './llm';
import { RESPOND_TOOL, SYSTEM_PROMPT, sessionContext } from './prompts';
import { JUDGE_INSTRUCTIONS, JUDGE_SCHEMA, type RespondArgs, type Violation, toCitation, validateRespond } from './guardrails';
import { TurnRecorder, newId } from './trace';
import { MODERATION_REPLY, type ModerationVerdict, moderate } from './moderation';
import { type BudgetGuard, BudgetExceededError, type SessionStore } from './store';

export interface AgentConfig {
  agentModel: string;
  fallbackModel: string;
  judgeModel: string;
  reasoning: 'none' | 'minimal' | 'low' | 'medium';
  serviceTier: ServiceTier;
  timeoutMs: number;
  maxSteps: number;
  maxRepairs: number;
  historyMessages: number;
  llmCacheDir?: string;
}

export const defaultConfig = (): AgentConfig => ({
  agentModel: process.env.AGENT_MODEL ?? 'gpt-6.1-terra',
  fallbackModel: process.env.FALLBACK_MODEL ?? 'gpt-6-luna',
  judgeModel: process.env.JUDGE_MODEL ?? 'gpt-6-luna',
  reasoning: (process.env.AGENT_REASONING as AgentConfig['reasoning']) ?? 'low',
  serviceTier: (process.env.AGENT_SERVICE_TIER as ServiceTier) ?? 'default',
  timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 20_000),
  maxSteps: 7,
  maxRepairs: 2,
  historyMessages: 14,
  ...(process.env.LLM_CACHE_DIR ? { llmCacheDir: process.env.LLM_CACHE_DIR } : {}),
});

export interface AgentDeps {
  retriever: Retriever;
  customers: CustomerDirectory;
  ledger: RefundLedger;
  store: SessionStore;
  budget: BudgetGuard;
  config: AgentConfig;
}

export interface TurnRequest {
  sessionId: string;
  text: string;
  mode: Mode;
  /** Voice turns: the browser persists what was actually spoken (incl. interruptions), so we don't. */
  persistMessages?: boolean;
  signal?: AbortSignal;
  emit: (e: AgentEvent) => void;
}

export interface TurnResult {
  turnId: string;
  answer: ChatMessage | null;
  outcome: string;
  trace: TurnTrace;
  error?: { code: string; message: string };
}

const RespondSchema = z.object({
  answer: z.string().trim().min(1).max(1500),
  kind: z.enum(['grounded', 'account', 'clarify', 'smalltalk', 'decline', 'escalate']),
  citations: z.array(z.string()).max(12),
  customer_sentiment: z.enum(['positive', 'neutral', 'frustrated', 'angry']),
});

const HUMAN_RE = /\b(speak|talk|chat|connect|transfer|escalate)\b.{0,25}\b(human|person|someone|representative|manager|supervisor|real agent)\b|\breal (person|human)\b|\bhuman (agent|being|please)\b/i;

const redact = redactPins;
const redactArgs = (a: unknown) => (a && typeof a === 'object' && 'pin' in a ? { ...(a as object), pin: '••••' } : a);

const FRIENDLY: Record<string, string> = {
  llm_timeout: "I'm taking longer than I should. Your message is saved: retry, or ask for a human specialist.",
  llm_rate_limited: "We're handling a lot of requests right now. Please retry in a moment; your message is saved.",
  llm_unavailable: "I'm having trouble reaching my reasoning service. Your message is saved: retry, or ask for a human specialist.",
  budget_exceeded: 'This demo has reached its daily usage limit. Please try again tomorrow.',
  internal: 'Something went wrong on our side. Your message is saved; please retry.',
};

function sentences(s: string): string[] {
  return s.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [s];
}

function outcomeOf(kind: RespondArgs['kind'] | null, turn: ReturnType<typeof newTurnState>, facts: SessionFacts): string {
  if (turn.refundCommitted) return 'refund_issued';
  if (turn.ticketCreated) return 'escalated';
  if (turn.toolLog.some((t) => t.name === 'update_account_field' && t.status === 'ok')) return 'field_updated';
  if (turn.toolLog.some((t) => (t.name === 'quote_refund' || t.name === 'issue_refund') && t.status === 'blocked')) return 'refund_blocked';
  if (facts.pendingAction) return 'awaiting_confirmation';
  if (kind === 'decline') return 'declined';
  if (kind === 'clarify' && !facts.customer) return 'needs_verification';
  if (kind === 'grounded' || kind === 'account') return 'answered';
  return kind ?? 'none';
}

export async function runTurn(req: TurnRequest, deps: AgentDeps): Promise<TurnResult> {
  const { config: cfg } = deps;
  const turnId = newId('turn');
  const rec = new TurnRecorder();
  const startedAt = Date.now();
  let firstStatusMs: number | null = null;
  let answerReadyMs: number | null = null;
  const guardrailLog: NonNullable<TurnTrace['guardrails']> = [];
  const emit = (e: AgentEventInput) => {
    if (firstStatusMs === null && e.type === 'step.started') firstStatusMs = rec.elapsed();
    if (e.type === 'guardrail') {
      guardrailLog.push({ check: e.check, decision: e.decision, detail: e.detail, at: Date.now(), ...(e.score !== undefined ? { score: e.score } : {}), ...(e.threshold !== undefined ? { threshold: e.threshold } : {}) });
    }
    req.emit({ ...e, turnId, at: Date.now() } as AgentEvent);
  };
  const persist = req.persistMessages ?? true;

  const session = await deps.store.get(req.sessionId);
  if (!session) throw new Error(`session ${req.sessionId} not found`);

  // Persist/trace the redacted text; only this turn's model input sees the raw PIN.
  const userMsg: ChatMessage = { id: newId('msg'), role: 'user', mode: req.mode, content: redactPins(req.text), at: startedAt, turnId };
  const last = session.messages.at(-1);
  const isRetry = last?.role === 'user' && last.content.trim() === userMsg.content.trim();
  if (persist && !isRetry) await deps.store.appendMessage(req.sessionId, userMsg);
  emit({ type: 'turn.started', mode: req.mode, userMessage: userMsg });

  const facts: SessionFacts = structuredClone(session.facts);
  let state: SessionState = session.state;
  const consultedDocs = new Set(facts.consultedDocs);
  const turn = newTurnState();
  const chaosOnce: ChaosOnce = { llmTimeout: session.chaos.llmTimeout, llmRateLimit: session.chaos.llmRateLimit, used: false };

  // ---- two-phase commit: is this message the customer's explicit yes/no to a pending action?
  // Decided by code (it unlocks moving money), never by the model.
  let confirmation: ToolContext['confirmation'] = 'none';
  const pending = facts.pendingAction;
  if (pending) {
    if (Date.now() - pending.createdAt > PENDING_ACTION_TTL_MS) {
      facts.pendingAction = null;
      emit({ type: 'guardrail', check: 'tool_policy', decision: 'warn', detail: `Pending ${pending.kind} ${pending.id} expired unconfirmed` });
    } else {
      confirmation = classifyConfirmation(req.text);
      if (confirmation === 'decline') facts.pendingAction = null;
      emit({
        type: 'guardrail', check: 'tool_policy', decision: confirmation === 'affirm' ? 'pass' : 'warn',
        detail: confirmation === 'affirm' ? `Customer confirmed ${pending.id}: ${pending.summary}` : confirmation === 'decline' ? `Customer declined ${pending.id}; nothing executed` : `${pending.id} still awaiting an explicit yes; execution stays locked`,
      });
    }
  }

  const ctx: ToolContext = {
    sessionId: req.sessionId, facts, consultedDocs, turn, retriever: deps.retriever, customers: deps.customers,
    ledger: deps.ledger, chaos: session.chaos, now: Date.now(), ...(req.signal ? { signal: req.signal } : {}),
    turnId, confirmation,
  };
  const saveFacts = async () => {
    facts.consultedDocs = [...consultedDocs];
    if (turn.ticketCreated) state = 'escalated';
    await deps.store.saveFacts(req.sessionId, facts, state);
  };

  // ---- hard rules detected by code before the model runs
  let requiredTicket: string | null = null;
  let forced: string | null = null;
  if (LEGAL_RE.test(req.text)) {
    requiredTicket = 'legal';
    forced = 'Legal, chargeback or regulator language detected. Create an escalation ticket (reason legal, priority high) and tell the customer a specialist will follow up. Do not argue the merits.';
  } else if (HUMAN_RE.test(req.text)) {
    requiredTicket = 'customer_request';
    forced = 'The customer asked for a human. Create an escalation ticket (reason customer_request) summarising the conversation, then confirm the handoff.';
  } else if (facts.verifyFailures >= MAX_VERIFY_FAILURES && !facts.tickets.some((t) => t.reason === 'verification_locked')) {
    requiredTicket = 'verification_locked';
    forced = 'Identity verification is locked after too many failed attempts. Create an escalation ticket (reason verification_locked) and tell the customer the security team will contact them.';
  }
  if (requiredTicket) emit({ type: 'guardrail', check: 'escalation_policy', decision: 'escalate', detail: `Rule triggered: ${requiredTicket.replace(/_/g, ' ')}` });

  const customerInvoices = () => {
    const rec = facts.customer ? deps.customers.get(facts.customer.id) : undefined;
    if (!rec) return undefined;
    return overlay(rec, facts, ctx.now).invoices
      .slice()
      .sort((a, b) => a.days_ago - b.days_ago)
      .map((i) => ({ id: i.id, date: i.date, amount: i.amount, description: i.description, status: i.status }));
  };

  // ---- conversation input
  const history = session.messages.filter((m) => m.turnId !== turnId).slice(-cfg.historyMessages);
  if (history.at(-1)?.role === 'user' && history.at(-1)!.content.trim() === userMsg.content.trim()) history.pop();
  const input: InputItem[] = [
    { role: 'developer', content: sessionContext({ facts, state, mode: req.mode, now: ctx.now, forced, confirmation, declined: pending && confirmation === 'decline' ? pending.summary : null, invoices: customerInvoices() }) },
    ...history.map((m) => ({ role: m.role, content: m.interrupted ? `${m.content} [cut off: customer interrupted]` : m.content }) as InputItem),
    { role: 'user', content: req.text },
  ];

  let final: { args: RespondArgs; citations: ChatMessage['citations'] } | null = null;
  let repairs = 0;
  let errorOut: TurnResult['error'];
  let lastViolations: Violation[] = [];

  const sourcesText = () => [
    req.text,
    ...history.filter((m) => m.role === 'user').map((m) => m.content),
    ...[...turn.chunks.values()].map((c) => c.content),
    ...turn.toolLog.filter((t) => t.name !== 'search_policies').map((t) => JSON.stringify(t.data)),
    JSON.stringify({ refunds: facts.refunds, tickets: facts.tickets.map((t) => t.id) }),
  ].join('\n');

  const runTool = async (name: ToolName, args: unknown): Promise<ToolOutcome> => {
    const stepId = newId('st');
    emit({ type: 'step.started', stepId, name, label: TOOL_LABELS[name] });
    const span = rec.start(`tool.${name}`, name === 'search_policies' ? 'retrieval' : 'tool');
    const t0 = performance.now();
    let out: ToolOutcome;
    for (let attempt = 1; ; attempt++) {
      try {
        out = await executeTool(name, args, ctx);
        break;
      } catch (err) {
        if (err instanceof ToolFailure && err.transient && attempt === 1) {
          emit({ type: 'step.retry', stepId, name, attempt: 2, reason: err.message, waitMs: 500 });
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        if (err instanceof ToolFailure || err instanceof RetrievalUnavailableError) {
          const kb = err instanceof RetrievalUnavailableError;
          out = {
            status: 'error',
            summary: kb ? 'Knowledge base unavailable' : 'Account system unavailable',
            data: { error: kb ? 'knowledge_base_unavailable' : 'system_unavailable', retryable: false, note: kb ? "Can't look up policies right now. Don't answer policy questions from memory; offer a specialist ticket." : "Couldn't complete this action. Don't say it succeeded; offer a specialist ticket (reason system_failure)." },
          };
          turn.toolLog.push({ name, status: 'error', summary: out.summary, data: out.data });
          break;
        }
        span.end({ status: 'error', attrs: { args: redactArgs(args), error: String(err) } });
        throw err;
      }
    }
    const r = name === 'search_policies' ? turn.retrievals.at(-1) : undefined;
    span.end({
      status: out.status === 'error' ? 'error' : 'ok',
      attempt: 1,
      ...(r ? { model: r.embedModel, usage: { inputTokens: r.embedTokens, cachedInputTokens: 0, outputTokens: 0 }, costUsd: (r.embedTokens * 0.02) / 1e6 } : {}),
      attrs: {
        args: redactArgs(args),
        result: out.data,
        ...(r ? { timings: r.timings, topSimilarity: r.topSimilarity, band: r.band, thresholds: r.thresholds, candidates: r.chunks.map((c) => ({ id: c.id, sim: Number(c.similarity.toFixed(3)), score: Number(c.score.toFixed(3)), rrf: Number(c.rrf.toFixed(4)), exact: c.exact, tiers: c.tiers })), otherTier: r.otherTier.map((c) => c.id) } : {}),
      },
    });
    emit({ type: 'step.completed', stepId, name, status: out.status === 'ok' ? 'ok' : out.status === 'blocked' ? 'blocked' : 'error', summary: out.summary, durationMs: Math.round(performance.now() - t0) });
    if (r) {
      emit({
        type: 'guardrail', check: 'retrieval_confidence',
        decision: r.band === 'high' ? 'pass' : r.band === 'medium' ? 'warn' : 'fail',
        score: Number(r.topSimilarity.toFixed(3)), threshold: r.band === 'high' ? r.thresholds.high : r.thresholds.low,
        detail: r.band === 'low' ? 'Below τ_low: passages withheld from the model, answer must not be grounded' : r.band === 'medium' ? 'Between τ_low and τ_high: answer will be checked by the grounding judge' : 'Above τ_high',
      });
    }
    if (name === 'verify_customer' && out.status === 'blocked') emit({ type: 'guardrail', check: 'verification', decision: 'fail', detail: out.summary });
    if (name !== 'search_policies') await saveFacts(); // commit points persist immediately (survive aborts)
    return out;
  };

  const judge = async (args: RespondArgs, cited: ReturnType<typeof validateRespond>['citedChunks']): Promise<Violation | null> => {
    const span = rec.start('llm.grounding_judge', 'guardrail');
    try {
      const res = await callLlm({
        model: cfg.judgeModel,
        instructions: JUDGE_INSTRUCTIONS,
        input: [{ role: 'user', content: `PASSAGES:\n${cited.map((c) => `[${c.id}] ${c.content}`).join('\n\n')}\n\nTOOL RESULTS:\n${turn.toolLog.filter((t) => t.name !== 'search_policies').map((t) => JSON.stringify(t.data)).join('\n') || '(none)'}\n\nANSWER:\n${args.answer}` }],
        jsonSchema: JUDGE_SCHEMA,
        reasoning: 'low',
        serviceTier: cfg.serviceTier,
        maxOutputTokens: 600,
      }, { timeoutMs: 10_000, ...(req.signal ? { signal: req.signal } : {}), ...(cfg.llmCacheDir ? { cacheDir: cfg.llmCacheDir } : {}) });
      await deps.budget.add(req.sessionId, res.costUsd);
      const verdict = JSON.parse(res.text || '{}') as { supported?: boolean; unsupported_claims?: string[] };
      span.end({ model: res.model, usage: res.usage, costUsd: res.costUsd, attrs: { verdict } });
      emit({ type: 'guardrail', check: 'grounding_judge', decision: verdict.supported ? 'pass' : 'fail', detail: verdict.supported ? 'All claims supported by cited passages' : `Unsupported: ${(verdict.unsupported_claims ?? []).join('; ')}` });
      return verdict.supported ? null : { check: 'grounding_judge', detail: `Not supported by the cited passages: ${(verdict.unsupported_claims ?? []).join('; ')}. Remove these claims or say you can't confirm them.` };
    } catch (err) {
      // Judge unavailable: fail closed on grey-zone answers.
      span.end({ status: 'error', attrs: { error: String(err) } });
      emit({ type: 'guardrail', check: 'grounding_judge', decision: 'fail', detail: 'Judge unavailable; failing closed' });
      return { check: 'grounding_judge', detail: 'Could not verify this answer. Say you cannot confirm it and offer a specialist.' };
    }
  };

  // Moderation runs in parallel with the first LLM call; awaited before any tool or answer.
  let moderation: Promise<ModerationVerdict> | null = null;
  let moderationChecked = false;
  const gateModeration = async (): Promise<boolean> => {
    if (moderationChecked || !moderation) return false;
    moderationChecked = true;
    const v = await moderation;
    rec.start('moderation', 'guardrail').end({ status: v.action === 'allow' ? 'ok' : 'error', attrs: { ...v } });
    if (v.action === 'allow') {
      if (v.flagged.length || v.error) emit({ type: 'guardrail', check: 'moderation', decision: 'warn', detail: v.error ? `Moderation unavailable (fail open): ${v.error}` : `Flagged but allowed: ${v.flagged.join(', ')}` });
      return false;
    }
    emit({ type: 'guardrail', check: 'moderation', decision: 'fail', detail: `Blocked before any tool ran: ${v.flagged.join(', ')}` });
    final = { args: { answer: MODERATION_REPLY[v.action], kind: 'decline', citations: [], customer_sentiment: 'neutral' }, citations: [] };
    return true;
  };

  try {
    await deps.budget.check(req.sessionId);
    moderation = moderate(req.text, req.signal);

    for (let step = 0; step < cfg.maxSteps && !final; step++) {
      if (req.signal?.aborted) throw new LlmError('aborted', 'aborted', 0);
      const names = availableTools({ facts, consultedDocs, turnId, confirmation, now: ctx.now });
      const tools: FunctionTool[] = [
        ...names.map((n) => ({ type: 'function' as const, name: n, description: TOOL_SPECS[n].description, parameters: TOOL_SPECS[n].parameters, strict: true })),
        RESPOND_TOOL,
      ];
      const stepId = newId('st');
      const label = step === 0 ? 'Understanding your request' : repairs && lastViolations.length ? 'Revising answer after fact-check' : 'Deciding next step';
      emit({ type: 'step.started', stepId, name: 'llm', label });
      const span = rec.start(`llm.step${step + 1}`, 'llm');
      const t0 = performance.now();
      const inputSnapshot = step === 0 ? input.map((i) => ('content' in i ? { ...i, content: redact(i.content) } : i)) : input.slice(-6);
      let res;
      try {
        res = await callLlm(
          { model: cfg.agentModel, instructions: SYSTEM_PROMPT, input, tools, toolChoice: 'required', reasoning: cfg.reasoning, serviceTier: cfg.serviceTier, maxOutputTokens: 2000 },
          {
            timeoutMs: cfg.timeoutMs, fallbackModel: cfg.fallbackModel, chaos: chaosOnce,
            ...(req.signal ? { signal: req.signal } : {}), ...(cfg.llmCacheDir ? { cacheDir: cfg.llmCacheDir } : {}),
            onRetry: (i) => emit({ type: 'step.retry', stepId, name: 'llm', attempt: i.attempt, reason: i.reason, waitMs: i.waitMs }),
          },
        );
      } catch (err) {
        span.end({ status: err instanceof LlmError && err.code === 'aborted' ? 'aborted' : 'error', attrs: { error: String(err) } });
        emit({ type: 'step.completed', stepId, name: 'llm', status: 'error', summary: (err as Error).message, durationMs: Math.round(performance.now() - t0) });
        throw err;
      }
      await deps.budget.add(req.sessionId, res.costUsd);
      span.end({
        model: res.model, usage: res.usage, costUsd: res.costUsd, attempt: res.attempts,
        attrs: { serviceTier: res.serviceTier, cached: res.cached, toolsOffered: names, calls: res.calls.map((c) => ({ name: c.name, args: redactArgs(safeJson(c.arguments)) })), ...(step === 0 ? { instructions: SYSTEM_PROMPT } : {}), input: inputSnapshot },
      });
      emit({ type: 'step.completed', stepId, name: 'llm', status: 'ok', summary: `${res.model}${res.serviceTier === 'flex' ? ' (flex)' : ''} → ${res.calls.map((c) => c.name).join(', ') || 'text'}`, durationMs: Math.round(performance.now() - t0) });

      if (await gateModeration()) break;
      if (!res.calls.length) {
        input.push({ role: 'developer', content: 'You must reply by calling the respond tool.' });
        continue;
      }
      const order = (n: string) => (n === 'verify_customer' ? 0 : n === 'respond' ? 2 : 1);
      const calls = [...res.calls].sort((a, b) => order(a.name) - order(b.name));
      const hasOthers = calls.some((c) => c.name !== 'respond');

      for (const call of calls) {
        input.push({ type: 'function_call', call_id: call.callId, name: call.name, arguments: call.arguments });
        const parsed = safeJson(call.arguments);

        if (call.name === 'respond') {
          if (hasOthers) {
            input.push({ type: 'function_call_output', call_id: call.callId, output: JSON.stringify({ accepted: false, reason: 'Call respond only after you have seen the results of your other tool calls.' }) });
            continue;
          }
          const p = RespondSchema.safeParse(parsed);
          if (!p.success) {
            input.push({ type: 'function_call_output', call_id: call.callId, output: JSON.stringify({ accepted: false, error: 'invalid respond arguments', issues: p.error.issues.map((i) => i.message) }) });
            continue;
          }
          const args = p.data as RespondArgs;
          const frustratedNow = args.customer_sentiment === 'frustrated' || args.customer_sentiment === 'angry';
          const needTicket = requiredTicket ?? (frustratedNow && facts.frustration + 1 >= FRUSTRATION_ESCALATE_AT ? 'frustrated_customer' : null);
          const gSpan = rec.start('guardrails.validate', 'guardrail');
          const v = validateRespond(args, turn, facts, deps.retriever.thresholds, sourcesText(), { ticket: needTicket });
          const violations = [...v.violations];
          if (!violations.length && v.needsJudge) {
            const j = await judge(args, v.citedChunks);
            if (j) violations.push(j);
          }
          gSpan.end({ status: violations.length ? 'error' : 'ok', attrs: { kind: args.kind, citations: args.citations, numbersChecked: v.numbersChecked, judged: v.needsJudge, violations } });
          for (const c of ['citation_integrity', 'number_provenance', 'tool_policy', 'escalation_policy'] as const) {
            const hit = violations.find((x) => x.check === c);
            const relevant = c === 'citation_integrity' ? args.kind === 'grounded' || args.citations.length > 0 : c === 'number_provenance' ? v.numbersChecked.length > 0 : c === 'escalation_policy' ? !!needTicket || turn.requiresHuman.length > 0 : !!hit;
            if (hit || relevant) emit({ type: 'guardrail', check: c, decision: hit ? 'fail' : 'pass', detail: hit ? hit.detail : c === 'number_provenance' ? `Verified: ${v.numbersChecked.join(', ')}` : 'ok' });
          }
          if (!violations.length) {
            final = { args, citations: v.citedChunks.map(toCitation) };
            if (frustratedNow) facts.frustration += 1;
            break;
          }
          lastViolations = violations;
          if (repairs >= cfg.maxRepairs) break;
          repairs++;
          input.push({ type: 'function_call_output', call_id: call.callId, output: JSON.stringify({ accepted: false, violations: violations.map((x) => x.detail), instruction: 'Fix these issues (call more tools if needed), then call respond again.' }) });
          continue;
        }

        const name = call.name as ToolName;
        if (!(names as string[]).includes(name)) {
          emit({ type: 'guardrail', check: 'tool_policy', decision: 'fail', detail: `${name} is not available in this state` });
          input.push({ type: 'function_call_output', call_id: call.callId, output: JSON.stringify({ error: 'tool_not_available', available: names, hint: name === 'issue_refund' || name === 'update_account_field' ? 'This executes only after quote_refund / propose_account_update in an EARLIER turn and the customer\'s explicit yes in their latest message. Present the quote and ask them to confirm.' : name === 'quote_refund' ? (facts.customer ? 'search the refund policy first' : 'verify the customer first') : undefined }) });
          continue;
        }
        const out = await runTool(name, parsed);
        input.push({ type: 'function_call_output', call_id: call.callId, output: JSON.stringify(out.data) });
      }
      const tail = input.at(-1);
      if (!final && repairs >= cfg.maxRepairs && lastViolations.length && !(tail && 'type' in tail && tail.type === 'function_call_output')) break;
    }

    // ---- safe fallback: never release an answer that failed validation
    if (!final) {
      const mustEscalate = requiredTicket ?? turn.requiresHuman[0] ?? (lastViolations.length ? 'low_confidence' : null);
      emit({ type: 'guardrail', check: 'escalation_policy', decision: mustEscalate ? 'escalate' : 'fail', detail: `No answer passed validation${lastViolations.length ? ` (${lastViolations.map((x) => x.check).join(', ')})` : ''}; using safe fallback` });
      if (mustEscalate && !turn.ticketCreated) {
        const reason = ['legal', 'customer_request', 'verification_locked'].includes(mustEscalate) ? mustEscalate : mustEscalate.startsWith('refund_approval') ? 'refund_approval' : 'low_confidence';
        await runTool('create_escalation_ticket', { reason, priority: reason === 'legal' ? 'high' : 'normal', summary: `Auto-escalated (${mustEscalate}). Customer's latest message: "${req.text.slice(0, 300)}"` });
      }
      const t = turn.ticketCreated;
      final = {
        args: {
          answer: t
            ? `I've passed this to a specialist so you get an accurate answer. Your ticket number is ${t.id}, and they'll follow up by email.`
            : "I can't confirm that from our documentation, and I don't want to guess. Would you like me to connect you with a specialist?",
          kind: t ? 'escalate' : 'decline',
          citations: [],
          customer_sentiment: 'neutral',
        },
        citations: [],
      };
    }

    // ---- release
    answerReadyMs = rec.elapsed();
    const answer: ChatMessage = {
      id: newId('msg'), role: 'assistant', mode: req.mode, content: final.args.answer, at: Date.now(), turnId,
      kind: final.args.kind, ...(final.citations?.length ? { citations: final.citations } : {}),
    };
    for (const s of sentences(answer.content)) emit({ type: 'message.delta', messageId: answer.id, delta: s });
    emit({ type: 'message.completed', message: answer });
    if (persist) await deps.store.appendMessage(req.sessionId, answer);
    await saveFacts();
    if (turn.ticketCreated) emit({ type: 'escalated', ticket: turn.ticketCreated });
    const outcome = outcomeOf(final.args.kind, turn, facts);
    return await finish(outcome, answer);
  } catch (err) {
    const aborted = (err instanceof LlmError && err.code === 'aborted') || req.signal?.aborted;
    const code = aborted ? 'aborted' : err instanceof LlmError ? err.code : err instanceof BudgetExceededError ? 'budget_exceeded' : 'internal';
    if (code === 'internal') console.error('[agent] turn failed', err);
    await saveFacts().catch(() => {});
    errorOut = { code, message: FRIENDLY[code] ?? (err as Error).message };
    emit({ type: 'error', code: code as never, message: errorOut.message, retryable: code !== 'budget_exceeded' && code !== 'aborted' });
    return await finish(aborted ? 'aborted' : 'error', null);
  }

  async function finish(outcome: string, answer: ChatMessage | null): Promise<TurnResult> {
    const trace: TurnTrace = {
      turnId, sessionId: req.sessionId, mode: req.mode, userText: redact(req.text), startedAt,
      durationMs: rec.elapsed(), firstStatusMs, answerReadyMs, spans: rec.spans, totals: rec.totals(), outcome,
      guardrails: guardrailLog,
    };
    await deps.store.saveTrace(trace).catch((e) => console.error('[agent] saveTrace', e));
    const fresh = await deps.store.get(req.sessionId).catch(() => null);
    if (fresh) emit({ type: 'session.updated', session: fresh });
    emit({ type: 'trace', trace });
    emit({ type: 'turn.completed', durationMs: trace.durationMs, outcome });
    return { turnId, answer, outcome, trace, ...(errorOut ? { error: errorOut } : {}) };
  }
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return {}; }
}
