import { describe, expect, it } from 'vitest';
import { emptyFacts, type CustomerRecord } from '@sa/shared';
import { availableTools, overlay, refundDecision } from '../packages/tools/src';
import { numericClaims, numbersIn } from '../packages/agent/src/guardrails';
import { chunkDocument } from '../packages/rag/src/chunker';
import { identifiers, keywordQuery } from '../packages/rag/src/retriever';
import { RateLimiter } from '../apps/api/src/ratelimit';

const NOW = Date.UTC(2026, 10, 22);
const base: CustomerRecord = {
  id: 'c1', name: 'T', email: 't@x.io', pin: '1234', company: 'X', tier: 'pro', billing_cycle: 'monthly',
  contract: { status: 'active', started_days_ago: 100 },
  invoices: [], refunds_last_30d: [],
  account: { billing_email: 't@x.io', company_name: 'X', invoice_address: 'a', notification_preference: 'email' },
};
const cust = (p: Partial<CustomerRecord>): CustomerRecord => ({ ...base, ...p, contract: { ...base.contract, ...p.contract } });
const inv = (id: string, amount: number, days_ago: number, extra: object = {}) => ({ id, amount, days_ago, description: id, status: 'paid' as const, ...extra });
const decide = (c: CustomerRecord, id: string) => refundDecision(overlay(c, emptyFacts(), NOW), id);

describe('refundDecision (money moves only if code agrees)', () => {
  it('pro monthly within 30 days, under the $250 limit → eligible', () => {
    expect(decide(cust({ invoices: [inv('A', 79, 9)] }), 'A')).toMatchObject({ kind: 'eligible', amount: 79 });
  });
  it('pro monthly outside 30 days → not eligible, with window details', () => {
    expect(decide(cust({ invoices: [inv('A', 79, 39)] }), 'A')).toMatchObject({ kind: 'not_eligible', rule: 'outside_window', windowDays: 30, chargedDaysAgo: 39 });
  });
  it('pro annual is prorated and goes to a human above $250', () => {
    const d = decide(cust({ billing_cycle: 'annual', invoices: [inv('A', 790, 20)] }), 'A');
    expect(d).toMatchObject({ kind: 'needs_human', rule: 'above_support_limit' });
    expect(d.amount).toBeCloseTo(724.17, 2);
  });
  it('enterprise is always human', () => {
    expect(decide(cust({ tier: 'enterprise', invoices: [inv('A', 1800, 3)] }), 'A').kind).toBe('needs_human');
  });
  it('past-due accounts get no refunds', () => {
    expect(decide(cust({ contract: { status: 'past_due', started_days_ago: 90 }, invoices: [inv('A', 79, 3)] }), 'A')).toMatchObject({ kind: 'not_eligible', rule: 'account_past_due' });
  });
  it('duplicate charges are refundable outside the window', () => {
    expect(decide(cust({ tier: 'starter', invoices: [inv('A', 19, 40), inv('B', 19, 40, { duplicate_of: 'A' })] }), 'B')).toMatchObject({ kind: 'eligible', rule: 'duplicate_charge' });
  });
  it('charges after cancellation are refundable', () => {
    expect(decide(cust({ tier: 'starter', contract: { status: 'cancelled', started_days_ago: 200, cancelled_days_ago: 20 }, invoices: [inv('A', 19, 6)] }), 'A')).toMatchObject({ kind: 'eligible', rule: 'charged_after_cancellation' });
  });
  it('second refund within 30 days needs a human', () => {
    expect(decide(cust({ invoices: [inv('A', 79, 4)], refunds_last_30d: [{ invoice_id: 'Z', amount: 79, days_ago: 10 }] }), 'A')).toMatchObject({ kind: 'needs_human', rule: 'refund_frequency_limit' });
  });
  it('a refund issued earlier in the session marks the invoice refunded', () => {
    const c = cust({ invoices: [inv('A', 79, 4)] });
    const facts = { ...emptyFacts(), refunds: [{ id: 'RF', invoiceId: 'A', amount: 79, reason: 'x', at: NOW }] };
    expect(refundDecision(overlay(c, facts, NOW), 'A')).toMatchObject({ kind: 'not_eligible', rule: 'already_refunded' });
  });
});

