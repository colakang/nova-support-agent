// The agent's tools. Each tool:
//   - validates its arguments (zod) — the model's JSON is untrusted input,
//   - enforces business policy in code (policy.ts) and returns a typed outcome,
//   - reports `requiresHuman` instead of improvising when policy says a person must decide.
// The LLM-facing schemas are `strict` so the model cannot add or omit fields.
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { ChaosFlags, SessionFacts, Ticket, Tier } from '@sa/shared';
import { type RetrievalResult, type RetrievedChunk, type Retriever, RetrievalUnavailableError } from '@sa/rag';
import { type CustomerDirectory, overlay, toView } from './customers';
import type { RefundLedger } from './ledger';
import {
  AGENT_REFUNDS_PER_30_DAYS, DUPLICATE_CHARGE_AGENT_LIMIT_USD, MAX_VERIFY_FAILURES, PLAN_PRICES,
  PRO_ANNUAL_PRORATION_WINDOW_DAYS, REFUND_RULES, UPDATABLE_FIELDS,
} from './policy';

export type ToolName = 'verify_customer' | 'search_policies' | 'issue_refund' | 'update_account_field' | 'create_escalation_ticket';

export const TOOL_LABELS: Record<ToolName, string> = {
  verify_customer: 'Verifying identity & account tier',
  search_policies: 'Searching knowledge base',
  issue_refund: 'Processing refund',
  update_account_field: 'Updating account',
  create_escalation_ticket: 'Creating ticket for a human specialist',
};

/** Per-turn scratchpad the orchestrator owns; tools append to it. */
export interface TurnState {
  retrievals: RetrievalResult[];
  /** chunk id → chunk for everything retrieved this turn (citation integrity check). */
  chunks: Map<string, RetrievedChunk>;
  /** Tool outputs this turn, for number-provenance checks and the ticket's "steps taken". */
  toolLog: Array<{ name: ToolName; status: ToolOutcome['status']; summary: string; data: unknown }>;
  /** Reasons a human must decide, raised by tools this turn. */
  requiresHuman: string[];
  ticketCreated: Ticket | null;
  refundCommitted: boolean;
  chaosToolFailureUsed: boolean;
}

export const newTurnState = (): TurnState => ({
  retrievals: [], chunks: new Map(), toolLog: [], requiresHuman: [], ticketCreated: null, refundCommitted: false, chaosToolFailureUsed: false,
});

export interface ToolContext {
  sessionId: string;
  facts: SessionFacts; // mutated in place; orchestrator persists after every tool
  /** Doc ids the agent consulted this session (refunds require the refund policy first). */
  consultedDocs: Set<string>;
  turn: TurnState;
  retriever: Retriever;
  customers: CustomerDirectory;
  ledger: RefundLedger;
  chaos: ChaosFlags;
  now: number;
  signal?: AbortSignal;
}

export interface ToolOutcome {
  status: 'ok' | 'blocked' | 'error';
  /** One line for the UI step indicator. */
  summary: string;
  /** JSON the model sees. */
  data: unknown;
  requiresHuman?: string;
}

export class ToolFailure extends Error {
  constructor(message: string, readonly transient: boolean) { super(message); this.name = 'ToolFailure'; }
}

const id = (prefix: string) => `${prefix}-${randomBytes(3).toString('hex').toUpperCase()}`;

// ---------------------------------------------------------------- LLM-facing schemas (Responses API, strict)

const obj = (properties: Record<string, unknown>) => ({
  type: 'object', additionalProperties: false, properties, required: Object.keys(properties),
});

