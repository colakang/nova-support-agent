// Voice = OpenAI Realtime over WebRTC, browser ↔ OpenAI directly (lowest latency, built-in VAD,
// barge-in and echo cancellation). The API key never leaves the server: we mint a short-lived
// client secret with the session config baked in.
//
// "One brain, two mouths": the realtime model is the voice, not the policy engine. Its only tool
// is consult_agent, which runs the SAME orchestrator, tools and guardrails as chat. It may handle
// greetings itself; anything factual goes through consult_agent.
import { openaiPost } from '@sa/shared/openai';
import type { SessionView } from '@sa/shared';
import { AGENT_NAME } from '@sa/agent';
import { COMPANY } from '@sa/tools';
import type { Config } from './config';

export const CONSULT_TOOL = {
  type: 'function',
  name: 'consult_agent',
  description: `Ask the ${COMPANY} support system. Use for EVERY question or request about ${COMPANY}, policies, pricing, accounts, invoices, refunds, account changes, identity verification, or a human handoff. Returns the exact answer to say.`,
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['request'],
    properties: {
      request: { type: 'string', description: "The customer's latest request in their own words, including any email address or PIN digits they just said." },
    },
  },
};

export function voiceInstructions(s: SessionView): string {
  const recent = s.messages.slice(-8).map((m) => `${m.role === 'user' ? 'Customer' : AGENT_NAME} (${m.mode}): ${m.content}`).join('\n');
  const c = s.facts.customer;
  return `You are ${AGENT_NAME}, the voice of ${COMPANY} customer support, speaking with a customer in a live call.

YOUR ROLE
- You are the voice interface only. For ANY question or request about ${COMPANY} (policies, pricing, accounts, refunds, changes, verification, talking to a human), call consult_agent with the customer's request in their own words. Never answer those from your own knowledge.
- Right before calling consult_agent, say a very short acknowledgement (2 to 5 words, e.g. "Sure, let me check.").
- When consult_agent returns, say its "answer" naturally and faithfully. Do not add facts, numbers, timelines or promises. If it returns an error, apologise briefly and offer to try again or connect a specialist.
- Greetings, thanks, "can you hear me", and asking the customer to repeat: handle yourself, briefly.
- Keep every turn short. If the customer starts talking, stop and listen.
- Spell out email addresses back to the customer only if consult_agent asks you to confirm them. Never repeat a PIN aloud.
- Speak English unless the customer clearly uses another language.

CONVERSATION SO FAR (text and voice share one session)
${recent || '(new conversation)'}
${c ? `\nVERIFIED CUSTOMER: ${c.name} (${c.tier} plan). Do not ask them to verify again.` : ''}${s.state === 'escalated' ? '\nThis conversation has been handed to a human specialist; a ticket is open.' : ''}`;
}

export async function mintRealtimeSecret(cfg: Config, s: SessionView) {
  const r = await openaiPost<{ value: string; expires_at: number }>(
    '/realtime/client_secrets',
    {
      expires_after: { anchor: 'created_at', seconds: 120 },
      session: {
        type: 'realtime',
        model: cfg.realtime.model,
        instructions: voiceInstructions(s),
        tools: [CONSULT_TOOL],
        tool_choice: 'auto',
        max_output_tokens: 1200,
        audio: {
          input: {
            transcription: { model: cfg.realtime.transcribeModel },
            noise_reduction: { type: 'near_field' },
            turn_detection: { type: 'semantic_vad', eagerness: 'medium', create_response: true, interrupt_response: true },
          },
          output: { voice: cfg.realtime.voice },
        },
      },
    },
    { timeoutMs: 10_000 },
  );
  return { clientSecret: r.value, expiresAt: r.expires_at, model: cfg.realtime.model, maxSessionSeconds: cfg.realtime.maxSessionSeconds };
}
