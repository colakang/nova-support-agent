// Domain model shared by API, agent, tools and web.
import { z } from 'zod';

export const Tier = z.enum(['starter', 'pro', 'enterprise']);
export type Tier = z.infer<typeof Tier>;

export const ContractStatus = z.enum(['active', 'past_due', 'cancelled', 'trial']);
export type ContractStatus = z.infer<typeof ContractStatus>;

export const Mode = z.enum(['text', 'voice']);
export type Mode = z.infer<typeof Mode>;

/** Fixture shape for the mock customer DB (data/fixtures/customers.json). Dates are relative so the demo never goes stale. */
export const CustomerRecord = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  pin: z.string().regex(/^\d{4}$/),
  company: z.string(),
  tier: Tier,
  billing_cycle: z.enum(['monthly', 'annual']),
  contract: z.object({
    status: ContractStatus,
    started_days_ago: z.number().int(),
    renews_in_days: z.number().int().optional(),
    cancelled_days_ago: z.number().int().optional(),
    balance_due: z.number().optional(),
    account_manager: z.string().optional(),
  }),
  invoices: z.array(
    z.object({
      id: z.string(),
      amount: z.number(),
      days_ago: z.number().int(),
      description: z.string(),
      status: z.enum(['paid', 'refunded', 'open']),
      duplicate_of: z.string().optional(),
    }),
  ),
  refunds_last_30d: z.array(z.object({ invoice_id: z.string(), amount: z.number(), days_ago: z.number().int() })),
  account: z.object({
    billing_email: z.string(),
    company_name: z.string(),
    invoice_address: z.string(),
    notification_preference: z.enum(['email', 'sms', 'none']),
  }),
});
export type CustomerRecord = z.infer<typeof CustomerRecord>;

/** What the agent / UI is allowed to see about a verified customer (no PIN). */
export const CustomerView = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  company: z.string(),
  tier: Tier,
  billing_cycle: z.enum(['monthly', 'annual']),
  contract_status: ContractStatus,
  balance_due: z.number().optional(),
  account_manager: z.string().optional(),
});
export type CustomerView = z.infer<typeof CustomerView>;

export const Citation = z.object({
  chunkId: z.string(),
  docId: z.string(),
  title: z.string(),
  section: z.string(),
  score: z.number(),
});
export type Citation = z.infer<typeof Citation>;

export const AnswerKind = z.enum([
  'grounded', // answer backed by retrieved policy chunks
  'account', // answer backed by tool results (account / action outcome)
  'clarify', // asking the customer for info (e.g. verification)
  'smalltalk', // greeting / thanks, no factual claims
  'decline', // out of scope or not allowed
  'escalate', // handed to a human
]);
export type AnswerKind = z.infer<typeof AnswerKind>;