export const TOOL_SPECS: Record<ToolName, { description: string; parameters: object }> = {
  verify_customer: {
    description: 'Verify the customer with their account email and 4-digit support PIN. Returns name, plan tier, contract status and recent invoices. Required before any account-specific answer or action.',
    parameters: obj({ email: { type: 'string' }, pin: { type: 'string', description: '4-digit support PIN' } }),
  },
  search_policies: {
    description: "Search Northstar's support knowledge base (policies, pricing, troubleshooting). Results are filtered to the verified customer's plan. Returns passages with chunk ids to cite and a confidence level.",
    parameters: obj({ query: { type: 'string', description: 'Self-contained search query, e.g. "refund window for Pro monthly plan"' } }),
  },
  issue_refund: {
    description: 'Refund a specific invoice for the verified customer. Policy limits are enforced by the billing system; if a human must approve, the result says so.',
    parameters: obj({
      invoice_id: { type: 'string' },
      amount: { type: ['number', 'null'], description: 'Amount in USD, or null for the full eligible amount' },
      reason: { type: 'string', enum: ['duplicate_charge', 'unused_service', 'charged_after_cancellation', 'billing_error', 'other'] },
    }),
  },
  update_account_field: {
    description: `Update one account field for the verified customer. Allowed: ${UPDATABLE_FIELDS.join(', ')}.`,
    parameters: obj({ field: { type: 'string' }, value: { type: 'string' } }),
  },
  create_escalation_ticket: {
    description: 'Hand the conversation to a human specialist with a structured ticket. Use when policy requires approval, the customer asks for a human, legal/chargeback language appears, the customer is frustrated twice, or you cannot answer confidently.',
    parameters: obj({
      reason: { type: 'string', enum: ['refund_approval', 'policy_exception', 'legal', 'frustrated_customer', 'low_confidence', 'verification_locked', 'account_security', 'customer_request', 'system_failure', 'other'] },
      priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
      summary: { type: 'string', description: "2-3 sentences for the specialist: what the customer wants and what you've established" },
    }),
  },
};

// ---------------------------------------------------------------- gating: which tools exist right now

/** Tools are exposed by state, not by prompt. An unverified session literally cannot call issue_refund. */
export function availableTools(ctx: Pick<ToolContext, 'facts' | 'consultedDocs'>): ToolName[] {
  const tools: ToolName[] = ['search_policies', 'create_escalation_ticket'];
  if (!ctx.facts.customer) {
    if (ctx.facts.verifyFailures < MAX_VERIFY_FAILURES) tools.unshift('verify_customer');
    return tools;
  }
  tools.push('update_account_field');
  if (ctx.consultedDocs.has('refund-policy')) tools.push('issue_refund');
  return tools;
}

// ---------------------------------------------------------------- implementations

const VerifyArgs = z.object({ email: z.string().trim().min(3).max(200), pin: z.string().trim() });

async function verifyCustomer(raw: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const a = VerifyArgs.parse(raw);
  if (ctx.facts.customer) return { status: 'ok', summary: `Already verified as ${ctx.facts.customer.name}`, data: { verified: true, note: 'Session already verified; identity cannot be changed in this session.' } };
  if (ctx.facts.verifyFailures >= MAX_VERIFY_FAILURES) {
    return { status: 'blocked', summary: 'Verification locked', data: { verified: false, locked: true }, requiresHuman: 'verification_locked' };
  }
  const rec = ctx.customers.findByEmail(a.email);
  if (!rec || rec.pin !== a.pin.replace(/\D/g, '')) {
    ctx.facts.verifyFailures += 1;
    const remaining = MAX_VERIFY_FAILURES - ctx.facts.verifyFailures;
    // Same message whether the email exists or not: no account enumeration.
    return {
      status: 'blocked',
      summary: `Verification failed (${remaining} attempt${remaining === 1 ? '' : 's'} left)`,
      data: { verified: false, remaining_attempts: remaining, locked: remaining <= 0 },
      ...(remaining <= 0 ? { requiresHuman: 'verification_locked' } : {}),
    };
  }
  ctx.facts.customer = toView(rec);
  const o = overlay(rec, ctx.facts, ctx.now);
  return {
    status: 'ok',
    summary: `Verified ${rec.name} · ${rec.tier} (${rec.billing_cycle}) · contract ${rec.contract.status}`,
    data: {
      verified: true,
      customer: {
        name: rec.name, company: rec.company, tier: rec.tier, billing_cycle: rec.billing_cycle,
        contract_status: rec.contract.status,
        ...(rec.contract.balance_due !== undefined ? { balance_due_usd: rec.contract.balance_due } : {}),
        ...(rec.contract.renews_in_days !== undefined ? { renews_in_days: rec.contract.renews_in_days } : {}),
        ...(rec.contract.cancelled_days_ago !== undefined ? { cancelled_days_ago: rec.contract.cancelled_days_ago } : {}),
        ...(rec.contract.account_manager ? { account_manager: rec.contract.account_manager } : {}),
      },
      invoices: o.invoices,
      refunds_last_30_days: o.recentRefunds,
    },
  };
}

const SearchArgs = z.object({ query: z.string().trim().min(2).max(500) });

