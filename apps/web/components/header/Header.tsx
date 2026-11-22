'use client';
import { Activity, MessageSquare, Mic, Plus, Sparkle, Wallet } from 'lucide-react';
import type { ChaosFlags, Mode } from '@sa/shared';
import type { Budget, DemoCustomer } from '@/lib/api';
import { fmtUsd } from '@/lib/format';
import { IconButton, Segmented, Tooltip, cx } from '@/components/ui/primitives';
import { ChaosMenu } from './ChaosMenu';
import { DemoAccounts } from './DemoAccounts';

function BudgetPill({ budget }: { budget: Budget | null }) {
  if (!budget) return null;
  const pct = budget.dailyCapUsd > 0 ? budget.todayUsd / budget.dailyCapUsd : 0;
  const tone = pct >= 0.9 ? 'border-bad/40 bg-bad-soft text-bad-ink' : pct >= 0.6 ? 'border-warn/40 bg-warn-soft text-warn-ink' : 'border-line bg-surface-2 text-fg-2';
  return (
    <Tooltip
      side="bottom"
      content={
        <span className="block">
          Demo spend today across all visitors. Daily cap {fmtUsd(budget.dailyCapUsd)}, per-session cap {fmtUsd(budget.sessionCapUsd)}.
        </span>
      }
    >
      <span tabIndex={0} className={cx('inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 font-mono text-[11.5px] tabular-nums', tone)} aria-label={`Spent ${fmtUsd(budget.todayUsd)} of ${fmtUsd(budget.dailyCapUsd)} today`}>
        <Wallet aria-hidden className="size-3.5" />
        {fmtUsd(budget.todayUsd)}
        <span className="opacity-60">/ {fmtUsd(budget.dailyCapUsd)}</span>
      </span>
    </Tooltip>
  );
}

export function Header({
  mode,
  onMode,
  modeLocked,
  budget,
  chaos,
  onChaos,
  customers,
  onPickCustomer,
  inCall,
  drawerOpen,
  onToggleDrawer,
  onNewConversation,
  ready,
}: {
  mode: Mode;
  onMode: (m: Mode) => void;
  modeLocked: boolean;
  budget: Budget | null;
  chaos: ChaosFlags | undefined;
  onChaos: (c: ChaosFlags) => void;
  customers: DemoCustomer[];
  onPickCustomer: (text: string) => void;
  inCall: boolean;
  drawerOpen: boolean;
  onToggleDrawer: () => void;
  onNewConversation: () => void;
  ready: boolean;
}) {
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface px-3 py-2 sm:px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-fg text-canvas">
          <Sparkle aria-hidden className="size-4" fill="currentColor" />
        </span>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[14px] font-semibold text-fg">Northstar Support</div>
          <div className="flex items-center gap-1.5 text-[11.5px] text-muted">
            <span className="size-1.5 rounded-full bg-ok" aria-hidden />
            Nova · AI agent
          </div>
        </div>
      </div>

      <div className="order-last flex w-full items-center justify-between gap-2 sm:order-none sm:ml-4 sm:w-auto sm:justify-start">
        <Segmented<Mode>
          label="Conversation mode"
          value={mode}
          onChange={(m) => !modeLocked && onMode(m)}
          options={[
            { value: 'text', label: 'Chat', icon: <MessageSquare aria-hidden className="size-3.5" /> },
            { value: 'voice', label: 'Voice', icon: <Mic aria-hidden className="size-3.5" /> },
          ]}
        />
        <BudgetPill budget={budget} />
      </div>

      <div className="ml-auto flex items-center gap-0.5">
        <ChaosMenu chaos={chaos} onChange={onChaos} disabled={!ready} />
        <DemoAccounts customers={customers} onPick={onPickCustomer} inCall={inCall} />
        <IconButton label={drawerOpen ? 'Hide observability' : 'Show observability'} onClick={onToggleDrawer} aria-pressed={drawerOpen} className={cx(drawerOpen && 'text-accent-ink')}>
          <Activity aria-hidden className="size-4" />
          <span className="hidden xl:inline">Observability</span>
        </IconButton>
        <IconButton label="New conversation" onClick={onNewConversation} disabled={!ready} className="border border-line">
          <Plus aria-hidden className="size-4" />
          <span className="hidden md:inline">New</span>
        </IconButton>
      </div>
    </header>
  );
}
