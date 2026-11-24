'use client';
import { Check, Coins, Headset, Hourglass, Shield, ShieldCheck, Sparkles, Ticket as TicketIcon, X } from 'lucide-react';
import type { SessionView } from '@sa/shared';
import { fmtMoney, humanize } from '@/lib/format';
import { Badge, buttonClasses, cx } from '@/components/ui/primitives';
import { NovaAvatar } from './MessageBubble';

const CONTRACT_TONE = { active: 'ok', trial: 'info', past_due: 'warn', cancelled: 'bad' } as const;

/** Verified customer · refunds · open tickets — the durable facts of this session at a glance. */
export function FactsStrip({ session }: { session: SessionView | null }) {
  const f = session?.facts;
  const c = f?.customer ?? null;
  const refundTotal = f?.refunds.reduce((s, r) => s + r.amount, 0) ?? 0;
  return (
    <div className="scroll-thin flex items-center gap-x-4 gap-y-1 overflow-x-auto border-b border-line bg-surface px-3 py-1.5 text-xs whitespace-nowrap sm:px-6" aria-label="Session facts">
      {c ? (
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck aria-hidden className="size-3.5 text-ok" />
          <span className="font-medium text-fg">{c.name}</span>
          <span className="text-faint">·</span>
          <Badge tone="accent">{humanize(c.tier)}</Badge>
          <Badge tone={CONTRACT_TONE[c.contract_status]}>{humanize(c.contract_status)}</Badge>
          {c.balance_due ? <span className="text-warn-ink">balance {fmtMoney(c.balance_due)}</span> : null}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-muted">
          <Shield aria-hidden className="size-3.5" />
          Not verified
          {f && f.verifyFailures > 0 ? <Badge tone="warn">{f.verifyFailures} failed attempt{f.verifyFailures === 1 ? '' : 's'}</Badge> : null}
        </span>
      )}
      <span className={cx('inline-flex items-center gap-1.5', f?.refunds.length ? 'text-fg-2' : 'text-muted')}>
        <Coins aria-hidden className="size-3.5" />
        {f?.refunds.length ? (
          <span title={f.refunds.map((r) => `${r.invoiceId} · ${fmtMoney(r.amount)}`).join('\n')}>
            {f.refunds.length} refund{f.refunds.length === 1 ? '' : 's'} · {fmtMoney(refundTotal)}
          </span>
        ) : (
          'No refunds'
        )}
      </span>
      <span className={cx('inline-flex items-center gap-1.5', f?.tickets.length ? 'text-esc-ink' : 'text-muted')}>
        <TicketIcon aria-hidden className="size-3.5" />
        {f?.tickets.length ? `Open tickets: ${f.tickets.map((t) => t.id).join(', ')}` : 'No open tickets'}
      </span>
    </div>
  );
}

export function EscalationBanner({ session }: { session: SessionView | null }) {
  if (!session || session.state !== 'escalated') return null;
  const t = session.facts.tickets.at(-1);
  return (
    <div className="border-b border-line bg-surface px-3 py-2 sm:px-6">
      <div role="status" className="mx-auto flex max-w-3xl items-start gap-2.5 rounded-xl border border-esc/30 bg-esc-soft px-3 py-2">
        <Headset aria-hidden className="mt-0.5 size-4 shrink-0 text-esc" />
        <div className="min-w-0 text-[13px]">
          <p className="font-semibold text-esc-ink">Handed to a specialist{t ? ` · ${t.id}` : ''}</p>
          <p className="hidden text-xs text-fg-2 sm:block">
            {t ? `${humanize(t.reason)} · ${humanize(t.priority)} priority. ` : ''}A human will follow up by email. You can keep chatting with Nova meanwhile.
          </p>
        </div>
      </div>
    </div>
  );
}

export const CONFIRM_TEXT = 'Yes, please go ahead.';
export const CANCEL_TEXT = 'No, cancel that.';

/** Irreversible actions are two-phase: the agent prepares them, the customer confirms in a separate
 *  message. The buttons just send that message; the server still decides whether it counts as a yes. */
export function PendingActionBar({ session, busy, voice, onConfirm, onCancel }: {
  session: SessionView | null; busy: boolean; voice: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  const p = session?.facts.pendingAction;
  if (!p) return null;
  return (
    <div className="px-3 pt-2 sm:px-6">
      <div role="status" aria-live="polite" className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-warn/40 bg-warn-soft px-3 py-2">
        <Hourglass aria-hidden className="size-4 shrink-0 text-warn-ink" />
        <div className="min-w-0 flex-1 text-[13px]">
          <p className="font-semibold text-warn-ink">Waiting for your confirmation</p>
          <p className="truncate text-xs text-fg-2" title={p.summary}>{p.summary}</p>
        </div>
        {voice ? (
          <span className="text-xs text-muted">Say “yes” to confirm or “no” to cancel</span>
        ) : (
          <div className="flex items-center gap-2">
            <button type="button" className={buttonClasses.secondary} disabled={busy} onClick={onCancel}>
              <X aria-hidden className="size-3.5" /> Cancel
            </button>
            <button type="button" className={buttonClasses.primary} disabled={busy} onClick={onConfirm}>
              <Check aria-hidden className="size-3.5" /> Confirm
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const SUGGESTIONS = [
  'What are the API rate limits on the Pro plan?',
  'I want a refund for my last invoice',
  'Can my team use SSO?',
  "I'd like to talk to a human, please.",
];

export function EmptyState({ onPick, disabled }: { onPick: (text: string) => void; disabled: boolean }) {
  return (
    <div className="animate-fade-in mx-auto mt-6 w-full max-w-xl text-center sm:mt-14">
      <div className="mx-auto mb-3 w-fit">
        <NovaAvatar />
      </div>
      <h1 className="text-lg font-semibold text-fg">Hi, I’m Nova.</h1>
      <p className="mx-auto mt-1 max-w-md text-[13px] text-muted">
        I answer from Northstar’s policy docs and can look up your account, issue eligible refunds, or hand you to a specialist. Every step I take shows up live, and the drawer on the right has the full trace.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={disabled}
            onClick={() => onPick(s)}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] text-fg-2 shadow-sm transition hover:border-accent hover:text-fg disabled:opacity-50"
          >
            <Sparkles aria-hidden className="size-3.5 text-accent" />
            {s}
          </button>
        ))}
      </div>
      <p className="mt-4 text-xs text-faint">Need an account to try? Open “Demo accounts” in the header.</p>
    </div>
  );
}