describe('availableTools (state gates the tool list, not the prompt)', () => {
  it('unverified sessions cannot refund or update', () => {
    expect(availableTools({ facts: emptyFacts(), consultedDocs: new Set() })).toEqual(['verify_customer', 'search_policies', 'create_escalation_ticket']);
  });
  it('locked verification removes verify_customer', () => {
    expect(availableTools({ facts: { ...emptyFacts(), verifyFailures: 3 }, consultedDocs: new Set() })).not.toContain('verify_customer');
  });
  it('issue_refund appears only after the refund policy was consulted', () => {
    const facts = { ...emptyFacts(), customer: { id: 'c1', name: 'T', email: 't', company: 'X', tier: 'pro' as const, billing_cycle: 'monthly' as const, contract_status: 'active' as const } };
    expect(availableTools({ facts, consultedDocs: new Set() })).not.toContain('issue_refund');
    expect(availableTools({ facts, consultedDocs: new Set(['refund-policy']) })).toContain('issue_refund');
  });
});

describe('number provenance', () => {
  it('extracts claims but ignores identifiers and emails', () => {
    expect(numericClaims('Refunded $1,800.00 on INV-1042 (E-4410) for a2@b.io within 30 days, 99.95% uptime')).toEqual(['1800', '30', '99.95']);
  });
  it('normalises numbers in sources', () => {
    const s = numbersIn('Support can refund up to $250 immediately; Enterprise 1,500/mo');
    expect(s.has('250')).toBe(true);
    expect(s.has('1500')).toBe(true);
  });
});

describe('chunker', () => {
  const md = `---\nid: d\ntitle: Doc\ndoc_type: policy\ntiers: [all]\n---\n# Doc\n\n## Pro plans\n<!-- tiers: pro -->\nPro monthly charges can be refunded within 30 days.\n\n### Annual\nProrated within 60 days.\n\n## Limits\n\n| Plan | Requests/min |\n|---|---|\n| Starter | 60 |\n| Pro | 600 |\n`;
  const chunks = chunkDocument(md);
  it('keeps the breadcrumb and section tiers, subsections inherit', () => {
    expect(chunks[0]).toMatchObject({ sectionPath: 'Pro plans', tiers: ['pro'] });
    expect(chunks[0]!.content.startsWith('Doc > Pro plans')).toBe(true);
    expect(chunks[1]).toMatchObject({ sectionPath: 'Pro plans > Annual', tiers: ['pro'] });
  });
  it('splits tables into self-contained rows with headers', () => {
    const rows = chunks.filter((c) => c.kind === 'table_row');
    expect(rows.map((r) => r.content.split('\n\n')[1])).toEqual(['Plan: Starter | Requests/min: 60', 'Plan: Pro | Requests/min: 600']);
  });
});

describe('keywordQuery', () => {
  it('ORs meaningful terms and drops stopwords', () => {
    expect(keywordQuery('What does error E-4410 mean on my plan?')).toBe('error | 4410 | mean | plan');
  });
});

describe('identifiers (exact-match confidence)', () => {
  it('normalises error codes', () => {
    expect(identifiers('what is error e4410, and E-2210?')).toEqual(['E-4410', 'E-2210']);
    expect(identifiers('How do refunds work?')).toEqual([]);
  });
});

describe('RateLimiter', () => {
  it('allows the burst then asks to wait', () => {
    const rl = RateLimiter.perMinute(2);
    expect(rl.take('ip')).toBe(0);
    expect(rl.take('ip')).toBe(0);
    expect(rl.take('ip')).toBeGreaterThan(0);
    expect(rl.take('other')).toBe(0);
  });
});
