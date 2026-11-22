'use client';
import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { cx } from '@/components/ui/primitives';

export function Stat({ label, value, hint, className }: { label: string; value: ReactNode; hint?: string; className?: string }) {
  return (
    <div className={cx('min-w-0 rounded-lg bg-surface-2 px-2.5 py-1.5', className)} title={hint}>
      <div className="truncate text-[10.5px] font-medium uppercase tracking-wide text-faint">{label}</div>
      <div className="truncate font-mono text-[13px] font-semibold tabular-nums text-fg">{value}</div>
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 mt-5 flex items-center justify-between first:mt-0">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{children}</h3>
      {right}
    </div>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setDone(true);
            window.setTimeout(() => setDone(false), 1200);
          })
          .catch(() => {});
      }}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface-3 hover:text-fg"
      aria-label={label}
    >
      {done ? <Check aria-hidden className="size-3" /> : <Copy aria-hidden className="size-3" />}
      {done ? 'Copied' : label}
    </button>
  );
}

/** Pretty-printed JSON in a scrollable pre. Long prompt strings wrap instead of scrolling sideways. */
export function JsonBlock({ value, maxHeight = 'max-h-80', label }: { value: unknown; maxHeight?: string; label?: string }) {
  const text = JSON.stringify(value, null, 2) ?? 'undefined';
  return (
    <div className="relative">
      <div className="absolute right-1 top-1">
        <CopyButton text={text} label="Copy JSON" />
      </div>
      <pre
        tabIndex={0}
        aria-label={label ?? 'JSON'}
        className={cx('scroll-thin overflow-auto rounded-lg border border-line bg-canvas p-2.5 pr-20 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-fg-2', maxHeight)}
      >
        {text}
      </pre>
    </div>
  );
}

export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const tone = pct >= 90 ? 'bg-bad' : pct >= 60 ? 'bg-warn' : 'bg-ok';
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
      <div className={cx('h-full rounded-full transition-[width]', tone)} style={{ width: `${pct}%` }} />
    </div>
  );
}
