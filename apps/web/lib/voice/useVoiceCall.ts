'use client';
// Live voice call: OpenAI Realtime (GA) over WebRTC, browser ↔ OpenAI directly.
// The realtime model is only Nova's voice; every factual request goes through the consult_agent tool,
// which runs the SAME agent turn as chat (via `runTurn(…, 'voice')`), so steps and traces show up the same way.
import { useCallback, useEffect, useRef, useState } from 'react';
import { realtimeCost, type ChatMessage, type VoiceUsageBody } from '@sa/shared';
import { api, ApiError } from '../api';
import type { RunTurnOptions, TurnResult } from '../useSession';
import {
  addUsage,
  parseServerEvent,
  usageIsEmpty,
  zeroUsage,
  type RealtimeClientEvent,
  type RealtimeServerEvent,
  type UsageCounters,
} from './realtimeEvents';

export type CallState = 'idle' | 'connecting' | 'listening' | 'user_speaking' | 'thinking' | 'assistant_speaking' | 'ended' | 'error';
export type EndReason = 'hangup' | 'dropped' | 'timeout' | 'unmount';

export interface CallError {
  kind: 'mic' | 'budget' | 'rate_limited' | 'network' | 'webrtc' | 'unsupported';
  message: string;
}

/** A transcript line that is still being spoken / transcribed. Rendered at the end of the message list. */
export interface LivePartial {
  key: string;
  role: 'user' | 'assistant';
  text: string;
  seq: number;
  interrupted: boolean;
}

export interface Analysers {
  mic: AnalyserNode | null;
  nova: AnalyserNode | null;
}

interface AssistantLine {
  responseId: string;
  seq: number;
  text: string;
  /** transcript .done received */
  done: boolean;
  responseDone: boolean;
  playing: boolean;
  everPlayed: boolean;
  playbackEnded: boolean;
  interrupted: boolean;
  posted: boolean;
  fallbackTimer: number | null;
}

interface UserLine {
  itemId: string;
  seq: number;
  text: string;
  posted: boolean;
}

interface Consult {
  callId: string;
  ac: AbortController;
  answered: boolean;
}

interface CallCtx {
  ended: boolean;
  sessionId: string;
  model: string;
  maxSeconds: number;
  pc: RTCPeerConnection | null;
  dc: RTCDataChannel | null;
  ms: MediaStream | null;
  audio: HTMLAudioElement | null;
  audioCtx: AudioContext | null;
  connectedAt: number | null;
  tick: number | null;
  usageTimer: number | null;
  dropTimer: number | null;
  /** Counters since the last /voice/usage post. */
  usage: UsageCounters;
  /** Whole-call counters for the live cost readout. */
  total: UsageCounters;
  latencies: number[];
  speechSeconds: number;
  speechStartedAt: number | null;
  lastSpeechStoppedAt: number | null;
  userSpeaking: boolean;
  awaiting: boolean;
  playingResponseId: string | null;
  assistant: Map<string, AssistantLine>;
  user: Map<string, UserLine>;
  consult: Consult | null;
  handledCalls: Set<string>;
}

export interface UseVoiceCallOptions {
  sessionId: string | null;
  runTurn: (text: string, mode: 'voice', opts: RunTurnOptions) => Promise<TurnResult>;
  addTranscript: (msg: ChatMessage, seq: number) => void;
  nextSeq: () => number;
  onEnded: (reason: EndReason) => void;
  onInterrupted?: () => void;
  onServerError?: (message: string) => void;
  onUsagePosted?: () => void;
}

const REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';
const USAGE_FLUSH_MS = 30_000;
const DROP_GRACE_MS = 5_000;
/** If a response finished but its audio never started playing, post the transcript after this long. */
const NO_AUDIO_FALLBACK_MS = 1_500;
const CANCELLED_OUTPUT = { status: 'cancelled', note: 'customer interrupted; answer their new message' } as const;

class CallFailure extends Error {
  constructor(
    readonly kind: CallError['kind'],
    message: string,
  ) {
    super(message);
  }
}

