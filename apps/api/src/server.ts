import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { getConnInfo } from '@hono/node-server/conninfo';
import type postgres from 'postgres';
import { z } from 'zod';
import { type AgentDeps, newId, runTurn } from '@sa/agent';
import { ChaosFlags, CreateTurnBody, VoiceTranscriptBody, VoiceUsageBody, realtimeCost, redactPins, TRANSCRIBE_PER_MIN, type AgentEvent, type TurnTrace } from '@sa/shared';
import { dataPath } from '@sa/shared/env';
import { readFileSync } from 'node:fs';
import type { Config } from './config';
import type { pgBudget, pgStore } from './db';
import { RateLimiter } from './ratelimit';
import { mintRealtimeSecret } from './realtime';

interface AppDeps {
  cfg: Config;
  sql: postgres.Sql;
  store: ReturnType<typeof pgStore>;
  budget: ReturnType<typeof pgBudget>;
  agent: AgentDeps;
}

export function buildApp({ cfg, sql, store, budget, agent }: AppDeps) {
  const app = new Hono();
  const turnLimiter = RateLimiter.perMinute(cfg.turnsPerMin);
  const sessionLimiter = RateLimiter.perHour(cfg.sessionsPerHour);
  const voiceLimiter = RateLimiter.perHour(cfg.voicePerHour);
  const demoHints = JSON.parse(readFileSync(dataPath('fixtures', 'demo-hints.json'), 'utf8')) as unknown[];

  const ip = (c: Context) => {
    if (cfg.trustProxy) {
      // Cloudflare → nginx → api. Origin-direct requests could spoof these; acceptable for a demo,
      // production would restrict the origin to Cloudflare IP ranges.
      const real = c.req.header('cf-connecting-ip') ?? c.req.header('x-real-ip');
      if (real) return real;
    }
    try { return getConnInfo(c).remote.address ?? 'unknown'; } catch { return 'unknown'; }
  };
  const limited = (c: Context, waitMs: number) => {
    c.header('Retry-After', String(Math.ceil(waitMs / 1000)));
    return c.json({ error: 'rate_limited', message: 'Too many requests, slow down a little.', retryAfterMs: waitMs }, 429);
  };

  if (cfg.corsOrigins.length) app.use('/api/*', cors({ origin: cfg.corsOrigins, allowHeaders: ['Content-Type'], allowMethods: ['GET', 'POST', 'PUT'] }));

  app.onError((err, c) => {
    console.error('[api]', c.req.method, c.req.path, err);
    if (err instanceof z.ZodError) return c.json({ error: 'bad_request', issues: err.issues }, 400);
    return c.json({ error: 'internal', message: 'Something went wrong.' }, 500);
  });

  app.get('/api/health', async (c) => {
    const [r] = await sql<{ n: number; v: string | null }[]>`select count(*)::int as n, max(corpus_version) as v from chunks`;
    return c.json({ ok: true, chunks: r?.n ?? 0, corpusVersion: r?.v ?? null, models: { agent: agent.config.agentModel, fallback: agent.config.fallbackModel, judge: agent.config.judgeModel, realtime: cfg.realtime.model } });
  });

  app.get('/api/demo', (c) => c.json({ customers: demoHints, thresholds: cfg.thresholds }));

  app.get('/api/budget', async (c) => c.json({ todayUsd: await budget.today(), dailyCapUsd: cfg.dailyBudgetUsd, sessionCapUsd: cfg.sessionBudgetUsd }));

  app.post('/api/sessions', async (c) => {
    const wait = sessionLimiter.take(ip(c));
    if (wait) return limited(c, wait);
    return c.json(await store.create(ip(c)), 201);
  });

  app.get('/api/sessions/:id', async (c) => {
    const s = await store.get(c.req.param('id'));
    return s ? c.json(s) : c.json({ error: 'not_found' }, 404);
  });

  app.get('/api/sessions/:id/traces', async (c) => c.json(await store.traces(c.req.param('id'))));

  app.put('/api/sessions/:id/chaos', async (c) => {
    const id = c.req.param('id');
    if (!(await store.get(id))) return c.json({ error: 'not_found' }, 404);
    const flags = ChaosFlags.parse(await c.req.json());
    await store.setChaos(id, flags);
    return c.json(flags);
  });

  // ---- one agent turn, streamed as SSE. Same endpoint for text and voice (consult_agent).
  app.post('/api/sessions/:id/turns', async (c) => {
    const id = c.req.param('id');
    const wait = turnLimiter.take(ip(c));
    if (wait) return limited(c, wait);
    const body = CreateTurnBody.parse(await c.req.json());
    if (!(await store.get(id))) return c.json({ error: 'not_found' }, 404);

    c.header('X-Accel-Buffering', 'no'); // nginx: don't buffer the event stream
    c.header('Cache-Control', 'no-cache, no-transform');
    return streamSSE(c, async (stream) => {
      const ac = new AbortController();
      stream.onAbort(() => ac.abort());
      const send = (e: AgentEvent) => stream.writeSSE({ event: e.type, data: JSON.stringify(e) }).catch(() => ac.abort());
      const heartbeat = setInterval(() => { void stream.write(': ping\n\n').catch(() => {}); }, 10_000);
      try {
        await runTurn({ sessionId: id, text: body.text, mode: body.mode, persistMessages: body.mode === 'text', signal: ac.signal, emit: send }, agent);
      } finally {
        clearInterval(heartbeat);
      }
    });
  });

  // ---- voice
  app.post('/api/sessions/:id/voice/token', async (c) => {
    const wait = voiceLimiter.take(ip(c));
    if (wait) return limited(c, wait);
    const s = await store.get(c.req.param('id'));
    if (!s) return c.json({ error: 'not_found' }, 404);
    try {
      await budget.check(s.id);
    } catch {
      return c.json({ error: 'budget_exceeded', message: 'This demo has reached its usage limit for today.' }, 402);
    }
    return c.json(await mintRealtimeSecret(cfg, s));
  });

  /** What was actually said in the call (assistant lines are marked if the customer cut them off). */
  app.post('/api/sessions/:id/voice/transcript', async (c) => {
    const id = c.req.param('id');
    const b = VoiceTranscriptBody.parse(await c.req.json());
    if (!(await store.get(id))) return c.json({ error: 'not_found' }, 404);
    const msg = { id: newId('msg'), role: b.role, mode: 'voice' as const, content: redactPins(b.text), at: Date.now(), ...(b.interrupted ? { interrupted: true } : {}) };
    await store.appendMessage(id, msg);
    return c.json(msg, 201);
  });

  /** Realtime usage reported by the browser from response.done events → cost ledger + a voice trace row. */
  app.post('/api/sessions/:id/voice/usage', async (c) => {
    const id = c.req.param('id');
    const u = VoiceUsageBody.parse(await c.req.json());
    if (!(await store.get(id))) return c.json({ error: 'not_found' }, 404);
    const cost = realtimeCost(u.model, u) + ((u.transcribeSeconds ?? 0) / 60) * (TRANSCRIBE_PER_MIN[cfg.realtime.transcribeModel] ?? 0);
    await budget.add(id, cost);
    const lat = u.latencyMs ?? [];
    const trace: TurnTrace = {
      turnId: newId('voice'), sessionId: id, mode: 'voice', userText: '(realtime audio segment)', startedAt: Date.now(), durationMs: 0,
      firstStatusMs: null, answerReadyMs: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null,
      spans: [{ id: newId('sp'), parentId: null, name: 'realtime.audio', kind: 'llm', startMs: 0, durationMs: 0, status: 'ok', model: u.model, usage: { inputTokens: u.audioIn + u.audioCached + u.textIn + u.textCached, cachedInputTokens: u.audioCached + u.textCached, outputTokens: u.audioOut + u.textOut }, costUsd: cost, attrs: { ...u } }],
      totals: { inputTokens: u.audioIn + u.audioCached + u.textIn + u.textCached, outputTokens: u.audioOut + u.textOut, costUsd: cost, llmCalls: 1, toolCalls: 0 },
      outcome: 'voice_usage',
    };
    await store.saveTrace(trace);
    return c.json({ costUsd: cost });
  });

  return app;
}
