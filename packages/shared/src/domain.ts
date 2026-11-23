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
