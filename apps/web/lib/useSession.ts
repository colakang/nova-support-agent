'use client';
// Session state for the console: the SessionView, a merged message timeline, live turn activity,
// traces, budget and demo info. Text and voice share this one store, so switching modes keeps everything.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentEvent, ChaosFlags, ChatMessage, Mode, SessionView, Ticket, TurnTrace } from '@sa/shared';
import { api, ApiError, type ApiErrorCode, type Budget, type DemoInfo } from './api';
import { failActivity, newActivity, reduceActivity, type TurnActivity, type TurnError, type TurnErrorCode } from './turnActivity';

export type MessageOrigin = 'server' | 'optimistic' | 'turn' | 'transcript';

/** A chat message plus its position in the client timeline (`seq`), so live items interleave correctly. */
export interface MessageEntry {
  msg: ChatMessage;
  seq: number;
  origin: MessageOrigin;
}

export interface TurnResult {
  status: 'done' | 'error' | 'aborted';
  answer: ChatMessage | null;
  ticket: Ticket | null;
  error: TurnError | null;
  activityKey: string;
}

export interface RunTurnOptions {
  signal?: AbortSignal;
  /** Called after the event has been applied to the store. */
  onEvent?: (e: AgentEvent) => void;
  /** Called synchronously with the activity key once the turn is registered. */
  onStart?: (activityKey: string) => void;
}

export type BootStatus = 'loading' | 'ready' | 'error';

const STORAGE_KEY = 'northstar.sessionId';

function readStoredId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
function storeId(id: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* private mode / storage disabled: the session just won't survive a reload */
  }
}

export const sortEntries = (xs: MessageEntry[]) => [...xs].sort((a, b) => a.seq - b.seq);

/**
 * Merge a fresh server message list into local entries. Known messages keep their timeline position;
 * new ones slot in right after their server predecessor. Optimistic bubbles are dropped (the server list
 * is the truth); confirmed voice transcripts that raced the snapshot are kept.
 */
export function reconcileMessages(server: ChatMessage[], prev: MessageEntry[]): MessageEntry[] {
  const known = new Map(prev.map((e) => [e.msg.id, e] as const));
  const ids = new Set<string>();
  const out: MessageEntry[] = [];
  let lastSeq = 0;
  for (const m of server) {
    ids.add(m.id);
    const k = known.get(m.id);
    const seq = k ? k.seq : lastSeq + 0.001;
    out.push({ msg: m, seq, origin: 'server' });
    lastSeq = seq;
  }
  for (const e of prev) if (e.origin === 'transcript' && !ids.has(e.msg.id)) out.push(e);
  return out;
}

function upsertTrace(list: TurnTrace[], t: TurnTrace): TurnTrace[] {
  const next = list.filter((x) => x.turnId !== t.turnId);
  next.push(t);
  return next.sort((a, b) => a.startedAt - b.startedAt);
}

function apiToTurnCode(c: ApiErrorCode): TurnErrorCode {
  switch (c) {
    case 'rate_limited':
    case 'budget_exceeded':
    case 'not_found':
    case 'network':
    case 'internal':
      return c;
    default:
      return 'http';
  }
}

const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';

