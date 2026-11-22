'use client';
// Root of the support console: wires the session store, the voice call, and the layout together.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, RotateCw } from 'lucide-react';
import type { ChaosFlags, Mode } from '@sa/shared';
import { useSession } from '@/lib/useSession';
import { useVoiceCall, type EndReason } from '@/lib/voice/useVoiceCall';
import { ToastProvider, useToast } from '@/lib/toast';
import type { GuardrailEvent } from '@/lib/turnActivity';
import { Header } from './header/Header';
import { Composer, type ComposerHandle } from './chat/Composer';
import { MessageList } from './chat/MessageList';
import { EmptyState, EscalationBanner, FactsStrip } from './chat/SessionBits';
import { VoicePanel } from './voice/VoicePanel';
import { ObservabilityDrawer } from './observability/ObservabilityDrawer';
import { Toaster } from './ui/Toaster';
import { buttonClasses } from './ui/primitives';

const HUMAN_REQUEST = "I'd like to talk to a human, please.";

export function Console() {
  return (
    <ToastProvider>
      <ConsoleInner />
      <Toaster />
    </ToastProvider>
  );
}

function BootState({ status, error, onRetry }: { status: 'loading' | 'error'; error: string | null; onRetry: () => void }) {
  if (status === 'loading')
    return (
      <div className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-3 py-6 sm:px-6" aria-busy="true" aria-label="Loading conversation">
        {[60, 40, 70].map((w, i) => (
          <div key={i} className={i % 2 ? 'flex justify-end' : 'flex gap-2.5'}>
            {i % 2 ? null : <div className="size-7 animate-pulse rounded-full bg-surface-3" />}
            <div className="h-12 animate-pulse rounded-2xl bg-surface-3" style={{ width: `${w}%` }} />
          </div>
        ))}
      </div>
    );
  return (
    <div className="flex flex-1 items-center justify-center px-4">
      <div role="alert" className="max-w-sm rounded-2xl border border-line bg-surface p-5 text-center shadow-sm">
        <CircleAlert aria-hidden className="mx-auto size-6 text-bad" />
        <h1 className="mt-2 text-sm font-semibold text-fg">Can’t start a conversation</h1>
        <p className="mt-1 text-[13px] text-muted">{error ?? 'The support service is unreachable.'}</p>
        <button type="button" onClick={onRetry} className={`${buttonClasses.primary} mt-4`}>
          <RotateCw aria-hidden className="size-3.5" /> Try again
        </button>
      </div>
    </div>
  );
}

function ConsoleInner() {
  const s = useSession();
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>('text');
  const [draft, setDraft] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const composerRef = useRef<ComposerHandle>(null);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Drawer starts open on desktop, closed (bottom sheet) on phones.
  useEffect(() => {
    setDrawerOpen(window.matchMedia('(min-width: 1024px)').matches);
  }, []);

  const { refresh, refreshTraces, refreshBudget } = s;
  const onEnded = useCallback(
    (reason: EndReason) => {
      void refresh();
      if (reason === 'dropped') {
        setMode('text');
        toast({ title: 'Call dropped, switched to chat', body: 'Everything said so far is saved in this conversation.', tone: 'warn', durationMs: 6000 });
      } else if (reason === 'timeout') {
        toast({ title: 'Call reached the demo time limit', body: 'The transcript is saved. Continue in chat or call again.' });
      }
    },
    [refresh, toast],
  );

  const call = useVoiceCall({
    sessionId: s.sessionId,
    runTurn: s.runTurn,
    addTranscript: s.addTranscript,
    nextSeq: s.nextSeq,
    onEnded,
    onServerError: (message) => toast({ title: 'Voice service error', body: message, tone: 'bad' }),
    onUsagePosted: () => {
      void refreshTraces();
      void refreshBudget();
    },
  });

  const guardrailsByTurn = useMemo(() => {
    const m = new Map<string, GuardrailEvent[]>();
    for (const a of s.activities) if (a.turnId && a.guardrails.length) m.set(a.turnId, a.guardrails);
    return m;
  }, [s.activities]);

  const consult = useMemo(() => s.activities.find((a) => a.key === call.consultKey) ?? null, [s.activities, call.consultKey]);
  const ready = s.status === 'ready';

  const changeMode = (m: Mode) => {
    if (m === mode) return;
    if (m === 'text' && call.active) void call.hangUp();
    if (m === 'voice') call.reset();
    setMode(m);
  };

  const send = (text: string) => {
    const t = text.trim();
    if (!t || s.busy || !ready) return;
    setDraft('');
    void s.sendText(t);
  };

  const newConversation = async () => {
    if (call.active) await call.hangUp();
    try {
      await s.newConversation();
      setDraft('');
      call.reset();
      toast({ title: 'New conversation started', tone: 'ok', durationMs: 2000 });
    } catch (e) {
      toast({ title: 'Couldn’t start a new conversation', body: e instanceof Error ? e.message : undefined, tone: 'bad' });
    }
  };

  const onChaos = (next: ChaosFlags) => {
    const prev = s.session?.chaos;
    if (!prev) return;
    s.setChaos(next, prev).catch((e: unknown) => toast({ title: 'Couldn’t update chaos flags', body: e instanceof Error ? e.message : undefined, tone: 'bad' }));
  };

  const onPickCustomer = (text: string) => {
    if (call.active) return;
    setMode('text');
    setDraft((d) => (d.trim() ? `${d.trim()} ${text}` : text));
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <Header
        mode={mode}
        onMode={changeMode}
        modeLocked={s.busy}
        budget={s.budget}
        chaos={s.session?.chaos}
        onChaos={onChaos}
        customers={s.demo?.customers ?? []}
        onPickCustomer={onPickCustomer}
        inCall={call.active}
        drawerOpen={drawerOpen}
        onToggleDrawer={() => setDrawerOpen((o) => !o)}
        onNewConversation={() => void newConversation()}
        ready={ready}
      />
      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          <FactsStrip session={s.session} />
          <EscalationBanner session={s.session} />
          {s.status === 'ready' ? (
            <MessageList
              entries={s.entries}
              activities={s.activities}
              partials={call.partials}
              busy={s.busy}
              empty={<EmptyState onPick={send} disabled={s.busy || mode === 'voice'} />}
              onRetry={send}
              onHuman={() => send(HUMAN_REQUEST)}
              onNewConversation={() => void newConversation()}
            />
          ) : (
            <BootState status={s.status} error={s.initError} onRetry={() => void s.boot()} />
          )}
          {mode === 'text' ? (
            <Composer ref={composerRef} value={draft} onChange={setDraft} onSend={() => send(draft)} busy={s.busy} disabled={!ready} />
          ) : (
            <VoicePanel call={call} consult={consult} disabled={!ready} onSwitchToChat={() => changeMode('text')} />
          )}
        </main>
        <ObservabilityDrawer
          open={drawerOpen}
          onClose={closeDrawer}
          traces={s.traces}
          session={s.session}
          budget={s.budget}
          demo={s.demo}
          guardrailsByTurn={guardrailsByTurn}
        />
      </div>
    </div>
  );
}
