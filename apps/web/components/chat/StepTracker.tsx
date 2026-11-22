'use client';
// Live step tracker for one agent turn (chat and voice consults share it).
// Tool steps are first-class rows; LLM steps are lighter and fold their detail away.
import { useEffect, useState } from 'react';
import { Ban, Check, ChevronDown, ChevronRight, RotateCw, Sparkles, X } from 'lucide-react';
import type { StepState, TurnActivity } from '@/lib/turnActivity';
import { fmtMs } from '@/lib/format';
import { Spinner, cx } from '@/components/ui/primitives';
import { GuardrailChips } from './GuardrailChips';

function useTicker(active: boolean, everyMs = 200): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(t);
  }, [active, everyMs]);
  return now;
}

function StatusIcon({ status, light }: { status: StepState['status']; light?: boolean }) {
  const box = light ? 'size-4' : 'size-[18px]';
  if (status === 'running')
    return (
      <span className={cx('grid place-items-center text-accent', box)}>
        <Spinner className={light ? 'size-3' : 'size-3.5'} />
      </span>
    );
  if (status === 'ok')
    return (
      <span className={cx('grid place-items-center rounded-full', box, light ? 'text-ok' : 'bg-ok-soft text-ok')}>
        <Check aria-hidden className={light ? 'size-3' : 'size-3'} strokeWidth={3} />
      </span>
    );
  if (status === 'blocked')
    return (
      <span className={cx('grid place-items-center rounded-full bg-warn-soft text-warn', box)}>
        <Ban aria-hidden className="size-3" strokeWidth={2.5} />
      </span>
    );
  return (
    <span className={cx('grid place-items-center rounded-full bg-bad-soft text-bad', box)}>
      <X aria-hidden className="size-3" strokeWidth={3} />
    </span>
  );
}

const statusWord: Record<StepState['status'], string> = { running: 'in progress', ok: 'done', blocked: 'blocked', error: 'failed' };

/** "rate limited (429), retry-after 1.5s" → "rate limited (429), retrying in 1.5s" */
function retryText(r: StepState['retries'][number]): string {
  const reason = r.reason.replace(/,?\s*retry-after\s+[\d.]+\s*m?s/i, '').replace(/\.$/, '');
  const wait = r.waitMs <= 0 ? 'retrying now' : `retrying in ${r.waitMs >= 1000 ? `${(r.waitMs / 1000).toFixed(1)}s` : `${r.waitMs}ms`}`;
  return `${reason}, ${wait}`;
}

