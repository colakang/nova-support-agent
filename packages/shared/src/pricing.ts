// USD per 1M tokens. Checked 2026-11-21 against developers.openai.com/api/docs/pricing (standard tier).
// Estimates only — the drawer labels them as such.
export interface TextPrice { input: number; cachedInput: number; output: number }
export interface RealtimePrice { audioIn: number; audioCached: number; audioOut: number; textIn: number; textCached: number; textOut: number }

export const TEXT_PRICES: Record<string, TextPrice> = {
  'gpt-6.1-terra': { input: 1.0, cachedInput: 0.05, output: 5.0 },
  'gpt-6-luna': { input: 0.1, cachedInput: 0.01, output: 0.5 },
  'gpt-5.4-mini': { input: 0.75, cachedInput: 0.075, output: 4.5 },
  'gpt-4.1-mini': { input: 0.4, cachedInput: 0.1, output: 1.6 },
  'text-embedding-3-small': { input: 0.02, cachedInput: 0.02, output: 0 },
};

export const REALTIME_PRICES: Record<string, RealtimePrice> = {
  'gpt-realtime-2.1': { audioIn: 32, audioCached: 0.4, audioOut: 64, textIn: 4.0, textCached: 0.4, textOut: 24.0 },
  'gpt-realtime-2.1-mini': { audioIn: 10, audioCached: 0.3, audioOut: 20, textIn: 0.6, textCached: 0.06, textOut: 2.4 },
  'gpt-realtime-mini': { audioIn: 10, audioCached: 0.3, audioOut: 20, textIn: 0.6, textCached: 0.06, textOut: 2.4 },
};

export const TRANSCRIBE_PER_MIN: Record<string, number> = {
  'gpt-4o-mini-transcribe': 0.003,
  'gpt-4o-transcribe': 0.006,
};

const M = 1_000_000;

function priceKey<T>(table: Record<string, T>, model: string): T | undefined {
  if (table[model]) return table[model];
  // dated snapshots, e.g. gpt-6.1-terra-2026-10-01
  const k = Object.keys(table).find((key) => model.startsWith(key));
  return k ? table[k] : undefined;
}

export function textCost(model: string, u: { inputTokens: number; cachedInputTokens: number; outputTokens: number }): number {
  const p = priceKey(TEXT_PRICES, model);
  if (!p) return 0;
  const fresh = Math.max(0, u.inputTokens - u.cachedInputTokens);
  return (fresh * p.input + u.cachedInputTokens * p.cachedInput + u.outputTokens * p.output) / M;
}

export function realtimeCost(model: string, u: { audioIn: number; audioCached: number; audioOut: number; textIn: number; textCached: number; textOut: number }): number {
  const p = priceKey(REALTIME_PRICES, model);
  if (!p) return 0;
  return (
    (u.audioIn * p.audioIn + u.audioCached * p.audioCached + u.audioOut * p.audioOut + u.textIn * p.textIn + u.textCached * p.textCached + u.textOut * p.textOut) / M
  );
}
