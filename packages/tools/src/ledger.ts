// Idempotency for the one irreversible action. Key = session + invoice: a retried, replayed or
// interrupted-then-resent refund can never pay out twice.
import type { Sql } from 'postgres';

export interface RefundLedger {
  commit(rec: { key: string; sessionId: string; customerId: string; invoiceId: string; amount: number; refundId: string }): Promise<{ refundId: string; amount: number; created: boolean }>;
}

export function pgRefundLedger(sql: Sql): RefundLedger {
  return {
    async commit(r) {
      const inserted = await sql<{ refund_id: string; amount: string }[]>`
        insert into refunds (idempotency_key, session_id, customer_id, invoice_id, amount, refund_id)
        values (${r.key}, ${r.sessionId}, ${r.customerId}, ${r.invoiceId}, ${r.amount}, ${r.refundId})
        on conflict (idempotency_key) do nothing
        returning refund_id, amount`;
      if (inserted.length) return { refundId: inserted[0]!.refund_id, amount: Number(inserted[0]!.amount), created: true };
      const [prev] = await sql<{ refund_id: string; amount: string }[]>`select refund_id, amount from refunds where idempotency_key = ${r.key}`;
      return { refundId: prev!.refund_id, amount: Number(prev!.amount), created: false };
    },
  };
}

export function memoryRefundLedger(): RefundLedger {
  const m = new Map<string, { refundId: string; amount: number }>();
  return {
    async commit(r) {
      const prev = m.get(r.key);
      if (prev) return { ...prev, created: false };
      m.set(r.key, { refundId: r.refundId, amount: r.amount });
      return { refundId: r.refundId, amount: r.amount, created: true };
    },
  };
}
