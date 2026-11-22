'use client';
import { X } from 'lucide-react';
import { useToastList, type ToastTone } from '@/lib/toast';
import { cx } from './primitives';

const TONE: Record<ToastTone, string> = {
  neutral: 'border-line',
  ok: 'border-ok/40',
  warn: 'border-warn/50',
  bad: 'border-bad/50',
  esc: 'border-esc/40',
};
const DOT: Record<ToastTone, string> = { neutral: 'bg-faint', ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad', esc: 'bg-esc' };

export function Toaster() {
  const { toasts, dismiss } = useToastList();
  return (
    <div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-3 lg:bottom-6">
      {toasts.map((t) => (
        <div key={t.id} role="status" className={cx('animate-fade-in pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border bg-surface px-3 py-2.5 shadow-pop', TONE[t.tone])}>
          <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', DOT[t.tone])} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-fg">{t.title}</p>
            {t.body ? <p className="mt-0.5 text-xs text-muted">{t.body}</p> : null}
          </div>
          <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="rounded p-0.5 text-faint hover:text-fg">
            <X aria-hidden className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
