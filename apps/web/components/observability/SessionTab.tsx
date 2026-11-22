'use client';
import type { ReactNode } from 'react';
import type { SessionView } from '@sa/shared';
import { fmtMoney, fmtTime, humanize } from '@/lib/format';
import { Badge } from '@/components/ui/primitives';
import { CopyButton, JsonBlock, SectionTitle, Stat } from './bits';

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{k}</dt>
      <dd className="min-w-0 truncate text-fg-2">{v}</dd>
    </>
  );
}

export function SessionTab({ session }: { session: SessionView | null }) {
  if (!session) return <p className="px-2 py-10 text-center text-xs text-muted">Loading session…</p>;
  const f = session.facts;
  const c = f.customer;
  const chaosOn = Object.entries(session.chaos).filter(([, v]) => v !== false && v !== 'none');
  return (
    <div className="text-[12.5px]">
      <SectionTitle right={<CopyButton text={session.id} label="Copy id" />}>Session</SectionTitle>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <Row k="id" v={<span className="font-mono">{session.id}</span>} />
        <Row k="state" v={<Badge tone={session.state === 'escalated' ? 'esc' : 'ok'}>{session.state}</Badge>} />
        <Row k="started" v={`${new Date(session.createdAt).toLocaleDateString()} ${fmtTime(session.createdAt)}`} />
        <Row k="messages" v={session.messages.length} />
        <Row k="chaos" v={chaosOn.length ? chaosOn.map(([k, v]) => (v === true ? k : `${k}=${String(v)}`)).join(', ') : 'off'} />
      </dl>

      <SectionTitle>Customer</SectionTitle>
      {c ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <Row k="name" v={c.name} />
          <Row k="email" v={c.email} />
          <Row k="company" v={c.company} />
          <Row k="tier" v={<Badge tone="accent">{c.tier}</Badge>} />
          <Row k="billing" v={c.billing_cycle} />
          <Row k="contract" v={humanize(c.contract_status)} />
          {c.balance_due ? <Row k="balance due" v={fmtMoney(c.balance_due)} /> : null}
          {c.account_manager ? <Row k="account mgr" v={c.account_manager} /> : null}
          <Row k="customer id" v={<span className="font-mono">{c.id}</span>} />
        </dl>
      ) : (
        <p className="text-muted">Not verified yet.</p>
      )}

      <SectionTitle>Signals</SectionTitle>
      <div className="grid grid-cols-3 gap-1.5">
        <Stat label="Verify fails" value={f.verifyFailures} />
        <Stat label="Frustration" value={f.frustration} />
        <Stat label="Docs read" value={f.consultedDocs.length} />
      </div>
      {f.consultedDocs.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {f.consultedDocs.map((d) => (
            <Badge key={d}>{d}</Badge>
          ))}
        </div>
      ) : null}

      <SectionTitle>Refunds ({f.refunds.length})</SectionTitle>
      {f.refunds.length ? (
        <table className="w-full text-left">
          <thead className="text-[10.5px] uppercase tracking-wide text-faint">
            <tr>
              <th className="pb-1 font-medium">Invoice</th>
              <th className="pb-1 font-medium">Amount</th>
              <th className="pb-1 font-medium">Reason</th>
            </tr>
          </thead>
          <tbody>
            {f.refunds.map((r) => (
              <tr key={r.id} className="border-t border-line align-top">
                <td className="py-1 font-mono">{r.invoiceId}</td>
                <td className="py-1 tabular-nums">{fmtMoney(r.amount)}</td>
                <td className="py-1 text-fg-2">{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-muted">None.</p>
      )}

      <SectionTitle>Tickets ({f.tickets.length})</SectionTitle>
      {f.tickets.length ? (
        <ul className="space-y-1.5">
          {f.tickets.map((t) => (
            <li key={t.id} className="rounded-lg border border-line p-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono font-semibold text-esc-ink">{t.id}</span>
                <Badge tone="esc">{humanize(t.reason)}</Badge>
                <Badge tone={t.priority === 'urgent' ? 'bad' : t.priority === 'high' ? 'warn' : 'neutral'}>{t.priority}</Badge>
              </div>
              <p className="mt-1 text-fg-2">{t.summary}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">None.</p>
      )}

      {f.updatedFields.length ? (
        <>
          <SectionTitle>Account changes</SectionTitle>
          <ul className="space-y-1">
            {f.updatedFields.map((u, i) => (
              <li key={i} className="text-fg-2">
                <span className="font-mono">{u.field}</span>: <span className="text-muted line-through">{u.from}</span> → {u.to}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <SectionTitle>Raw facts</SectionTitle>
      <JsonBlock value={f} maxHeight="max-h-72" label="Session facts JSON" />
    </div>
  );
}
