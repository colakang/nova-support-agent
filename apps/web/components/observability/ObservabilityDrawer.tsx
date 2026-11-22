'use client';
// Right-hand observability drawer on desktop; a bottom sheet on small screens.
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Activity, X } from 'lucide-react';
import type { SessionView, TurnTrace } from '@sa/shared';
import type { Budget, DemoInfo } from '@/lib/api';
import type { GuardrailEvent } from '@/lib/turnActivity';
import { IconButton, cx } from '@/components/ui/primitives';
import { TurnsTab } from './TurnsTab';
import { SessionTab } from './SessionTab';
import { TotalsTab } from './TotalsTab';

type Tab = 'turns' | 'session' | 'totals';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'turns', label: 'Turns' },
  { id: 'session', label: 'Session' },
  { id: 'totals', label: 'Totals' },
];

export function ObservabilityDrawer({
  open,
  onClose,
  traces,
  session,
  budget,
  demo,
  guardrailsByTurn,
}: {
  open: boolean;
  onClose: () => void;
  traces: TurnTrace[];
  session: SessionView | null;
  budget: Budget | null;
  demo: DemoInfo | null;
  guardrailsByTurn: Map<string, GuardrailEvent[]>;
}) {
  const [tab, setTab] = useState<Tab>('turns');
  const base = useId();
  const asideRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ turns: null, session: null, totals: null });

  // Bottom sheet behaves like a dialog on mobile: Escape closes, focus moves in.
  useEffect(() => {
    if (!open) return;
    const mobile = window.matchMedia('(max-width: 1023px)').matches;
    if (mobile) asideRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && window.matchMedia('(max-width: 1023px)').matches) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const onTabKey = (e: ReactKeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]!;
    setTab(next.id);
    tabRefs.current[next.id]?.focus();
  };

  return (
    <>
      {open ? <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={onClose} aria-hidden /> : null}
      <aside
        ref={asideRef}
        tabIndex={-1}
        aria-label="Observability"
        className={cx(
          'z-40 flex-col bg-surface focus:outline-none',
          'max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:h-[85dvh] max-lg:animate-slide-up max-lg:rounded-t-2xl max-lg:border-t max-lg:border-line max-lg:shadow-pop',
          'lg:w-[440px] lg:shrink-0 lg:border-l lg:border-line xl:w-[480px]',
          open ? 'flex' : 'hidden',
        )}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong lg:hidden" aria-hidden />
        <header className="flex items-center gap-2 px-4 pb-2 pt-2.5 lg:pt-3">
          <Activity aria-hidden className="size-4 text-accent" />
          <h2 className="text-[13px] font-semibold text-fg">Observability</h2>
          <span className="text-[11px] text-faint">live</span>
          <IconButton label="Close observability" onClick={onClose} className="ml-auto size-8 px-0">
            <X aria-hidden className="size-4" />
          </IconButton>
        </header>
        <div role="tablist" aria-label="Observability views" className="flex gap-1 border-b border-line px-3">
          {TABS.map((t, i) => {
            const on = t.id === tab;
            return (
              <button
                key={t.id}
                ref={(el) => {
                  tabRefs.current[t.id] = el;
                }}
                type="button"
                role="tab"
                id={`${base}-tab-${t.id}`}
                aria-selected={on}
                aria-controls={`${base}-panel-${t.id}`}
                tabIndex={on ? 0 : -1}
                onClick={() => setTab(t.id)}
                onKeyDown={(e) => onTabKey(e, i)}
                className={cx(
                  '-mb-px border-b-2 px-2.5 py-2 text-[13px] font-medium transition-colors',
                  on ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
                )}
              >
                {t.label}
                {t.id === 'turns' && traces.length ? <span className="ml-1.5 rounded bg-surface-2 px-1 font-mono text-[10.5px] text-muted">{traces.length}</span> : null}
              </button>
            );
          })}
        </div>
        <div
          role="tabpanel"
          id={`${base}-panel-${tab}`}
          aria-labelledby={`${base}-tab-${tab}`}
          className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-canvas/50 p-3"
        >
          {tab === 'turns' ? <TurnsTab traces={traces} guardrailsByTurn={guardrailsByTurn} /> : null}
          {tab === 'session' ? <SessionTab session={session} /> : null}
          {tab === 'totals' ? <TotalsTab traces={traces} budget={budget} demo={demo} /> : null}
        </div>
      </aside>
    </>
  );
}
