'use client';
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, CircleAlert, Headset, Plus, RotateCw, Ticket as TicketIcon, WifiOff } from 'lucide-react';
import type { Ticket } from '@sa/shared';
import type { TurnError } from '@/lib/turnActivity';
import { humanize } from '@/lib/format';
import { Badge, buttonClasses, type Tone } from '@/components/ui/primitives';

const PRIORITY_TONE: Record<Ticket['priority'], Tone> = { low: 'neutral', normal: 'info', high: 'warn', urgent: 'bad' };

export function TicketCard({ ticket }: { ticket: Ticket }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="animate-fade-in ml-9 rounded-xl border border-esc/30 bg-esc-soft/60 p-3" role="status" aria-label={`Ticket ${ticket.id} created`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid size-6 place-items-center rounded-md bg-esc text-white">
          <TicketIcon aria-hidden className="size-3.5" />
        </span>
        <span className="text-[13px] font-semibold text-esc-ink">Ticket {ticket.id} created</span>
        <Badge tone={PRIORITY_TONE[ticket.priority]}>{humanize(ticket.priority)} priority</Badge>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted">Reason</dt>
        <dd className="text-fg-2">{humanize(ticket.reason)}</dd>
        <dt className="text-muted">Summary</dt>
        <dd className="text-fg-2">{ticket.summary}</dd>
      </dl>
      {ticket.stepsTaken.length ? (
        <div className="mt-2">
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center gap-1 text-xs font-medium text-esc-ink">
            {open ? <ChevronDown aria-hidden className="size-3" /> : <ChevronRight aria-hidden className="size-3" />}
            Steps already taken ({ticket.stepsTaken.length})
          </button>
          {open ? (
            <ol className="mt-1 list-decimal space-y-0.5 pl-8 text-xs text-fg-2">
              {ticket.stepsTaken.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function useCountdown(untilMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (untilMs === null || untilMs <= Date.now()) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [untilMs]);
  return untilMs === null ? 0 : Math.max(0, Math.ceil((untilMs - now) / 1000));
}

const TITLE: Partial<Record<TurnError['code'], string>> = {
  llm_timeout: 'Nova timed out',
  llm_rate_limited: 'Nova is rate limited',
  llm_unavailable: 'Reasoning service unavailable',
  tool_failed: 'A system Nova needs is down',
  retrieval_unavailable: 'Knowledge base unavailable',
  budget_exceeded: 'Demo budget reached',
  rate_limited: 'Slow down a little',
  network: 'Connection lost',
  not_found: 'Conversation not found',
};

export function ErrorCard({
  error,
  actionable,
  onRetry,
  onHuman,
  onNewConversation,
}: {
  error: TurnError;
  /** Only the latest failed turn offers buttons. */
  actionable: boolean;
  onRetry: () => void;
  onHuman: () => void;
  onNewConversation: () => void;
}) {
  const wait = useCountdown(error.retryAfterMs ? error.at + error.retryAfterMs : null);
  const Icon = error.code === 'network' ? WifiOff : CircleAlert;
  const canHuman = error.code !== 'budget_exceeded' && error.code !== 'not_found';
  return (
    <div role="alert" className="animate-fade-in ml-9 rounded-xl border border-bad/30 bg-bad-soft/60 p-3">
      <div className="flex items-start gap-2">
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-bad" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold text-bad-ink">{TITLE[error.code] ?? 'Something went wrong'}</span>
            <code className="rounded bg-surface/70 px-1 font-mono text-[10.5px] text-muted">{error.code}</code>
          </div>
          <p className="mt-0.5 text-[13px] text-fg-2">{error.message}</p>
          {actionable ? (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {error.code === 'not_found' ? (
                <button type="button" className={buttonClasses.primary} onClick={onNewConversation}>
                  <Plus aria-hidden className="size-3.5" /> New conversation
                </button>
              ) : null}
              {error.retryable ? (
                <button type="button" className={buttonClasses.primary} onClick={onRetry} disabled={wait > 0}>
                  <RotateCw aria-hidden className="size-3.5" />
                  {wait > 0 ? `Retry in ${wait}s` : 'Retry'}
                </button>
              ) : null}
              {canHuman ? (
                <button type="button" className={buttonClasses.secondary} onClick={onHuman}>
                  <Headset aria-hidden className="size-3.5" /> Talk to a human
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
