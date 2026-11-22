'use client';
import { useEffect, useState } from 'react';
import { Hand, MessageSquare, Mic, MicOff, Phone, PhoneOff, RotateCw, TriangleAlert } from 'lucide-react';
import type { TurnActivity } from '@/lib/turnActivity';
import type { CallState, ConnectStep, VoiceCall } from '@/lib/voice/useVoiceCall';
import { fmtClock, fmtMs, fmtUsd } from '@/lib/format';
import { Spinner, buttonClasses, cx } from '@/components/ui/primitives';
import { StepTracker } from '@/components/chat/StepTracker';
import { Waveform } from './Waveform';

const STATE_LABEL: Record<CallState, string> = {
  idle: 'Ready when you are',
  connecting: 'Connecting…',
  listening: 'Listening',
  user_speaking: 'You’re speaking',
  thinking: 'Thinking…',
  assistant_speaking: 'Nova is speaking',
  ended: 'Call ended',
  error: 'Call failed',
};

const CONNECT_STEP_LABEL: Record<ConnectStep, string> = {
  token: 'Starting a secure voice session…',
  mic: 'Waiting for microphone permission. Check your browser’s address bar.',
  signaling: 'Contacting the voice service…',
  audio: 'Opening the audio connection…',
};

function StateDot({ state }: { state: CallState }) {
  if (state === 'connecting' || state === 'thinking') return <Spinner className={cx('size-3.5', state === 'thinking' ? 'text-warn' : 'text-accent')} />;
  const color =
    state === 'listening' ? 'bg-ok' : state === 'user_speaking' ? 'bg-mic' : state === 'assistant_speaking' ? 'bg-nova' : state === 'error' ? 'bg-bad' : 'bg-faint';
  const pulse = state === 'listening' || state === 'user_speaking' || state === 'assistant_speaking';
  return (
    <span className="relative inline-flex size-2.5">
      {pulse ? <span className={cx('absolute inline-flex size-full animate-ping rounded-full opacity-60', color)} /> : null}
      <span className={cx('relative inline-flex size-2.5 rounded-full', color)} />
    </span>
  );
}

function useFlash(at: number | null, ms = 1800): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (at === null) return;
    setOn(true);
    const t = window.setTimeout(() => setOn(false), ms);
    return () => window.clearTimeout(t);
  }, [at, ms]);
  return on;
}

export function VoicePanel({
  call,
  consult,
  disabled,
  onSwitchToChat,
}: {
  call: VoiceCall;
  consult: TurnActivity | null;
  disabled: boolean;
  onSwitchToChat: () => void;
}) {
  const { state, active, error, muted, elapsed, maxSeconds, lastLatencyMs, costUsd } = call;
  const interrupted = useFlash(call.interruptedAt);
  const remaining = maxSeconds !== null ? maxSeconds - elapsed : null;
  const live = state !== 'idle' && state !== 'ended' && state !== 'error' && state !== 'connecting';

  return (
    <section aria-label="Voice call" className="border-t border-line bg-surface/80 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:px-6">
      <div className="mx-auto max-w-3xl">
        <div className="rounded-2xl border border-line bg-surface p-3 shadow-sm sm:p-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <div className="flex items-center gap-2" aria-live="polite">
              <StateDot state={state} />
              <span className="text-[15px] font-semibold text-fg">{STATE_LABEL[state]}</span>
              {state === 'connecting' && call.connectStep ? <span className="text-[12px] text-muted">{CONNECT_STEP_LABEL[call.connectStep]}</span> : null}
              {muted ? <span className="rounded bg-warn-soft px-1.5 text-[11px] font-medium text-warn-ink">muted</span> : null}
            </div>
            <div className="ml-auto flex items-center gap-3 font-mono text-[11px] tabular-nums text-muted">
              {active || state === 'ended' ? (
                <span className={cx(remaining !== null && remaining <= 30 && active && 'font-semibold text-warn-ink')} title="Call duration / maximum">
                  {fmtClock(elapsed)}
                  {maxSeconds ? ` / ${fmtClock(maxSeconds)}` : ''}
                </span>
              ) : null}
              {lastLatencyMs !== null ? <span title="Speech end → Nova’s first audio">reply {fmtMs(lastLatencyMs)}</span> : null}
              {costUsd > 0 ? <span title="Estimated realtime cost of this call">≈ {fmtUsd(costUsd)}</span> : null}
            </div>
          </div>

          <div className="relative mt-3">
            <Waveform analysers={call.analysers} live={live} className="h-20 w-full rounded-lg bg-canvas" />
            <div className="pointer-events-none absolute left-2 top-1.5 flex gap-3 text-[10.5px] font-medium">
              <span className="flex items-center gap-1 text-mic">
                <span className="size-1.5 rounded-full bg-mic" /> You
              </span>
              <span className="flex items-center gap-1 text-nova">
                <span className="size-1.5 rounded-full bg-nova" /> Nova
              </span>
            </div>
            {interrupted ? (
              <div role="status" className="animate-fade-in absolute inset-x-0 top-1/2 mx-auto flex w-fit -translate-y-1/2 items-center gap-1.5 rounded-full bg-warn px-3 py-1 text-xs font-semibold text-white shadow-pop">
                <Hand aria-hidden className="size-3.5" /> Interrupted — Nova stopped to listen
              </div>
            ) : null}
          </div>

          {remaining !== null && active && remaining <= 30 ? (
            <p className="mt-2 text-xs text-warn-ink">Demo calls are capped at {fmtClock(maxSeconds ?? 0)}. This call ends in {remaining}s; the transcript stays in chat.</p>
          ) : null}

          {consult && (active || state === 'ended') ? (
            <div className="mt-3">
              <StepTracker key={consult.key} activity={consult} title="Consulting support system" />
            </div>
          ) : null}

          {error ? (
            <div role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-bad/30 bg-bad-soft/60 p-3">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-bad" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-bad-ink">{error.kind === 'mic' ? 'Microphone unavailable' : error.kind === 'budget' ? 'Demo budget reached' : 'Couldn’t start the call'}</p>
                <p className="text-[13px] text-fg-2">{error.message}</p>
              </div>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {active ? (
              <>
                <button type="button" onClick={call.toggleMute} disabled={state === 'connecting'} className={buttonClasses.secondary} aria-pressed={muted}>
                  {muted ? <MicOff aria-hidden className="size-4" /> : <Mic aria-hidden className="size-4" />}
                  {muted ? 'Unmute' : 'Mute'}
                </button>
                <button type="button" onClick={() => void call.hangUp()} className={cx(buttonClasses.danger, 'px-4')}>
                  <PhoneOff aria-hidden className="size-4" /> End call
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => void call.start()} disabled={disabled} className={cx(buttonClasses.primary, 'px-4 py-2')}>
                  {state === 'error' ? <RotateCw aria-hidden className="size-4" /> : <Phone aria-hidden className="size-4" />}
                  {state === 'error' ? 'Try again' : state === 'ended' ? 'Call again' : 'Start call'}
                </button>
                <button type="button" onClick={onSwitchToChat} className={buttonClasses.secondary}>
                  <MessageSquare aria-hidden className="size-4" /> Switch to chat
                </button>
              </>
            )}
          </div>
          {state === 'idle' ? (
            <p className="mt-2 text-center text-xs text-faint">Uses your microphone. Interrupt Nova any time by speaking. Same conversation as chat.</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