function Retries({ step }: { step: StepState }) {
  if (!step.retries.length) return null;
  return (
    <ul className="mt-0.5 space-y-0.5">
      {step.retries.map((r, i) => (
        <li key={i} className="flex items-center gap-1 text-[11.5px] text-warn-ink">
          <RotateCw aria-hidden className="size-3" />
          <span>
            {retryText(r)}
            <span className="text-muted"> · attempt {r.attempt}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function ToolStep({ step }: { step: StepState }) {
  const running = step.status === 'running';
  return (
    <li className="flex gap-2.5 py-1" aria-label={`${step.label}: ${statusWord[step.status]}`}>
      <StatusIcon status={step.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={cx('text-[13px] font-medium', running ? 'text-fg' : 'text-fg-2')}>
            {step.label}
            {running ? '…' : ''}
          </span>
          {step.durationMs !== undefined ? <span className="shrink-0 font-mono text-[11px] tabular-nums text-faint">{fmtMs(step.durationMs)}</span> : null}
        </div>
        {step.summary ? (
          <p className={cx('text-xs', step.status === 'error' ? 'text-bad-ink' : step.status === 'blocked' ? 'text-warn-ink' : 'text-muted')}>{step.summary}</p>
        ) : null}
        <Retries step={step} />
      </div>
    </li>
  );
}

function LlmStep({ step }: { step: StepState }) {
  const [open, setOpen] = useState(false);
  const running = step.status === 'running';
  const hasDetail = Boolean(step.summary);
  return (
    <li className="py-0.5" aria-label={`${step.label}: ${statusWord[step.status]}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={!hasDetail}
        aria-expanded={hasDetail ? open : undefined}
        className="group flex w-full items-center gap-2.5 rounded text-left disabled:cursor-default"
      >
        {step.status === 'ok' ? (
          <span className="grid size-[18px] place-items-center text-faint">
            <Sparkles aria-hidden className="size-3" />
          </span>
        ) : (
          <StatusIcon status={step.status} light />
        )}
        <span className={cx('min-w-0 flex-1 truncate text-xs', running ? 'text-fg-2' : 'text-muted')}>
          {step.label}
          {running ? '…' : ''}
        </span>
        {step.durationMs !== undefined ? <span className="shrink-0 font-mono text-[11px] tabular-nums text-faint">{fmtMs(step.durationMs)}</span> : null}
        {hasDetail ? (
          open ? <ChevronDown aria-hidden className="size-3 text-faint" /> : <ChevronRight aria-hidden className="size-3 text-faint opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
        ) : null}
      </button>
      {open && step.summary ? <p className="ml-[28px] font-mono text-[11px] text-muted">{step.summary}</p> : null}
      <div className="ml-[28px]">
        <Retries step={step} />
      </div>
    </li>
  );
}

export function StepList({ activity }: { activity: TurnActivity }) {
  const running = activity.status === 'pending' || activity.status === 'running';
  return (
    <div aria-live="polite" aria-busy={running} aria-relevant="additions text">
      {activity.steps.length === 0 && running ? (
        <p className="flex items-center gap-2 py-1 text-xs text-muted">
          <Spinner className="size-3" /> Connecting to Nova…
        </p>
      ) : (
        <ol className="space-y-0">{activity.steps.map((s) => (s.name === 'llm' ? <LlmStep key={s.stepId} step={s} /> : <ToolStep key={s.stepId} step={s} />))}</ol>
      )}
      {activity.guardrails.length ? (
        <div className="mt-1.5">
          <GuardrailChips guardrails={activity.guardrails} />
        </div>
      ) : null}
    </div>
  );
}

function summaryLine(a: TurnActivity): string {
  const tools = a.steps.filter((s) => s.name !== 'llm').length;
  const llm = a.steps.length - tools;
  const failed = a.guardrails.filter((g) => g.decision === 'fail').length;
  const parts = [
    tools ? `${tools} tool${tools === 1 ? '' : 's'}` : null,
    llm ? `${llm} model step${llm === 1 ? '' : 's'}` : null,
    a.guardrails.length ? `${a.guardrails.length} check${a.guardrails.length === 1 ? '' : 's'}${failed ? ` (${failed} failed)` : ''}` : null,
  ].filter(Boolean);
  return parts.join(' · ') || 'No steps';
}

/**
 * Expanded while the turn runs (and on error); folds into a one-line summary once it's done.
 * The user can toggle either way.
 */
export function StepTracker({ activity, title }: { activity: TurnActivity; title?: string }) {
  const running = activity.status === 'pending' || activity.status === 'running';
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? (running || activity.status === 'error');
  const now = useTicker(running);
  const elapsed = activity.durationMs ?? Math.max(0, now - activity.startedAt);

  return (
    <section className="rounded-xl border border-line bg-surface/70 px-3 py-2" aria-label={title ?? 'Agent steps'}>
      <button type="button" onClick={() => setToggled(!open)} aria-expanded={open} className="flex w-full items-center gap-2 text-left">
        {running ? (
          <Spinner className="size-3.5 text-accent" />
        ) : activity.status === 'error' ? (
          <X aria-hidden className="size-3.5 text-bad" strokeWidth={3} />
        ) : activity.status === 'aborted' ? (
          <Ban aria-hidden className="size-3.5 text-warn" />
        ) : (
          <Check aria-hidden className="size-3.5 text-ok" strokeWidth={3} />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-fg-2">
          {title ? `${title} · ` : ''}
          {running ? 'Working on it' : activity.status === 'aborted' ? 'Cancelled — you interrupted' : summaryLine(activity)}
        </span>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-faint">{fmtMs(elapsed)}</span>
        {open ? <ChevronDown aria-hidden className="size-3.5 text-faint" /> : <ChevronRight aria-hidden className="size-3.5 text-faint" />}
      </button>
      {open ? (
        <div className="mt-1.5 border-t border-line pt-1.5">
          <StepList activity={activity} />
        </div>
      ) : null}
    </section>
  );
}
