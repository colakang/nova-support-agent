'use client';
// The shared conversation timeline: persisted messages, live turn activity (steps / draft / ticket / error)
// and live voice partials, interleaved by client sequence number.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, Mic } from 'lucide-react';
import type { ChatMessage } from '@sa/shared';
import type { MessageEntry } from '@/lib/useSession';
import type { TurnActivity } from '@/lib/turnActivity';
import type { LivePartial } from '@/lib/voice/useVoiceCall';
import { MessageBubble } from './MessageBubble';
import { StepTracker } from './StepTracker';
import { ErrorCard, TicketCard } from './TurnCards';

type Item =
  | { kind: 'message'; key: string; seq: number; entry: MessageEntry }
  | { kind: 'activity'; key: string; seq: number; activity: TurnActivity }
  | { kind: 'post'; key: string; seq: number; activity: TurnActivity }
  | { kind: 'partial'; key: string; seq: number; partial: LivePartial };

function buildTimeline(entries: MessageEntry[], activities: TurnActivity[], partials: LivePartial[]): Item[] {
  const items: Item[] = [];
  for (const e of entries) items.push({ kind: 'message', key: `m_${e.msg.id}`, seq: e.seq, entry: e });
  for (const a of activities) {
    const hasBody = a.steps.length > 0 || a.status === 'pending' || a.status === 'running' || a.guardrails.length > 0 || Boolean(a.draft);
    if (hasBody) items.push({ kind: 'activity', key: `a_${a.key}`, seq: a.seq, activity: a });
    if (a.postSeq !== null && (a.ticket || a.error)) items.push({ kind: 'post', key: `p_${a.key}`, seq: a.postSeq, activity: a });
  }
  for (const p of partials) items.push({ kind: 'partial', key: `v_${p.key}`, seq: p.seq, partial: p });
  return items.sort((x, y) => x.seq - y.seq);
}

function partialMessage(p: LivePartial): ChatMessage {
  return { id: p.key, role: p.role, mode: 'voice', content: p.text, at: Date.now(), ...(p.interrupted ? { interrupted: true } : {}) };
}

function ActivityBlock({ a }: { a: TurnActivity }) {
  const showDraft = a.mode === 'text' && a.draft && !a.answer;
  return (
    <div className="ml-9 space-y-2">
      {a.mode === 'voice' ? (
        <div className="flex items-center gap-1.5 text-[11px] text-muted">
          <Mic aria-hidden className="size-3" /> Nova consulted the support system
        </div>
      ) : null}
      <StepTracker activity={a} />
      {showDraft ? (
        <div className="-ml-9">
          <MessageBubble m={{ id: `draft_${a.key}`, role: 'assistant', mode: 'text', content: a.draft, at: Date.now() }} live />
        </div>
      ) : null}
    </div>
  );
}

export function MessageList({
  entries,
  activities,
  partials,
  busy,
  empty,
  onRetry,
  onHuman,
  onNewConversation,
}: {
  entries: MessageEntry[];
  activities: TurnActivity[];
  partials: LivePartial[];
  busy: boolean;
  empty: ReactNode;
  onRetry: (text: string) => void;
  onHuman: () => void;
  onNewConversation: () => void;
}) {
  const items = useMemo(() => buildTimeline(entries, activities, partials), [entries, activities, partials]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const lastActivityKey = activities.at(-1)?.key;

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stickRef.current = near;
    setShowJump(!near);
  };

  const jump = (smooth = true) => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };

  // Follow new content while the reader is at the bottom.
  useLayoutEffect(() => {
    if (stickRef.current) jump(false);
  }, [items]);

  // Content inside items (tracker expanding, fonts) can grow without a new item.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (stickRef.current) jump(false);
    });
    ro.observe(el); // the pane itself shrinks when the voice panel replaces the composer
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} onScroll={onScroll} className="scroll-thin h-full overflow-y-auto" role="log" aria-label="Conversation" aria-live="off">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-3 py-5 sm:px-6">
          {items.length === 0 ? empty : null}
          {items.map((it) => {
            switch (it.kind) {
              case 'message':
                return <MessageBubble key={it.key} m={it.entry.msg} pending={it.entry.origin === 'optimistic'} />;
              case 'partial':
                return <MessageBubble key={it.key} m={partialMessage(it.partial)} live />;
              case 'activity':
                return <ActivityBlock key={it.key} a={it.activity} />;
              case 'post':
                return (
                  <div key={it.key} className="space-y-2">
                    {it.activity.ticket ? <TicketCard ticket={it.activity.ticket} /> : null}
                    {it.activity.error ? (
                      <ErrorCard
                        error={it.activity.error}
                        actionable={it.activity.mode === 'text' && it.activity.key === lastActivityKey && !busy}
                        onRetry={() => onRetry(it.activity.text)}
                        onHuman={onHuman}
                        onNewConversation={onNewConversation}
                      />
                    ) : null}
                  </div>
                );
            }
          })}
        </div>
      </div>
      {showJump ? (
        <button
          type="button"
          onClick={() => jump()}
          className="animate-fade-in absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-fg-2 shadow-pop hover:text-fg"
        >
          <ArrowDown aria-hidden className="size-3.5" /> Latest
        </button>
      ) : null}
    </div>
  );
}