export function useSession() {
  const [status, setStatus] = useState<BootStatus>('loading');
  const [initError, setInitError] = useState<string | null>(null);
  const [session, setSession] = useState<SessionView | null>(null);
  const [entries, setEntries] = useState<MessageEntry[]>([]);
  const [activities, setActivities] = useState<TurnActivity[]>([]);
  const [traces, setTraces] = useState<TurnTrace[]>([]);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [demo, setDemo] = useState<DemoInfo | null>(null);

  const sessionIdRef = useRef<string | null>(null);
  const entriesRef = useRef<MessageEntry[]>([]);
  const seqRef = useRef(1_000_000);
  const keyRef = useRef(0);
  const generationRef = useRef(0); // bumps on "New conversation": late events from the old session are ignored
  const textAbortRef = useRef<AbortController | null>(null);
  const textBusyRef = useRef(false);

  const nextSeq = useCallback(() => ++seqRef.current, []);

  /** Entries live in a ref (read synchronously by turn logic) mirrored into state for rendering. */
  const updateEntries = useCallback((fn: (prev: MessageEntry[]) => MessageEntry[]) => {
    entriesRef.current = fn(entriesRef.current);
    setEntries(entriesRef.current);
  }, []);

  const adopt = useCallback(
    (s: SessionView) => {
      sessionIdRef.current = s.id;
      setSession(s);
      updateEntries((prev) => reconcileMessages(s.messages, prev));
    },
    [updateEntries],
  );

  const refreshBudget = useCallback(async () => {
    try {
      setBudget(await api.budget());
    } catch {
      /* non-critical */
    }
  }, []);

  const refreshTraces = useCallback(async () => {
    const id = sessionIdRef.current;
    if (!id) return;
    try {
      const ts = await api.traces(id);
      if (id !== sessionIdRef.current) return;
      setTraces((prev) => ts.reduce(upsertTrace, prev));
    } catch {
      /* drawer keeps what it has */
    }
  }, []);

  const refresh = useCallback(async () => {
    const id = sessionIdRef.current;
    if (!id) return;
    try {
      const s = await api.getSession(id);
      if (id === sessionIdRef.current) adopt(s);
    } catch {
      /* keep local state */
    }
    await Promise.all([refreshTraces(), refreshBudget()]);
  }, [adopt, refreshTraces, refreshBudget]);

  const boot = useCallback(async () => {
    setStatus('loading');
    setInitError(null);
    try {
      const stored = readStoredId();
      let s: SessionView | null = null;
      if (stored) {
        try {
          s = await api.getSession(stored);
        } catch (e) {
          if (!(e instanceof ApiError && e.code === 'not_found')) throw e;
        }
      }
      if (!s) {
        s = await api.createSession();
        storeId(s.id);
      }
      adopt(s);
      setStatus('ready');
      void refreshTraces();
    } catch (e) {
      setStatus('error');
      setInitError(e instanceof ApiError ? e.message : "Couldn't reach the support service.");
    }
  }, [adopt, refreshTraces]);

  // Boot once (guarded against StrictMode's double effect run).
  const bootedRef = useRef(false);
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    void boot();
    api.demo().then(setDemo).catch(() => {});
  }, [boot]);

  useEffect(() => {
    void refreshBudget();
    const t = window.setInterval(() => void refreshBudget(), 60_000);
    return () => window.clearInterval(t);
  }, [refreshBudget]);

  /** Make the optimistic user bubble match what the server actually did (it de-duplicates retries). */
  const reconcileUserMessage = useCallback(
    (userMessage: ChatMessage, text: string, fallbackSeq: number) => {
      updateEntries((prev) => {
        if (prev.some((x) => x.msg.id === userMessage.id)) return prev;
        const sorted = sortEntries(prev).reverse();
        const opt = sorted.find((x) => x.origin === 'optimistic' && x.msg.content.trim() === text);
        const lastPersisted = sorted.find((x) => x.origin !== 'optimistic');
        const deduped = lastPersisted?.msg.role === 'user' && lastPersisted.msg.content.trim() === text;
        if (deduped) return opt ? prev.filter((x) => x !== opt) : prev;
        if (opt) return prev.map((x) => (x === opt ? { msg: userMessage, seq: x.seq, origin: 'turn' } : x));
        return [...prev, { msg: userMessage, seq: fallbackSeq, origin: 'turn' }];
      });
    },
    [updateEntries],
  );

  /** Run one agent turn over SSE. Used by chat (mode 'text') and by the voice consult_agent tool (mode 'voice'). */
  const runTurn = useCallback(
    async (rawText: string, mode: Mode, opts: RunTurnOptions = {}): Promise<TurnResult> => {
      const text = rawText.trim();
      const gen = generationRef.current;
      const key = `act_${++keyRef.current}`;

      if (mode === 'text') {
        const sorted = sortEntries(entriesRef.current).reverse();
        const lastPersisted = sorted.find((e) => e.origin !== 'optimistic');
        const lastAny = sorted[0];
        const serverWillDedupe = lastPersisted?.msg.role === 'user' && lastPersisted.msg.content.trim() === text;
        const reuse = lastAny?.origin === 'optimistic' && lastAny.msg.content.trim() === text;
        if (!serverWillDedupe && !reuse) {
          updateEntries((prev) => [...prev, { msg: { id: `local_${key}`, role: 'user', mode, content: text, at: Date.now() }, seq: nextSeq(), origin: 'optimistic' }]);
        }
      }

      let act = newActivity(key, text, mode, nextSeq());
      const live = () => gen === generationRef.current;
      const setAct = (fn: (a: TurnActivity) => TurnActivity) => {
        act = fn(act);
        const snapshot = act;
        if (live()) setActivities((prev) => prev.map((a) => (a.key === key ? snapshot : a)));
      };
      setActivities((prev) => [...prev, act]);
      opts.onStart?.(key);

      const done = (status: TurnResult['status'], answer: ChatMessage | null, ticket: Ticket | null): TurnResult => ({ status, answer, ticket, error: act.error, activityKey: key });

      const id = sessionIdRef.current;
      if (!id) {
        setAct((a) => failActivity(a, { code: 'not_found', message: 'No active conversation.', retryable: false, at: Date.now() }, 'error', nextSeq));
        return done('error', null, null);
      }

      let answer: ChatMessage | null = null;
      let ticket: Ticket | null = null;
      let completed = false;
      try {
        for await (const e of api.turn(id, { text, mode }, opts.signal)) {
          if (!live()) break;
          setAct((a) => reduceActivity(a, e, nextSeq));
          switch (e.type) {
            case 'turn.started':
              if (mode === 'text') reconcileUserMessage(e.userMessage, text, act.seq - 0.5);
              break;
            case 'message.completed':
              answer = e.message;
              // Voice answers are spoken by Nova; her transcript becomes the chat message instead.
              if (mode === 'text') {
                const m = e.message;
                updateEntries((prev) => (prev.some((x) => x.msg.id === m.id) ? prev : [...prev, { msg: m, seq: nextSeq(), origin: 'turn' }]));
              }
              break;
            case 'escalated':
              ticket = e.ticket;
              break;
            case 'session.updated':
              adopt(e.session);
              break;
            case 'trace':
              setTraces((prev) => upsertTrace(prev, e.trace));
              break;
            case 'turn.completed':
              completed = true;
              break;
            default:
              break;
          }
          opts.onEvent?.(e);
        }
        if (!live()) return done('aborted', answer, ticket);
        if (!completed) {
          if (opts.signal?.aborted) {
            setAct((a) => failActivity(a, null, 'aborted', nextSeq));
            return done('aborted', answer, ticket);
          }
          setAct((a) => failActivity(a, { code: 'network', message: 'The connection dropped before Nova finished. Your message is saved, so you can retry.', retryable: true, at: Date.now() }, 'error', nextSeq));
          return done('error', answer, ticket);
        }
        return done(act.error ? 'error' : act.status === 'aborted' ? 'aborted' : 'done', answer, ticket);
      } catch (err) {
        if (opts.signal?.aborted || isAbort(err)) {
          setAct((a) => failActivity(a, null, 'aborted', nextSeq));
          return done('aborted', answer, ticket);
        }
        const e: TurnError =
          err instanceof ApiError
            ? {
                code: apiToTurnCode(err.code),
                message: err.message,
                retryable: err.code !== 'budget_exceeded' && err.code !== 'not_found',
                at: Date.now(),
                ...(err.retryAfterMs !== undefined ? { retryAfterMs: err.retryAfterMs } : {}),
              }
            : { code: 'network', message: 'Lost connection to the support service. Your message may be saved; retry when you are back online.', retryable: true, at: Date.now() };
        setAct((a) => failActivity(a, e, 'error', nextSeq));
        return done('error', answer, ticket);
      } finally {
        if (live()) void refreshBudget();
      }
    },
    [adopt, nextSeq, reconcileUserMessage, refreshBudget, updateEntries],
  );

  const sendText = useCallback(
    async (text: string) => {
      if (!text.trim() || textBusyRef.current) return;
      textBusyRef.current = true;
      const ac = new AbortController();
      textAbortRef.current = ac;
      try {
        await runTurn(text, 'text', { signal: ac.signal });
      } finally {
        textBusyRef.current = false;
        if (textAbortRef.current === ac) textAbortRef.current = null;
      }
    },
    [runTurn],
  );

  const newConversation = useCallback(async () => {
    textAbortRef.current?.abort();
    generationRef.current++;
    try {
      const s = await api.createSession();
      storeId(s.id);
      entriesRef.current = [];
      setEntries([]);
      setActivities([]);
      setTraces([]);
      adopt(s);
      setStatus('ready');
      setInitError(null);
    } catch (e) {
      throw e instanceof ApiError ? e : new ApiError('network', "Couldn't start a new conversation.", 0);
    }
  }, [adopt]);

  /** Optimistic chaos toggle; reverts to `previous` if the PUT fails. */
  const setChaos = useCallback(async (flags: ChaosFlags, previous: ChaosFlags) => {
    const id = sessionIdRef.current;
    if (!id) return;
    setSession((s) => (s && s.id === id ? { ...s, chaos: flags } : s));
    try {
      const saved = await api.setChaos(id, flags);
      setSession((s) => (s && s.id === id ? { ...s, chaos: saved } : s));
    } catch (e) {
      setSession((s) => (s && s.id === id ? { ...s, chaos: previous } : s));
      throw e;
    }
  }, []);

  /** A voice transcript line the server confirmed (or a local fallback if the POST failed). */
  const addTranscript = useCallback(
    (msg: ChatMessage, seq: number) => {
      updateEntries((prev) =>
        prev.some((x) => x.msg.id === msg.id)
          ? prev.map((x) => (x.msg.id === msg.id ? { msg, seq, origin: 'transcript' } : x))
          : [...prev, { msg, seq, origin: 'transcript' }],
      );
    },
    [updateEntries],
  );

  const sortedEntries = useMemo(() => sortEntries(entries), [entries]);
  const busy = activities.some((a) => a.mode === 'text' && (a.status === 'pending' || a.status === 'running'));

  return {
    status,
    initError,
    session,
    sessionId: session?.id ?? null,
    entries: sortedEntries,
    activities,
    traces,
    budget,
    demo,
    busy,
    boot,
    runTurn,
    sendText,
    newConversation,
    setChaos,
    addTranscript,
    nextSeq,
    refresh,
    refreshTraces,
    refreshBudget,
  };
}

export type SessionController = ReturnType<typeof useSession>;