function micFailure(err: unknown): CallFailure {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return new CallFailure('mic', 'Microphone access is blocked. Allow it in your browser’s site settings, or keep going in chat.');
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return new CallFailure('mic', 'No microphone was found on this device.');
  if (name === 'NotReadableError') return new CallFailure('mic', 'Your microphone is busy in another app.');
  return new CallFailure('mic', 'Could not access the microphone.');
}

function toCallError(err: unknown): CallError {
  if (err instanceof CallFailure) return { kind: err.kind, message: err.message };
  if (err instanceof ApiError) {
    if (err.code === 'budget_exceeded') return { kind: 'budget', message: err.message };
    if (err.code === 'rate_limited') {
      const s = err.retryAfterMs ? Math.ceil(err.retryAfterMs / 1000) : null;
      return { kind: 'rate_limited', message: `Voice calls are rate limited for this demo${s ? `; try again in ${s}s` : ''}. Chat still works.` };
    }
    return { kind: 'network', message: err.message };
  }
  return { kind: 'webrtc', message: 'Could not set up the audio connection to the voice service.' };
}

function parseRequest(args: string): string | null {
  try {
    const v: unknown = JSON.parse(args);
    if (typeof v === 'object' && v !== null && 'request' in v && typeof v.request === 'string' && v.request.trim()) return v.request.trim();
  } catch {
    /* fall through */
  }
  return null;
}

function newCtx(sessionId: string): CallCtx {
  return {
    ended: false, sessionId, model: '', maxSeconds: 300,
    pc: null, dc: null, ms: null, audio: null, audioCtx: null,
    connectedAt: null, tick: null, usageTimer: null, dropTimer: null,
    usage: zeroUsage(), total: zeroUsage(), latencies: [], speechSeconds: 0,
    speechStartedAt: null, lastSpeechStoppedAt: null, userSpeaking: false, awaiting: false, playingResponseId: null,
    assistant: new Map(), user: new Map(), consult: null, handledCalls: new Set(),
  };
}

const localMessage = (role: 'user' | 'assistant', content: string, interrupted: boolean): ChatMessage => ({
  id: `local_voice_${Math.random().toString(36).slice(2, 10)}`,
  role,
  mode: 'voice',
  content,
  at: Date.now(),
  ...(interrupted ? { interrupted: true } : {}),
});