async function searchPolicies(raw: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const a = SearchArgs.parse(raw);
  if (ctx.chaos.retrievalDown) throw new RetrievalUnavailableError('vector store unreachable (simulated)');
  const tier: Tier | null = ctx.facts.customer?.tier ?? null;
  const r = await ctx.retriever.search(a.query, { tier, k: 5, ...(ctx.signal ? { signal: ctx.signal } : {}) });
  ctx.turn.retrievals.push(r);
  const usable = r.band === 'low' ? [] : r.chunks;
  for (const c of usable) { ctx.turn.chunks.set(c.id, c); ctx.consultedDocs.add(c.docId); }
  const fmt = (c: RetrievedChunk) => ({ chunk_id: c.id, doc: c.docId, section: c.sectionPath, applies_to: c.tiers, similarity: Number(c.similarity.toFixed(3)), ...(c.exact ? { exact_identifier_match: true } : {}), text: c.content });
  const note =
    r.band === 'low'
      ? `No passage is relevant enough (best similarity ${r.topSimilarity.toFixed(2)} < ${r.thresholds.low}). Do NOT answer from general knowledge. Tell the customer you can't confirm this and offer a human specialist.`
      : r.band === 'medium'
        ? 'Moderate match: state only what these passages say explicitly. Your answer will be fact-checked against them.'
        : 'Strong match. Cite the chunk ids you rely on.';
  const docs = [...new Set(usable.map((c) => c.docId))];
  return {
    status: 'ok',
    summary: usable.length ? `${usable.length} passages · best ${r.topSimilarity.toFixed(2)} (${r.band}) · ${docs.join(', ')}` : `No confident match (best ${r.topSimilarity.toFixed(2)})`,
    data: {
      confidence: r.band,
      top_similarity: Number(r.topSimilarity.toFixed(3)),
      customer_tier: tier ?? 'unknown (not verified)',
      results: usable.map(fmt),
      ...(r.otherTier.length ? { other_plans_only: r.otherTier.map(fmt), other_plans_note: "These apply only to other plans than the customer's." } : {}),
      note,
    },
  };
}

const RefundArgs = z.object({
  invoice_id: z.string().trim().toUpperCase(),
  amount: z.number().positive().max(100_000).nullable(),
  reason: z.enum(['duplicate_charge', 'unused_service', 'charged_after_cancellation', 'billing_error', 'other']),
});

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Pure policy decision — unit-tested without any LLM. */
export function refundDecision(o: ReturnType<typeof overlay>, invoiceId: string): {
  kind: 'eligible' | 'needs_human' | 'not_eligible';
  amount: number;
  limit: number;
  rule: string;
  windowDays?: number;
  chargedDaysAgo?: number;
} {
  const { rec, invoices, recentRefunds } = o;
  const inv = invoices.find((i) => i.id === invoiceId);
  if (!inv) return { kind: 'not_eligible', amount: 0, limit: 0, rule: 'invoice_not_found' };
  if (inv.status === 'refunded') return { kind: 'not_eligible', amount: 0, limit: 0, rule: 'already_refunded' };
  if (inv.status === 'open') return { kind: 'not_eligible', amount: 0, limit: 0, rule: 'invoice_unpaid' };
  const rules = REFUND_RULES[rec.tier];
  if (rules.humanOnly) return { kind: 'needs_human', amount: inv.amount, limit: 0, rule: 'enterprise_contract' };
  if (rec.contract.status === 'past_due') return { kind: 'not_eligible', amount: 0, limit: 0, rule: 'account_past_due' };

  let amount = inv.amount;
  let limit = rules.agentLimitUsd;
  let rule: string;
  if (inv.duplicate_of) {
    limit = DUPLICATE_CHARGE_AGENT_LIMIT_USD;
    rule = 'duplicate_charge';
  } else if (rec.contract.status === 'cancelled' && rec.contract.cancelled_days_ago !== undefined && inv.days_ago < rec.contract.cancelled_days_ago) {
    rule = 'charged_after_cancellation';
  } else if (rec.tier === 'pro' && rec.billing_cycle === 'annual') {
    if (inv.days_ago > PRO_ANNUAL_PRORATION_WINDOW_DAYS) return { kind: 'not_eligible', amount: 0, limit, rule: 'outside_window', windowDays: PRO_ANNUAL_PRORATION_WINDOW_DAYS, chargedDaysAgo: inv.days_ago };
    const usedMonths = Math.max(1, Math.ceil(inv.days_ago / 30));
    amount = round2((PLAN_PRICES.pro.annual / 12) * (12 - usedMonths));
    rule = 'pro_annual_prorated';
  } else {
    if (inv.days_ago > rules.windowDays) return { kind: 'not_eligible', amount: 0, limit, rule: 'outside_window', windowDays: rules.windowDays, chargedDaysAgo: inv.days_ago };
    rule = `${rec.tier}_within_${rules.windowDays}_days`;
  }
  if (recentRefunds.length >= AGENT_REFUNDS_PER_30_DAYS) return { kind: 'needs_human', amount, limit, rule: 'refund_frequency_limit' };
  if (amount > limit) return { kind: 'needs_human', amount, limit, rule: 'above_support_limit' };
  return { kind: 'eligible', amount, limit, rule };
}

