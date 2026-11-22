'use client';
import { FlaskConical } from 'lucide-react';
import type { ChaosFlags } from '@sa/shared';
import { Popover, Segmented, Switch, cx } from '@/components/ui/primitives';

export const chaosActive = (c: ChaosFlags | undefined) => Boolean(c && (c.llmTimeout || c.llmRateLimit || c.retrievalDown || c.toolFailure !== 'none'));

export function ChaosMenu({ chaos, onChange, disabled }: { chaos: ChaosFlags | undefined; onChange: (next: ChaosFlags) => void; disabled: boolean }) {
  const on = chaosActive(chaos);
  const c: ChaosFlags = chaos ?? { llmTimeout: false, llmRateLimit: false, toolFailure: 'none', retrievalDown: false };
  const set = (patch: Partial<ChaosFlags>) => onChange({ ...c, ...patch });
  return (
    <Popover
      label="Chaos menu"
      triggerClassName={cx(on && 'bg-warn-soft text-warn-ink hover:bg-warn-soft hover:text-warn-ink')}
      trigger={
        <>
          <FlaskConical aria-hidden className="size-4" />
          <span className={cx(on ? 'inline' : 'hidden md:inline')}>{on ? 'Chaos on' : 'Chaos'}</span>
          {on ? <span className="size-1.5 animate-pulse rounded-full bg-warn" aria-hidden /> : null}
        </>
      }
      panelClassName="sm:w-[340px]"
    >
      {() => (
        <div className="p-4">
          <h2 className="text-sm font-semibold text-fg">Chaos engineering</h2>
          <p className="mt-0.5 text-xs text-muted">Inject failures into this session to watch retries, fallbacks and escalation. Applies to the next turns.</p>
          <div className="mt-2 divide-y divide-line">
            <Switch label="LLM timeout" description="Next model call hangs past the timeout, then falls back." checked={c.llmTimeout} disabled={disabled} onChange={(v) => set({ llmTimeout: v })} />
            <Switch label="LLM 429" description="Next model call is rate limited; retry-after is honoured." checked={c.llmRateLimit} disabled={disabled} onChange={(v) => set({ llmRateLimit: v })} />
            <Switch label="Knowledge base down" description="Vector store unavailable: no policy answers from memory." checked={c.retrievalDown} disabled={disabled} onChange={(v) => set({ retrievalDown: v })} />
            <div className="py-2">
              <div className="text-sm font-medium text-fg">Tool failure</div>
              <p className="mb-2 mt-0.5 text-xs text-muted">Transient failures retry once; permanent ones end in a ticket offer.</p>
              <Segmented
                label="Tool failure mode"
                size="sm"
                value={c.toolFailure}
                onChange={(v) => set({ toolFailure: v })}
                options={[
                  { value: 'none', label: 'None' },
                  { value: 'transient', label: 'Transient' },
                  { value: 'permanent', label: 'Permanent' },
                ]}
              />
            </div>
          </div>
          {on ? (
            <button
              type="button"
              onClick={() => onChange({ llmTimeout: false, llmRateLimit: false, toolFailure: 'none', retrievalDown: false })}
              className="mt-2 text-xs font-medium text-accent-ink hover:underline"
            >
              Turn everything off
            </button>
          ) : null}
        </div>
      )}
    </Popover>
  );
}
