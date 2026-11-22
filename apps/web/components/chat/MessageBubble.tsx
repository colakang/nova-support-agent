'use client';
import { BookOpen, Mic } from 'lucide-react';
import type { ChatMessage, Citation } from '@sa/shared';
import { fmtTime } from '@/lib/format';
import { Badge, Tooltip, cx } from '@/components/ui/primitives';

const KIND_LABEL: Partial<Record<NonNullable<ChatMessage['kind']>, string>> = {
  grounded: 'From policy docs',
  account: 'From your account',
  clarify: 'Needs info',
  decline: 'Declined',
  escalate: 'Handed off',
};

export function NovaAvatar({ size = 'md' }: { size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden
      className={cx(
        'grid shrink-0 place-items-center rounded-full bg-linear-to-br from-accent to-esc font-semibold text-white shadow-sm',
        size === 'sm' ? 'size-6 text-[11px]' : 'size-7 text-xs',
      )}
    >
      N
    </span>
  );
}

export function CitationChips({ citations }: { citations: Citation[] }) {
  const unique = citations.filter((c, i) => citations.findIndex((x) => x.chunkId === c.chunkId) === i);
  if (!unique.length) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Sources">
      {unique.map((c) => (
        <li key={c.chunkId}>
          <Tooltip
            content={
              <span className="block">
                <span className="block font-medium text-fg">{c.title}</span>
                <span className="block">{c.section}</span>
                <span className="mt-0.5 block font-mono text-[10.5px] text-muted">
                  {c.chunkId} · similarity {c.score.toFixed(3)}
                </span>
              </span>
            }
          >
            <span
              tabIndex={0}
              className="inline-flex max-w-[280px] items-center gap-1.5 rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[11px] text-fg-2"
              aria-label={`Source: ${c.title}, ${c.section}, similarity ${c.score.toFixed(2)}`}
            >
              <BookOpen aria-hidden className="size-3 shrink-0 text-muted" />
              <span className="truncate">
                {c.title} <span className="text-faint">›</span> {c.section}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-muted">{c.score.toFixed(2)}</span>
            </span>
          </Tooltip>
        </li>
      ))}
    </ul>
  );
}

function Meta({ m, who }: { m: ChatMessage; who: string }) {
  const kind = m.role === 'assistant' && m.kind ? KIND_LABEL[m.kind] : undefined;
  return (
    <div className={cx('mb-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted', m.role === 'user' && 'justify-end')}>
      <span className="font-medium text-fg-2">{who}</span>
      {kind ? <span>· {kind}</span> : null}
      <span className="tabular-nums">· {fmtTime(m.at)}</span>
      {m.mode === 'voice' ? (
        <Badge tone="info" title="Spoken in a voice call">
          <Mic aria-hidden className="size-2.5" />
          voice
        </Badge>
      ) : null}
      {m.interrupted ? (
        <Badge tone="warn" title="The customer cut Nova off mid-sentence">
          interrupted
        </Badge>
      ) : null}
    </div>
  );
}

export function MessageBubble({ m, pending, live }: { m: ChatMessage; pending?: boolean; live?: boolean }) {
  if (m.role === 'user') {
    return (
      <div className="animate-fade-in flex justify-end">
        <div className="max-w-[85%] sm:max-w-[75%]">
          <Meta m={m} who="You" />
          <div
            className={cx(
              'rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-[14px] leading-relaxed text-accent-fg whitespace-pre-wrap break-words',
              (pending || live) && 'opacity-75',
            )}
          >
            {m.content || <span className="italic opacity-80">listening…</span>}
            {live && m.content ? <span className="animate-blink ml-0.5">▍</span> : null}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="animate-fade-in flex gap-2.5">
      <NovaAvatar />
      <div className="min-w-0 max-w-[92%] sm:max-w-[80%]">
        <Meta m={m} who="Nova" />
        <div
          className={cx(
            'rounded-2xl rounded-tl-md border border-line bg-surface px-3.5 py-2 text-[14px] leading-relaxed text-fg whitespace-pre-wrap break-words',
            m.interrupted && 'border-dashed',
          )}
        >
          {m.content}
          {live ? <span className="animate-blink ml-0.5 text-muted">▍</span> : null}
          {m.interrupted ? <span className="text-muted"> —</span> : null}
        </div>
        {m.citations?.length ? <CitationChips citations={m.citations} /> : null}
      </div>
    </div>
  );
}