async function issueRefund(raw: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const a = RefundArgs.parse(raw);
  const cust = ctx.facts.customer;
  if (!cust) return { status: 'blocked', summary: 'Not verified', data: { error: 'customer_not_verified' } };
  if (!ctx.consultedDocs.has('refund-policy')) {
    return { status: 'blocked', summary: 'Refund policy not checked', data: { error: 'policy_check_required', hint: 'search_policies for the refund policy first' } };
  }
  const rec = ctx.customers.get(cust.id)!;
  const o = overlay(rec, ctx.facts, ctx.now);
  const d = refundDecision(o, a.invoice_id);
  if (d.kind === 'not_eligible') {
    return {
      status: 'blocked',
      summary: `Not eligible: ${d.rule.replace(/_/g, ' ')}${d.windowDays ? ` (charged ${d.chargedDaysAgo} days ago, window ${d.windowDays} days)` : ''}`,
      data: { refunded: false, invoice_id: a.invoice_id, policy_rule: d.rule, ...(d.windowDays ? { refund_window_days: d.windowDays, charged_days_ago: d.chargedDaysAgo } : {}), ...(d.rule === 'account_past_due' ? { balance_due_usd: rec.contract.balance_due } : {}) },
    };
  }
  if (d.kind === 'needs_human') {
    ctx.turn.requiresHuman.push(`refund_approval:${d.rule}`);
    return {
      status: 'blocked',
      summary: `Needs human approval (${d.rule.replace(/_/g, ' ')}, $${d.amount.toFixed(2)})`,
      data: { refunded: false, needs_human_approval: true, invoice_id: a.invoice_id, eligible_amount_usd: d.amount, support_limit_usd: d.limit, policy_rule: d.rule, next_step: 'create_escalation_ticket with reason refund_approval' },
      requiresHuman: 'refund_approval',
    };
  }
  if (a.amount !== null && a.amount > d.amount + 0.001) {
    return { status: 'blocked', summary: `Requested $${a.amount} > eligible $${d.amount}`, data: { refunded: false, error: 'amount_exceeds_eligible', eligible_amount_usd: d.amount } };
  }
  const amount = a.amount ?? d.amount;
  // ---- commit point: after this line the money has moved; aborts and retries must not redo it.
  const res = await ctx.ledger.commit({ key: `${ctx.sessionId}:${a.invoice_id}`, sessionId: ctx.sessionId, customerId: cust.id, invoiceId: a.invoice_id, amount, refundId: id('RF') });
  if (res.created) ctx.facts.refunds.push({ id: res.refundId, invoiceId: a.invoice_id, amount: res.amount, reason: a.reason, at: ctx.now });
  ctx.turn.refundCommitted = true;
  return {
    status: 'ok',
    summary: `${res.created ? 'Refunded' : 'Already refunded'} $${res.amount.toFixed(2)} on ${a.invoice_id} (${res.refundId})`,
    data: { refunded: true, refund_id: res.refundId, invoice_id: a.invoice_id, amount_usd: res.amount, policy_rule: d.rule, arrives: 'original payment method in 5-10 business days', idempotent_replay: !res.created },
  };
}

const UpdateArgs = z.object({ field: z.string().trim(), value: z.string().trim().min(1).max(200) });

