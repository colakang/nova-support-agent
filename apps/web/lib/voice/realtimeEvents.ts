// The subset of OpenAI Realtime (GA) server events the voice console reacts to, as a discriminated union.
// Anything else on the data channel is ignored.

export interface RealtimeUsage {
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  input_token_details?: {
    text_tokens?: number;
    audio_tokens?: number;
    cached_tokens?: number;
    cached_tokens_details?: { text_tokens?: number; audio_tokens?: number };
  };
  output_token_details?: { text_tokens?: number; audio_tokens?: number };
}

export type RealtimeServerEvent =
  | { type: 'session.created' }
  | { type: 'session.updated' }
  | { type: 'input_audio_buffer.speech_started'; item_id: string; audio_start_ms?: number }
  | { type: 'input_audio_buffer.speech_stopped'; item_id: string; audio_end_ms?: number }
  | { type: 'input_audio_buffer.committed'; item_id: string }
  | { type: 'conversation.item.input_audio_transcription.delta'; item_id: string; delta: string }
  | { type: 'conversation.item.input_audio_transcription.completed'; item_id: string; transcript: string }
  | { type: 'conversation.item.input_audio_transcription.failed'; item_id: string; error?: { message?: string } }
  | { type: 'response.created'; response: { id: string } }
  | { type: 'response.output_audio_transcript.delta'; response_id: string; item_id: string; delta: string }
  | { type: 'response.output_audio_transcript.done'; response_id: string; item_id: string; transcript: string }
  | { type: 'output_audio_buffer.started'; response_id: string }
  | { type: 'output_audio_buffer.stopped'; response_id: string }
  | { type: 'output_audio_buffer.cleared'; response_id?: string }
  | { type: 'response.function_call_arguments.done'; response_id: string; item_id: string; call_id: string; name?: string; arguments: string }
  | { type: 'response.done'; response: { id: string; status?: string; usage?: RealtimeUsage } }
  | { type: 'error'; error: { type?: string; code?: string | null; message?: string } };

export type RealtimeEventType = RealtimeServerEvent['type'];

const HANDLED: ReadonlySet<string> = new Set<RealtimeEventType>([
  'session.created',
  'session.updated',
  'input_audio_buffer.speech_started',
  'input_audio_buffer.speech_stopped',
  'input_audio_buffer.committed',
  'conversation.item.input_audio_transcription.delta',
  'conversation.item.input_audio_transcription.completed',
  'conversation.item.input_audio_transcription.failed',
  'response.created',
  'response.output_audio_transcript.delta',
  'response.output_audio_transcript.done',
  'output_audio_buffer.started',
  'output_audio_buffer.stopped',
  'output_audio_buffer.cleared',
  'response.function_call_arguments.done',
  'response.done',
  'error',
]);

/** Parse a data-channel message; returns null for malformed or uninteresting events. */
export function parseServerEvent(raw: unknown): RealtimeServerEvent | null {
  if (typeof raw !== 'string') return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null || !('type' in v) || typeof v.type !== 'string' || !HANDLED.has(v.type)) return null;
  return v as RealtimeServerEvent;
}

/** Client → server events we send. */
export type RealtimeClientEvent =
  | { type: 'conversation.item.create'; item: { type: 'function_call_output'; call_id: string; output: string } }
  | { type: 'response.create' };

export interface UsageCounters {
  audioIn: number;
  audioCached: number;
  audioOut: number;
  textIn: number;
  textCached: number;
  textOut: number;
}

export const zeroUsage = (): UsageCounters => ({ audioIn: 0, audioCached: 0, audioOut: 0, textIn: 0, textCached: 0, textOut: 0 });

/** Cached tokens are included in the input totals, so split them out (billing treats them separately). */
export function addUsage(acc: UsageCounters, u: RealtimeUsage | undefined): void {
  if (!u) return;
  const inD = u.input_token_details ?? {};
  const outD = u.output_token_details ?? {};
  const cachedAudio = inD.cached_tokens_details?.audio_tokens ?? 0;
  const cachedText = inD.cached_tokens_details?.text_tokens ?? 0;
  acc.audioIn += Math.max(0, (inD.audio_tokens ?? 0) - cachedAudio);
  acc.audioCached += cachedAudio;
  acc.textIn += Math.max(0, (inD.text_tokens ?? 0) - cachedText);
  acc.textCached += cachedText;
  acc.audioOut += outD.audio_tokens ?? 0;
  acc.textOut += outD.text_tokens ?? 0;
}

export const usageIsEmpty = (u: UsageCounters) => Object.values(u).every((n) => n === 0);
