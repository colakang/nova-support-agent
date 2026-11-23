// Input moderation (OpenAI omni-moderation, free). Defence in depth, not the main line: the main
// line is structural (state-gated tools, policy in code, validated answers).
//
// Design choices:
//   - Runs in PARALLEL with the first LLM call and is awaited before any tool runs or any answer is
//     released, so it costs ~0 ms of user-visible latency (moderation ≈ 0.5–1.2 s < first LLM step).
//   - Plain harassment/profanity is NOT blocked: an angry customer ("useless bot, refund me!") is still
//     a customer. That flows to the agent and counts toward the frustration → human escalation rule.
//   - Self-harm gets a caring, fixed reply. Severe categories get a fixed, neutral refusal.
//   - Fails OPEN (logged): if moderation is down, the structural controls still hold.
import { openaiPost } from '@sa/shared/openai';

export type ModerationVerdict =
  | { action: 'allow'; flagged: string[]; ms: number; error?: string }
  | { action: 'block' | 'self_harm'; flagged: string[]; ms: number };

const SELF_HARM = ['self-harm', 'self-harm/intent', 'self-harm/instructions'];
const BLOCK = ['sexual/minors', 'sexual', 'hate', 'hate/threatening', 'harassment/threatening', 'violence/graphic', 'illicit/violent'];

interface ModerationResponse { results: Array<{ flagged: boolean; categories: Record<string, boolean> }> }

export async function moderate(text: string, signal?: AbortSignal): Promise<ModerationVerdict> {
  const t0 = performance.now();
  try {
    const r = await openaiPost<ModerationResponse>('/moderations', { model: 'omni-moderation-latest', input: text.slice(0, 4000) }, { timeoutMs: 4000, ...(signal ? { signal } : {}) });
    const res = r.results[0];
    const flagged = res ? Object.entries(res.categories).filter(([, v]) => v).map(([k]) => k) : [];
    const ms = Math.round(performance.now() - t0);
    if (flagged.some((c) => SELF_HARM.includes(c))) return { action: 'self_harm', flagged, ms };
    if (flagged.some((c) => BLOCK.includes(c))) return { action: 'block', flagged, ms };
    return { action: 'allow', flagged, ms };
  } catch (err) {
    return { action: 'allow', flagged: [], ms: Math.round(performance.now() - t0), error: (err as Error).message };
  }
}

export const MODERATION_REPLY = {
  block: "I can't help with that. I'm here for questions about your Northstar account, billing and the product. What can I help you with?",
  self_harm:
    "I'm really sorry you're feeling this way. I'm only able to help with Northstar support, but you don't have to go through this alone: if you might act on these thoughts, please contact your local emergency number or a crisis line right now (in the US, call or text 988).",
};
