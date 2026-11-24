import { env, envNum } from '@sa/shared/env';

export function loadConfig() {
  return {
    port: envNum('PORT', 8080),
    databaseUrl: env('DATABASE_URL'),
    corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    /** Only trust X-Forwarded-For when we sit behind our own Caddy. */
    trustProxy: process.env.TRUST_PROXY === '1',
    thresholds: { high: envNum('RETRIEVAL_TAU_HIGH', 0.63), low: envNum('RETRIEVAL_TAU_LOW', 0.5) },
    dailyBudgetUsd: envNum('DAILY_BUDGET_USD', 1.5),
    sessionBudgetUsd: envNum('SESSION_BUDGET_USD', 0.4),
    turnsPerMin: envNum('RATE_LIMIT_TURNS_PER_MIN', 12),
    sessionsPerHour: envNum('RATE_LIMIT_SESSIONS_PER_HOUR', 20),
    voicePerHour: envNum('RATE_LIMIT_VOICE_PER_HOUR', 30),
    realtime: {
      model: process.env.REALTIME_MODEL ?? 'gpt-realtime-2.1',
      voice: process.env.REALTIME_VOICE ?? 'marin',
      transcribeModel: process.env.TRANSCRIBE_MODEL ?? 'gpt-4o-mini-transcribe',
      maxSessionSeconds: envNum('VOICE_MAX_SESSION_SECONDS', 300),
    },
  };
}
export type Config = ReturnType<typeof loadConfig>;