export function useVoiceCall(options: UseVoiceCallOptions) {
  const [state, setState] = useState<CallState>('idle');
  const [error, setError] = useState<CallError | null>(null);
  const [muted, setMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [maxSeconds, setMaxSeconds] = useState<number | null>(null);
  const [partials, setPartials] = useState<LivePartial[]>([]);
  const [consultKey, setConsultKey] = useState<string | null>(null);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [costUsd, setCostUsd] = useState(0);
  const [interruptedAt, setInterruptedAt] = useState<number | null>(null);

  const ctxRef = useRef<CallCtx | null>(null);
  const analysersRef = useRef<Analysers>({ mic: null, nova: null });
  const optsRef = useRef(options);
  useEffect(() => {
    optsRef.current = options;
  });

  // ---------- helpers that only touch the call context + React state ----------

  const settle = useCallback((ctx: CallCtx) => {
    if (ctx.ended) return;
    setState(ctx.playingResponseId ? 'assistant_speaking' : ctx.userSpeaking ? 'user_speaking' : ctx.consult || ctx.awaiting ? 'thinking' : 'listening');
  }, []);

  const syncPartials = useCallback((ctx: CallCtx) => {
    if (ctxRef.current !== ctx) return;
    const list: LivePartial[] = [];
    for (const u of ctx.user.values()) list.push({ key: `u_${u.itemId}`, role: 'user', text: u.text, seq: u.seq, interrupted: false });
    for (const a of ctx.assistant.values()) if (a.text) list.push({ key: `a_${a.responseId}`, role: 'assistant', text: a.text, seq: a.seq, interrupted: a.interrupted });
    setPartials(list.sort((x, y) => x.seq - y.seq));
  }, []);

  const send = useCallback((ctx: CallCtx, ev: RealtimeClientEvent) => {
    if (ctx.dc?.readyState === 'open') ctx.dc.send(JSON.stringify(ev));
  }, []);

  const postUser = useCallback(
    (ctx: CallCtx, line: UserLine) => {
      if (line.posted) return;
      line.posted = true;
      const text = line.text.trim();
      if (!text) {
        ctx.user.delete(line.itemId);
        syncPartials(ctx);
        return;
      }
      api
        .voiceTranscript(ctx.sessionId, { role: 'user', text })
        .then((msg) => optsRef.current.addTranscript(msg, line.seq))
        .catch(() => optsRef.current.addTranscript(localMessage('user', text, false), line.seq))
        .finally(() => {
          ctx.user.delete(line.itemId);
          syncPartials(ctx);
        });
    },
    [syncPartials],
  );

  const postAssistant = useCallback(
    (ctx: CallCtx, line: AssistantLine) => {
      if (line.posted) return;
      line.posted = true;
      if (line.fallbackTimer !== null) window.clearTimeout(line.fallbackTimer);
      const text = line.text.trim();
      if (!text) {
        ctx.assistant.delete(line.responseId);
        syncPartials(ctx);
        return;
      }
      const interrupted = line.interrupted;
      api
        .voiceTranscript(ctx.sessionId, { role: 'assistant', text, ...(interrupted ? { interrupted: true } : {}) })
        .then((msg) => optsRef.current.addTranscript(msg, line.seq))
        .catch(() => optsRef.current.addTranscript(localMessage('assistant', text, interrupted), line.seq))
        .finally(() => {
          ctx.assistant.delete(line.responseId);
          syncPartials(ctx);
        });
    },
    [syncPartials],
  );

  /**
   * Nova's transcript arrives faster than her audio plays, so a line is only final once playback ends
   * (or is cut off). That is what lets us mark it `interrupted` correctly on barge-in.
   */
  const maybePostAssistant = useCallback(
    (ctx: CallCtx, line: AssistantLine) => {
      if (line.posted || !(line.done || line.responseDone) || line.playing) return;
      if (line.everPlayed ? line.playbackEnded : false) return postAssistant(ctx, line);
      if (!line.everPlayed && line.responseDone && line.fallbackTimer === null) {
        line.fallbackTimer = window.setTimeout(() => {
          line.fallbackTimer = null;
          if (!line.everPlayed) postAssistant(ctx, line);
        }, NO_AUDIO_FALLBACK_MS);
      }
    },
    [postAssistant],
  );

  const ensureUser = (ctx: CallCtx, itemId: string): UserLine => {
    let l = ctx.user.get(itemId);
    if (!l) {
      l = { itemId, seq: optsRef.current.nextSeq(), text: '', posted: false };
      ctx.user.set(itemId, l);
    }
    return l;
  };

  const ensureAssistant = (ctx: CallCtx, responseId: string): AssistantLine => {
    let l = ctx.assistant.get(responseId);
    if (!l) {
      l = { responseId, seq: optsRef.current.nextSeq(), text: '', done: false, responseDone: false, playing: false, everPlayed: false, playbackEnded: false, interrupted: false, posted: false, fallbackTimer: null };
      ctx.assistant.set(responseId, l);
    }
    return l;
  };

  const flushUsage = useCallback(async (ctx: CallCtx, keepalive: boolean) => {
    if (!ctx.model || (usageIsEmpty(ctx.usage) && ctx.latencies.length === 0 && ctx.speechSeconds === 0)) return;
    const body: VoiceUsageBody = {
      model: ctx.model,
      ...ctx.usage,
      transcribeSeconds: Math.round(ctx.speechSeconds * 10) / 10,
      latencyMs: ctx.latencies.map(Math.round),
    };
    const snapshot = { usage: ctx.usage, latencies: ctx.latencies, speech: ctx.speechSeconds };
    ctx.usage = zeroUsage();
    ctx.latencies = [];
    ctx.speechSeconds = 0;
    try {
      await api.voiceUsage(ctx.sessionId, body, keepalive);
      optsRef.current.onUsagePosted?.();
    } catch {
      if (keepalive) return;
      // Put the counters back so the next flush retries them.
      for (const k of Object.keys(snapshot.usage) as (keyof UsageCounters)[]) ctx.usage[k] += snapshot.usage[k];
      ctx.latencies.unshift(...snapshot.latencies);
      ctx.speechSeconds += snapshot.speech;
    }
  }, []);

  const teardown = useCallback((ctx: CallCtx) => {
    for (const t of [ctx.tick, ctx.usageTimer]) if (t !== null) window.clearInterval(t);
    if (ctx.dropTimer !== null) window.clearTimeout(ctx.dropTimer);
    ctx.tick = ctx.usageTimer = ctx.dropTimer = null;
    for (const l of ctx.assistant.values()) if (l.fallbackTimer !== null) window.clearTimeout(l.fallbackTimer);
    ctx.ms?.getTracks().forEach((t) => t.stop());
    try {
      ctx.dc?.close();
    } catch {
      /* already closed */
    }
    try {
      ctx.pc?.getSenders().forEach((s) => s.track?.stop());
      ctx.pc?.close();
    } catch {
      /* already closed */
    }
    if (ctx.audio) {
      ctx.audio.pause();
      ctx.audio.srcObject = null;
    }
    void ctx.audioCtx?.close().catch(() => {});
    analysersRef.current = { mic: null, nova: null };
  }, []);

  /** End the call: cut off anything in flight, save transcripts + usage, release devices. */
  const finish = useCallback(
    async (reason: EndReason) => {
      const ctx = ctxRef.current;
      if (!ctx || ctx.ended) return;
      ctx.ended = true;
      ctx.consult?.ac.abort();
      ctx.consult = null;
      for (const l of ctx.assistant.values()) {
        if (l.playing) l.interrupted = true;
        if (!l.posted) postAssistant(ctx, l);
      }
      for (const u of ctx.user.values()) if (!u.posted) postUser(ctx, u);
      teardown(ctx);
      setState(reason === 'unmount' ? 'idle' : 'ended');
      setMuted(false);
      await flushUsage(ctx, reason === 'unmount');
      optsRef.current.onEnded(reason);
    },
    [flushUsage, postAssistant, postUser, teardown],
  );

  // ---------- consult_agent ----------

  const handleFunctionCall = useCallback(
    async (ctx: CallCtx, e: Extract<RealtimeServerEvent, { type: 'response.function_call_arguments.done' }>) => {
      if (ctx.handledCalls.has(e.call_id)) return;
      ctx.handledCalls.add(e.call_id);
      const output = (payload: unknown) =>
        send(ctx, { type: 'conversation.item.create', item: { type: 'function_call_output', call_id: e.call_id, output: JSON.stringify(payload) } });
      const respond = () => {
        ctx.awaiting = true;
        send(ctx, { type: 'response.create' });
        settle(ctx);
      };

      // consult_agent is the only tool in the session config; tolerate a missing `name`.
      if (e.name && e.name !== 'consult_agent') {
        output({ error: 'unknown_tool', message: `No tool named ${e.name}.` });
        respond();
        return;
      }
      const request = parseRequest(e.arguments);
      if (!request) {
        output({ error: 'bad_arguments', message: 'consult_agent needs a "request" string.' });
        respond();
        return;
      }

      ctx.consult?.ac.abort();
      const consult: Consult = { callId: e.call_id, ac: new AbortController(), answered: false };
      ctx.consult = consult;
      settle(ctx);

      const st: { answer: { text: string; kind: string | null } | null; ticketId: string | null } = { answer: null, ticketId: null };
      const sendAnswer = () => {
        if (!st.answer || consult.answered || consult.ac.signal.aborted || ctx.ended) return;
        consult.answered = true;
        output({ answer: st.answer.text, kind: st.answer.kind, ticket_id: st.ticketId });
        respond();
      };

      const result = await optsRef.current.runTurn(request, 'voice', {
        signal: consult.ac.signal,
        onStart: (key) => setConsultKey(key),
        onEvent: (ev) => {
          if (ctx.ended || consult.answered) return;
          if (ev.type === 'message.completed') {
            // The ticket (if any) is emitted right after message.completed, so hold the answer for one event.
            st.answer = { text: ev.message.content, kind: ev.message.kind ?? null };
            return;
          }
          if (ev.type === 'escalated') st.ticketId = ev.ticket.id;
          if (ev.type === 'error' && !st.answer) {
            consult.answered = true;
            output({ error: ev.code, message: ev.message });
            respond();
            return;
          }
          sendAnswer();
        },
      });

      if (ctx.consult === consult) ctx.consult = null;
      if (ctx.ended) return;
      if (consult.ac.signal.aborted) {
        // Barge-in: tell the model the lookup was dropped, but let the server's own response to the new
        // user speech do the talking (no response.create).
        if (!consult.answered) {
          consult.answered = true;
          output(CANCELLED_OUTPUT);
        }
      } else if (!consult.answered) {
        if (st.answer) sendAnswer();
        else {
          consult.answered = true;
          output({ error: result.error?.code ?? 'no_answer', message: result.error?.message ?? 'The support system did not return an answer.' });
          respond();
        }
      }
      settle(ctx);
    },
    [send, settle],
  );

  // ---------- server events ----------

  const handleEvent = useCallback(
    (ctx: CallCtx, e: RealtimeServerEvent) => {
      if (ctx.ended) return;
      switch (e.type) {
        case 'input_audio_buffer.speech_started': {
          ctx.speechStartedAt = performance.now();
          ctx.userSpeaking = true;
          if (ctx.playingResponseId) {
            // Barge-in. The server cancels the response itself (interrupt_response) — we only mark + show it.
            const line = ctx.assistant.get(ctx.playingResponseId);
            if (line) line.interrupted = true;
            setInterruptedAt(Date.now());
            optsRef.current.onInterrupted?.();
          }
          // A new utterance makes any in-flight lookup stale.
          if (ctx.consult && !ctx.consult.answered) ctx.consult.ac.abort();
          ensureUser(ctx, e.item_id);
          syncPartials(ctx);
          setState('user_speaking');
          break;
        }
        case 'input_audio_buffer.speech_stopped': {
          const now = performance.now();
          ctx.lastSpeechStoppedAt = now;
          if (ctx.speechStartedAt !== null) ctx.speechSeconds += (now - ctx.speechStartedAt) / 1000;
          ctx.speechStartedAt = null;
          ctx.userSpeaking = false;
          ctx.awaiting = true;
          settle(ctx);
          break;
        }
        case 'conversation.item.input_audio_transcription.delta': {
          const l = ensureUser(ctx, e.item_id);
          if (!l.posted) l.text += e.delta;
          syncPartials(ctx);
          break;
        }
        case 'conversation.item.input_audio_transcription.completed': {
          const l = ensureUser(ctx, e.item_id);
          if (l.posted) break;
          l.text = e.transcript || l.text;
          postUser(ctx, l);
          syncPartials(ctx);
          break;
        }
        case 'conversation.item.input_audio_transcription.failed': {
          const l = ctx.user.get(e.item_id);
          if (l) postUser(ctx, l); // posts whatever partial text we have, or drops the empty bubble
          break;
        }
        case 'response.output_audio_transcript.delta': {
          const l = ensureAssistant(ctx, e.response_id);
          if (!l.posted) l.text += e.delta;
          syncPartials(ctx);
          break;
        }
        case 'response.output_audio_transcript.done': {
          const l = ensureAssistant(ctx, e.response_id);
          if (l.posted) break;
          l.text = e.transcript || l.text;
          l.done = true;
          maybePostAssistant(ctx, l);
          syncPartials(ctx);
          break;
        }
        case 'output_audio_buffer.started': {
          const l = ensureAssistant(ctx, e.response_id);
          l.playing = true;
          l.everPlayed = true;
          ctx.playingResponseId = e.response_id;
          ctx.awaiting = false;
          if (ctx.lastSpeechStoppedAt !== null) {
            const lat = performance.now() - ctx.lastSpeechStoppedAt;
            ctx.latencies.push(lat);
            setLastLatencyMs(Math.round(lat));
            ctx.lastSpeechStoppedAt = null;
          }
          settle(ctx);
          break;
        }
        case 'output_audio_buffer.stopped':
        case 'output_audio_buffer.cleared': {
          const rid = e.response_id ?? ctx.playingResponseId;
          const l = rid ? ctx.assistant.get(rid) : undefined;
          if (l) {
            if (e.type === 'output_audio_buffer.cleared' && l.playing) l.interrupted = true;
            l.playing = false;
            l.playbackEnded = true;
            maybePostAssistant(ctx, l);
          }
          if (!rid || ctx.playingResponseId === rid) ctx.playingResponseId = null;
          syncPartials(ctx);
          settle(ctx);
          break;
        }
        case 'response.function_call_arguments.done':
          void handleFunctionCall(ctx, e);
          break;
        case 'response.done': {
          addUsage(ctx.usage, e.response.usage);
          addUsage(ctx.total, e.response.usage);
          setCostUsd(realtimeCost(ctx.model, ctx.total));
          const l = ctx.assistant.get(e.response.id);
          if (l) {
            l.responseDone = true;
            if (e.response.status === 'cancelled' && l.playing) l.interrupted = true;
            maybePostAssistant(ctx, l);
          }
          if (!ctx.playingResponseId) ctx.awaiting = false;
          settle(ctx);
          break;
        }
        case 'error':
          optsRef.current.onServerError?.(e.error.message ?? 'The voice service reported an error.');
          break;
        default:
          break;
      }
    },
    [handleFunctionCall, maybePostAssistant, postUser, settle, syncPartials],
  );

  // ---------- public API ----------

  const start = useCallback(async () => {
    const sessionId = optsRef.current.sessionId;
    if (!sessionId) return;
    if (ctxRef.current && !ctxRef.current.ended) return;
    setError(null);
    setPartials([]);
    setElapsed(0);
    setMuted(false);
    setLastLatencyMs(null);
    setCostUsd(0);
    setConsultKey(null);
    setInterruptedAt(null);

    if (typeof RTCPeerConnection === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setState('error');
      setError({ kind: 'unsupported', message: 'This browser can’t make voice calls (WebRTC or microphone access unavailable).' });
      return;
    }

    const ctx = newCtx(sessionId);
    ctxRef.current = ctx;
    setState('connecting');
    // Created synchronously inside the click so autoplay / AudioContext policies see a user gesture.
    const audioCtx = new AudioContext();
    const audio = new Audio();
    audio.autoplay = true;
    ctx.audioCtx = audioCtx;
    ctx.audio = audio;

    try {
      const tok = await api.voiceToken(sessionId);
      if (ctx.ended) return;
      ctx.model = tok.model;
      ctx.maxSeconds = tok.maxSessionSeconds;
      setMaxSeconds(tok.maxSessionSeconds);

      let ms: MediaStream;
      try {
        ms = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      } catch (err) {
        throw micFailure(err);
      }
      if (ctx.ended) {
        ms.getTracks().forEach((t) => t.stop());
        return;
      }
      ctx.ms = ms;
      const track = ms.getAudioTracks()[0];
      if (!track) throw new CallFailure('mic', 'No microphone track available.');

      const micAnalyser = audioCtx.createAnalyser();
      micAnalyser.fftSize = 1024;
      audioCtx.createMediaStreamSource(ms).connect(micAnalyser);
      analysersRef.current.mic = micAnalyser;

      const pc = new RTCPeerConnection();
      ctx.pc = pc;
      pc.ontrack = (ev) => {
        const stream = ev.streams[0];
        if (!stream) return;
        audio.srcObject = stream;
        void audio.play().catch(() => {});
        try {
          const a = audioCtx.createAnalyser();
          a.fftSize = 1024;
          audioCtx.createMediaStreamSource(stream).connect(a); // analysis only; playback is the <audio> element
          analysersRef.current.nova = a;
        } catch {
          /* waveform is cosmetic */
        }
      };
      pc.addTrack(track, ms);

      const dc = pc.createDataChannel('oai-events');
      ctx.dc = dc;
      dc.onopen = () => {
        if (ctx.ended) return;
        ctx.connectedAt = performance.now();
        void audioCtx.resume().catch(() => {});
        setState('listening');
        ctx.tick = window.setInterval(() => {
          if (ctx.connectedAt === null) return;
          const secs = (performance.now() - ctx.connectedAt) / 1000;
          setElapsed(Math.floor(secs));
          if (secs >= ctx.maxSeconds) void finish('timeout');
        }, 250);
        ctx.usageTimer = window.setInterval(() => void flushUsage(ctx, false), USAGE_FLUSH_MS);
      };
      dc.onmessage = (ev: MessageEvent) => {
        const parsed = parseServerEvent(ev.data);
        if (parsed) handleEvent(ctx, parsed);
      };
      dc.onclose = () => {
        if (!ctx.ended) void finish('dropped');
      };
      pc.onconnectionstatechange = () => {
        const s = pc.connectionState;
        if (s === 'failed') void finish('dropped');
        else if (s === 'disconnected') {
          if (ctx.dropTimer === null)
            ctx.dropTimer = window.setTimeout(() => {
              ctx.dropTimer = null;
              if (pc.connectionState !== 'connected') void finish('dropped');
            }, DROP_GRACE_MS);
        } else if (s === 'connected' && ctx.dropTimer !== null) {
          window.clearTimeout(ctx.dropTimer);
          ctx.dropTimer = null;
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      let r: Response;
      try {
        r = await fetch(REALTIME_CALLS_URL, {
          method: 'POST',
          body: offer.sdp ?? '',
          headers: { Authorization: `Bearer ${tok.clientSecret}`, 'Content-Type': 'application/sdp' },
        });
      } catch {
        throw new CallFailure('network', 'Couldn’t reach the voice service.');
      }
      if (!r.ok) throw new CallFailure('webrtc', `The voice service refused the call (HTTP ${r.status}). Try again in a moment.`);
      const sdp = await r.text();
      if (ctx.ended) return;
      await pc.setRemoteDescription({ type: 'answer', sdp });
    } catch (err) {
      if (ctx.ended) return;
      ctx.ended = true;
      teardown(ctx);
      setState('error');
      setError(toCallError(err));
    }
  }, [finish, flushUsage, handleEvent, teardown]);

  const hangUp = useCallback(() => finish('hangup'), [finish]);

  const toggleMute = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx || ctx.ended || !ctx.ms) return;
    const next = !ctx.ms.getAudioTracks().every((t) => !t.enabled);
    ctx.ms.getAudioTracks().forEach((t) => (t.enabled = !next));
    setMuted(next);
  }, []);

  const reset = useCallback(() => {
    if (ctxRef.current && !ctxRef.current.ended) return;
    setState('idle');
    setError(null);
  }, []);

  // Leaving the page mid-call: save usage with a keepalive request and release the mic.
  useEffect(() => {
    const onHide = () => void finish('unmount');
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      void finish('unmount');
    };
  }, [finish]);

  const active = state === 'connecting' || state === 'listening' || state === 'user_speaking' || state === 'thinking' || state === 'assistant_speaking';

  return {
    state,
    active,
    error,
    muted,
    elapsed,
    maxSeconds,
    partials,
    consultKey,
    lastLatencyMs,
    costUsd,
    interruptedAt,
    analysers: analysersRef,
    start,
    hangUp,
    toggleMute,
    reset,
  };
}

export type VoiceCall = ReturnType<typeof useVoiceCall>;