async function updateAccountField(raw: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const a = UpdateArgs.parse(raw);
  const cust = ctx.facts.customer;
  if (!cust) return { status: 'blocked', summary: 'Not verified', data: { error: 'customer_not_verified' } };
  if (!(UPDATABLE_FIELDS as readonly string[]).includes(a.field)) {
    const security = /owner|login|email|password|plan|tier/i.test(a.field);
    return {
      status: 'blocked',
      summary: `Field "${a.field}" can't be changed by support`,
      data: { updated: false, error: 'field_not_updatable', allowed: UPDATABLE_FIELDS, ...(security ? { next_step: 'plan changes: workspace owner in Settings → Billing; owner email: security team via ticket' } : {}) },
    };
  }
  if (a.field === 'billing_email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.value)) return { status: 'blocked', summary: 'Invalid email', data: { updated: false, error: 'invalid_email' } };
  if (a.field === 'notification_preference' && !['email', 'sms', 'none'].includes(a.value)) return { status: 'blocked', summary: 'Invalid preference', data: { updated: false, error: 'invalid_value', allowed: ['email', 'sms', 'none'] } };
  const rec = ctx.customers.get(cust.id)!;
  const from = (overlay(rec, ctx.facts, ctx.now).account as Record<string, string>)[a.field] ?? '';
  ctx.facts.updatedFields.push({ field: a.field, from, to: a.value, at: ctx.now });
  return { status: 'ok', summary: `Updated ${a.field}`, data: { updated: true, field: a.field, from, to: a.value } };
}

const TicketArgs = z.object({
  reason: z.enum(['refund_approval', 'policy_exception', 'legal', 'frustrated_customer', 'low_confidence', 'verification_locked', 'account_security', 'customer_request', 'system_failure', 'other']),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  summary: z.string().trim().min(5).max(1000),
});

const FIRST_RESPONSE: Record<Tier | 'unknown', string> = { starter: 'within 48 hours', pro: 'within 24 hours', enterprise: 'within 1 hour', unknown: 'within 48 hours' };

export async function createTicket(raw: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const a = TicketArgs.parse(raw);
  if (ctx.turn.ticketCreated) {
    return { status: 'ok', summary: `Ticket ${ctx.turn.ticketCreated.id} already open`, data: { ticket_id: ctx.turn.ticketCreated.id, duplicate: true } };
  }
  const cust = ctx.facts.customer;
  // Steps come from the tool log (code), not from the model's memory of what it did.
  const stepsTaken = ctx.turn.toolLog.map((t) => `${t.name}: ${t.summary}`);
  const ticket: Ticket = { id: id('T'), reason: a.reason, priority: a.priority, summary: a.summary, customerId: cust?.id ?? null, stepsTaken, createdAt: ctx.now };
  ctx.facts.tickets.push(ticket);
  ctx.turn.ticketCreated = ticket;
  const enterprise = cust?.tier === 'enterprise';
  const billing = a.reason === 'refund_approval' && !enterprise;
  const queue = a.reason === 'legal' ? 'legal'
    : a.reason === 'account_security' || a.reason === 'verification_locked' ? 'security'
    : enterprise ? `account manager ${cust.account_manager ?? '(assigned)'} with the billing team`
    : billing ? 'billing' : 'support';
  return {
    status: 'ok',
    summary: `Ticket ${ticket.id} → ${queue} (${a.priority})`,
    data: { ticket_id: ticket.id, queue, handled_by: 'a human specialist (not the AI)', ...(enterprise && cust.account_manager ? { account_manager: cust.account_manager } : {}), expected_response: billing ? 'within 2 business days' : FIRST_RESPONSE[cust?.tier ?? 'unknown'] },
  };
}

const IMPL: Record<ToolName, (raw: unknown, ctx: ToolContext) => Promise<ToolOutcome>> = {
  verify_customer: verifyCustomer,
  search_policies: searchPolicies,
  issue_refund: issueRefund,
  update_account_field: updateAccountField,
  create_escalation_ticket: createTicket,
};

/** Tools that talk to the (mock) account system — what the chaos "tool failure" switch breaks. */
const ACCOUNT_SYSTEM: ToolName[] = ['verify_customer', 'issue_refund', 'update_account_field'];

export async function executeTool(name: ToolName, rawArgs: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  if (ACCOUNT_SYSTEM.includes(name)) {
    if (ctx.chaos.toolFailure === 'permanent') throw new ToolFailure('account system returned 503 (simulated outage)', false);
    if (ctx.chaos.toolFailure === 'transient' && !ctx.turn.chaosToolFailureUsed) {
      ctx.turn.chaosToolFailureUsed = true;
      throw new ToolFailure('account system timed out (simulated, transient)', true);
    }
  }
  let out: ToolOutcome;
  try {
    out = await IMPL[name](rawArgs, ctx);
  } catch (err) {
    if (err instanceof z.ZodError) {
      out = { status: 'error', summary: 'Invalid arguments', data: { error: 'invalid_arguments', issues: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) } };
    } else throw err;
  }
  ctx.turn.toolLog.push({ name, status: out.status, summary: out.summary, data: out.data });
  if (out.requiresHuman && !ctx.turn.requiresHuman.includes(out.requiresHuman)) ctx.turn.requiresHuman.push(out.requiresHuman);
  return out;
}
