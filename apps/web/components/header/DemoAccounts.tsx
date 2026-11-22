'use client';
import { CornerDownLeft, Users } from 'lucide-react';
import type { DemoCustomer } from '@/lib/api';
import { humanize } from '@/lib/format';
import { Badge, Popover } from '@/components/ui/primitives';

const TIER_TONE = { starter: 'neutral', pro: 'accent', enterprise: 'esc' } as const;

export function DemoAccounts({ customers, onPick, inCall }: { customers: DemoCustomer[]; onPick: (text: string) => void; inCall: boolean }) {
  return (
    <Popover
      label="Demo accounts"
      trigger={
        <>
          <Users aria-hidden className="size-4" />
          <span className="hidden md:inline">Demo accounts</span>
        </>
      }
      panelClassName="sm:w-[400px]"
    >
      {(close) => (
        <div className="flex max-h-[min(70dvh,560px)] flex-col">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold text-fg">Demo accounts</h2>
            <p className="mt-0.5 text-xs text-muted">
              Fake customers for trying account actions. {inCall ? 'In a call, read the email and PIN out to Nova.' : 'Click one to put “email, PIN” in the composer.'}
            </p>
          </div>
          <ul className="scroll-thin min-h-0 flex-1 divide-y divide-line overflow-y-auto">
            {customers.length === 0 ? <li className="px-4 py-6 text-center text-xs text-muted">Loading…</li> : null}
            {customers.map((c) => (
              <li key={c.customerId}>
                <button
                  type="button"
                  disabled={inCall}
                  onClick={() => {
                    onPick(`${c.email}, PIN ${c.pin}`);
                    close();
                  }}
                  className="group w-full px-4 py-2.5 text-left transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-fg">{c.name}</span>
                    <Badge tone={TIER_TONE[c.tier]}>{humanize(c.tier)}</Badge>
                    {!inCall ? <CornerDownLeft aria-hidden className="ml-auto size-3.5 text-faint opacity-0 transition-opacity group-hover:opacity-100" /> : null}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-[11.5px] text-fg-2">
                    <span>{c.email}</span>
                    <span>
                      PIN <span className="font-semibold">{c.pin}</span>
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-snug text-muted">{c.try}</p>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Popover>
  );
}
