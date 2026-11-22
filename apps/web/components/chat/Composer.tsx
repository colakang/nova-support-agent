'use client';
import { useEffect, useImperativeHandle, useRef, type KeyboardEvent, type Ref } from 'react';
import { ArrowUp } from 'lucide-react';
import { Spinner, cx } from '@/components/ui/primitives';

const MAX = 2000;

export interface ComposerHandle {
  focus: () => void;
}

export function Composer({
  value,
  onChange,
  onSend,
  busy,
  disabled,
  ref,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  busy: boolean;
  disabled?: boolean;
  ref?: Ref<ComposerHandle>;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => taRef.current?.focus() }), []);

  // Auto-grow up to ~6 lines.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [value]);

  // Give focus back when a turn finishes.
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy) taRef.current?.focus();
    wasBusy.current = busy;
  }, [busy]);

  const locked = busy || Boolean(disabled);
  const canSend = !locked && value.trim().length > 0 && value.length <= MAX;

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (canSend) onSend();
    }
  };

  return (
    <form
      className="border-t border-line bg-surface/80 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:px-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSend();
      }}
    >
      <div className="mx-auto max-w-3xl">
        <div className={cx('flex items-end gap-2 rounded-2xl border bg-surface px-3 py-2 shadow-sm transition-colors', locked ? 'border-line' : 'border-line-strong focus-within:border-accent')}>
          <label htmlFor="composer" className="sr-only">
            Message Nova
          </label>
          <textarea
            id="composer"
            ref={taRef}
            rows={1}
            value={value}
            disabled={locked}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={busy ? 'Nova is working…' : 'Ask about plans, billing, refunds…'}
            className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent py-1 text-[14px] leading-6 text-fg placeholder:text-faint focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            aria-describedby="composer-hint"
          />
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Send message"
            className="grid size-8 shrink-0 place-items-center rounded-xl bg-accent text-accent-fg shadow-sm transition hover:brightness-110 disabled:bg-surface-3 disabled:text-faint disabled:shadow-none"
          >
            {busy ? <Spinner className="size-4" /> : <ArrowUp aria-hidden className="size-4" strokeWidth={2.5} />}
          </button>
        </div>
        <p id="composer-hint" className="mt-1.5 flex justify-between px-1 text-[11px] text-faint">
          <span>
            <kbd className="font-sans">Enter</kbd> to send · <kbd className="font-sans">Shift+Enter</kbd> for a new line
          </span>
          {value.length > MAX - 200 ? <span className={value.length > MAX ? 'text-bad' : ''}>{value.length}/{MAX}</span> : null}
        </p>
      </div>
    </form>
  );
}