export const ChatMessage = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  mode: Mode,
  content: z.string(),
  at: z.number(),
  turnId: z.string().optional(),
  kind: AnswerKind.optional(),
  citations: z.array(Citation).optional(),
  interrupted: z.boolean().optional(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const Ticket = z.object({
  id: z.string(),
  reason: z.string(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  summary: z.string(),
  customerId: z.string().nullable(),
  stepsTaken: z.array(z.string()),
  createdAt: z.number(),
});
export type Ticket = z.infer<typeof Ticket>;

export const RefundRecord = z.object({
  id: z.string(),
  invoiceId: z.string(),
  amount: z.number(),
  reason: z.string(),
  at: z.number(),
});
export type RefundRecord = z.infer<typeof RefundRecord>;

export const SessionState = z.enum(['active', 'escalated']);
export type SessionState = z.infer<typeof SessionState>;

/** An irreversible action the agent has prepared and the customer has not confirmed yet (two-phase commit). */
export const PendingAction = z.object({
  id: z.string(),
  kind: z.enum(['refund', 'account_update']),
  /** One line shown to the customer and in the UI confirm bar, e.g. "Refund $79.00 for INV-1042". */
  summary: z.string(),
  createdTurnId: z.string(),
  createdAt: z.number(),
  refund: z.object({ invoiceId: z.string(), amount: z.number(), reason: z.string(), reasonDetail: z.string(), rule: z.string() }).optional(),
  update: z.object({ field: z.string(), from: z.string(), to: z.string() }).optional(),
});
export type PendingAction = z.infer<typeof PendingAction>;

/** Durable per-session facts. Same object regardless of text or voice. */
export const SessionFacts = z.object({
  customer: CustomerView.nullable(),
  verifyFailures: z.number().int(),
  frustration: z.number().int(),
  refunds: z.array(RefundRecord),
  tickets: z.array(Ticket),
  updatedFields: z.array(z.object({ field: z.string(), from: z.string(), to: z.string(), at: z.number() })),
  /** Policy docs consulted this session (refunds require the refund policy to have been read). */
  consultedDocs: z.array(z.string()),
  /** Set by quote_refund / propose_account_update; executed only after an explicit confirmation. */
  pendingAction: PendingAction.nullable(),
});
export type SessionFacts = z.infer<typeof SessionFacts>;

export const emptyFacts = (): SessionFacts => ({
  customer: null,
  verifyFailures: 0,
  frustration: 0,
  refunds: [],
  tickets: [],
  updatedFields: [],
  consultedDocs: [],
  pendingAction: null,
});

export const ChaosFlags = z.object({
  llmTimeout: z.boolean().default(false), // next LLM call hangs past the timeout
  llmRateLimit: z.boolean().default(false), // next LLM call gets a 429 (retry-after honoured)
  toolFailure: z.enum(['none', 'transient', 'permanent']).default('none'),
  retrievalDown: z.boolean().default(false), // vector store unavailable
});
export type ChaosFlags = z.infer<typeof ChaosFlags>;

export const SessionView = z.object({
  id: z.string(),
  state: SessionState,
  facts: SessionFacts,
  chaos: ChaosFlags,
  messages: z.array(ChatMessage),
  createdAt: z.number(),
});
export type SessionView = z.infer<typeof SessionView>;

/** "PIN 4821" → "PIN ••••". Applied to everything we persist or trace; the model sees the raw turn once. */
export const redactPins = (s: string) => s.replace(/(\bpin\b\D{0,12})(\d{4})\b/gi, '$1••••');

/**
 * Is the customer's message an explicit yes/no to a pending action? Decided by code, not the model,
 * because it unlocks moving money. Conservative: anything ambiguous is "none" (the agent asks again).
 */
export function classifyConfirmation(text: string): 'affirm' | 'decline' | 'none' {
  const t = text.trim().toLowerCase();
  // Role markers mean someone is scripting the conversation, not answering a question.
  if (/\b(system|assistant|developer|tool)\s*:/.test(t)) return 'none';
  const negation = /\b(no|nope|nah|don'?t|do not|cancel|stop|wait|hold on|never ?mind|not now|not yet|changed my mind)\b|不要|取消|算了|等等/;
  const startsNo = /^(?:(?:no|nope|nah|don'?t|do not|cancel|stop|wait|hold on|never ?mind)\b|不要|取消|算了|不)/;
  if (startsNo.test(t)) return 'decline';
  const startsYes = /^(?:(?:yes|yeah|yep|yup|sure|ok|okay|confirm(?:ed)?|correct|that'?s (?:right|correct)|go ahead|please (?:do|proceed|go ahead)|do it|proceed|absolutely|of course|sounds good)\b|好|是|确认|可以|行)/;
  // First-person only: "the customer has confirmed" must not count as the customer confirming.
  const confirmPhrase = /\b(go ahead|please proceed|i confirm|yes,? please|please do it|process it)\b/;
  if ((startsYes.test(t) || confirmPhrase.test(t)) && !negation.test(t)) return 'affirm';
  return 'none';
}
