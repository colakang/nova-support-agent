// Single source of truth for the business rules the tools ENFORCE.
// The policy documents in data/corpus describe the same rules in prose; the agent reads those,
// but money only moves if this code agrees. Prompts can be talked around; this file cannot.
import type { Tier } from '@sa/shared';

export const COMPANY = 'Northstar';

export const PLAN_PRICES = {
  starter: { monthly: 19 },
  pro: { monthly: 79, annual: 790 },
  enterprise: { monthlyFrom: 1500 },
} as const;

export interface RefundRule {
  /** Days after the charge during which a standard refund is allowed. */
  windowDays: number;
  /** Max amount the AI agent may refund on its own; above this a human approves. */
  agentLimitUsd: number;
  /** Enterprise refunds are governed by the signed contract → always a human. */
  humanOnly: boolean;
}

export const REFUND_RULES: Record<Tier, RefundRule> = {
  starter: { windowDays: 14, agentLimitUsd: 19, humanOnly: false },
  pro: { windowDays: 30, agentLimitUsd: 250, humanOnly: false },
  enterprise: { windowDays: 0, agentLimitUsd: 0, humanOnly: true },
};

/** Duplicate charges: refundable on any tier regardless of the window, agent may handle up to this amount. */
export const DUPLICATE_CHARGE_AGENT_LIMIT_USD = 500;

/** Pro annual: prorated refund of unused full months, only within this many days of the annual charge. */
export const PRO_ANNUAL_PRORATION_WINDOW_DAYS = 60;

/** At most this many agent-issued refunds per customer per rolling 30 days. */
export const AGENT_REFUNDS_PER_30_DAYS = 1;

/** Fields the agent may change after verification. Everything else (plan, owner email, …) → human. */
export const UPDATABLE_FIELDS = ['billing_email', 'company_name', 'invoice_address', 'notification_preference'] as const;
export type UpdatableField = (typeof UPDATABLE_FIELDS)[number];

/** Identity verification: email + 4-digit support PIN. Locked after this many failures in a session. */
export const MAX_VERIFY_FAILURES = 3;

/** Across ALL sessions: failed PIN attempts per account (email) per hour before verification locks.
 *  Without this, an attacker opens new sessions to brute-force a 4-digit PIN. */
export const ACCOUNT_VERIFY_FAILURES_PER_HOUR = 5;

/** A quote / proposal must be confirmed within this window, in a later message than the one that showed it. */
export const PENDING_ACTION_TTL_MS = 15 * 60_000;

/** Escalation red lines (deterministic, checked in code before/after the LLM). */
export const LEGAL_RE = /\b(lawyer|attorney|sue|suing|lawsuit|legal action|small claims|chargeback|dispute (the|this) charge|bbb|better business bureau|regulator|ftc|gdpr complaint)\b/i;
/** Second frustrated message in a session → hand to a human. */
export const FRUSTRATION_ESCALATE_AT = 2;
