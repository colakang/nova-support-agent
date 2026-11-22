'use client';
// Tiny UI kit: badges, tooltip, switch, segmented control, spinner, icon button, popover.
import { useCallback, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';

export type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'bad' | 'esc' | 'info';

export const toneClasses: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-fg-2 border-line',
  accent: 'bg-accent-soft text-accent-ink border-transparent',
  ok: 'bg-ok-soft text-ok-ink border-transparent',
  warn: 'bg-warn-soft text-warn-ink border-transparent',
  bad: 'bg-bad-soft text-bad-ink border-transparent',
  esc: 'bg-esc-soft text-esc-ink border-transparent',
  info: 'bg-info-soft text-info-ink border-transparent',
};

export function cx(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(' ');
}

export function Badge({ tone = 'neutral', className, children, title }: { tone?: Tone; className?: string; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cx('inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-px text-[11px] font-medium leading-4 whitespace-nowrap', toneClasses[tone], className)}>
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle aria-hidden className={cx('animate-spin', className ?? 'size-3.5')} />;
}

/** Hover / focus tooltip. The trigger gets aria-describedby so screen readers read the content too. */
export function Tooltip({ content, children, side = 'top', className }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom'; className?: string }) {
  const id = useId();
  return (
    <span className={cx('group/tt relative inline-flex', className)} aria-describedby={id}>
      {children}
      <span
        id={id}
        role="tooltip"
        className={cx(
          'pointer-events-none invisible absolute left-1/2 z-50 w-max max-w-[260px] -translate-x-1/2 rounded-md border border-line bg-surface px-2 py-1.5 text-[11px] leading-snug text-fg-2 opacity-0 shadow-pop transition-opacity duration-100',
          'group-hover/tt:visible group-hover/tt:opacity-100 group-focus-within/tt:visible group-focus-within/tt:opacity-100',
          side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
        )}
      >
        {content}
      </span>
    </span>
  );
}

export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium text-fg">
          {label}
        </label>
        {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50',
          checked ? 'border-warn bg-warn' : 'border-line-strong bg-surface-3',
        )}
      >
        <span className={cx('inline-block size-3.5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-[2px]')} />
      </button>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'md',
}: {
  value: T;
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
  onChange: (v: T) => void;
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cx(
              'inline-flex items-center gap-1.5 rounded-md font-medium transition-colors',
              size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-[13px]',
              on ? 'bg-surface text-fg shadow-sm ring-1 ring-line' : 'text-muted hover:text-fg',
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cx(
        'inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
    >
      {children}
    </button>
  );
}

export const buttonClasses = {
  primary:
    'inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-fg shadow-sm transition hover:brightness-110 disabled:opacity-50 disabled:pointer-events-none',
  secondary:
    'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px] font-medium text-fg-2 transition hover:bg-surface-2 hover:text-fg disabled:opacity-50 disabled:pointer-events-none',
  danger:
    'inline-flex items-center justify-center gap-1.5 rounded-lg bg-bad px-3 py-1.5 text-[13px] font-medium text-white shadow-sm transition hover:brightness-110 disabled:opacity-50 disabled:pointer-events-none',
};

/** Click-to-open panel anchored under its trigger; closes on outside click and Escape, returns focus. */
export function Popover({
  label,
  trigger,
  triggerClassName,
  panelClassName,
  children,
}: {
  label: string;
  trigger: ReactNode;
  triggerClassName?: string;
  panelClassName?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useCallback(() => {
    setOpen(false);
    btnRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    panelRef.current?.querySelector<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        className={cx(
          'inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg',
          open && 'bg-surface-2 text-fg',
          triggerClassName,
        )}
      >
        {trigger}
      </button>
      {open ? (
        <div
          ref={panelRef}
          id={id}
          role="dialog"
          aria-label={label}
          className={cx(
            'animate-fade-in z-50 rounded-xl border border-line bg-surface shadow-pop',
            'max-sm:fixed max-sm:inset-x-3 max-sm:top-14 sm:absolute sm:right-0 sm:top-full sm:mt-2',
            panelClassName,
          )}
        >
          {children(close)}
        </div>
      ) : null}
    </div>
  );
}
