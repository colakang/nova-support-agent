// Mock customer system. Fixtures are read-only; everything a session changes (refunds, field
// updates) lives in that session's facts and is overlaid on read. Every reviewer gets a clean
// "Maya" without us resetting a shared database.
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { CustomerRecord, type CustomerView, type SessionFacts } from '@sa/shared';
import { dataPath } from '@sa/shared/env';

export interface InvoiceView {
  id: string;
  amount: number;
  date: string;
  days_ago: number;
  description: string;
  status: 'paid' | 'refunded' | 'open';
  duplicate_of?: string;
}

export interface CustomerDirectory {
  findByEmail(email: string): CustomerRecord | undefined;
  get(id: string): CustomerRecord | undefined;
  all(): CustomerRecord[];
}

export function loadCustomers(file = dataPath('fixtures', 'customers.json')): CustomerDirectory {
  const list = z.array(CustomerRecord).parse(JSON.parse(readFileSync(file, 'utf8')));
  const byEmail = new Map(list.map((c) => [c.email.toLowerCase(), c]));
  const byId = new Map(list.map((c) => [c.id, c]));
  return {
    findByEmail: (email) => byEmail.get(email.trim().toLowerCase()),
    get: (id) => byId.get(id),
    all: () => list,
  };
}

const DAY = 86_400_000;
const isoDay = (now: number, daysAgo: number) => new Date(now - daysAgo * DAY).toISOString().slice(0, 10);

/** Fixture + this session's changes. */
export function overlay(rec: CustomerRecord, facts: SessionFacts, now: number) {
  const refundedHere = new Map(facts.refunds.map((r) => [r.invoiceId, r]));
  const invoices: InvoiceView[] = rec.invoices.map((inv) => ({
    id: inv.id,
    amount: inv.amount,
    date: isoDay(now, inv.days_ago),
    days_ago: inv.days_ago,
    description: inv.description,
    status: refundedHere.has(inv.id) ? 'refunded' : inv.status,
    ...(inv.duplicate_of ? { duplicate_of: inv.duplicate_of } : {}),
  }));
  const account = { ...rec.account };
  for (const u of facts.updatedFields) (account as Record<string, string>)[u.field] = u.to;
  const recentRefunds = [
    ...rec.refunds_last_30d.map((r) => ({ invoice_id: r.invoice_id, amount: r.amount, days_ago: r.days_ago })),
    ...facts.refunds.map((r) => ({ invoice_id: r.invoiceId, amount: r.amount, days_ago: Math.floor((now - r.at) / DAY) })),
  ].filter((r) => r.days_ago <= 30);
  return { rec, invoices, account, recentRefunds };
}

export function toView(rec: CustomerRecord): CustomerView {
  return {
    id: rec.id,
    name: rec.name,
    email: rec.email,
    company: rec.company,
    tier: rec.tier,
    billing_cycle: rec.billing_cycle,
    contract_status: rec.contract.status,
    ...(rec.contract.balance_due !== undefined ? { balance_due: rec.contract.balance_due } : {}),
    ...(rec.contract.account_manager ? { account_manager: rec.contract.account_manager } : {}),
  };
}
