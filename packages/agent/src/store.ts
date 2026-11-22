// Persistence + budget ports. Postgres implementations live in apps/api; the in-memory ones are
// used by tests and the eval harness so the agent core has no database dependency.
import type { ChaosFlags, ChatMessage, SessionFacts, SessionState, SessionView, TurnTrace } from '@sa/shared';
import { emptyFacts } from '@sa/shared';

export interface SessionStore {
  get(id: string): Promise<SessionView | null>;
  appendMessage(sessionId: string, msg: ChatMessage): Promise<void>;
  saveFacts(sessionId: string, facts: SessionFacts, state: SessionState): Promise<void>;
  saveTrace(trace: TurnTrace): Promise<void>;
}

export interface BudgetGuard {
  /** Throws BudgetExceededError when today's spend is at the cap. */
  check(sessionId: string): Promise<void>;
  add(sessionId: string, usd: number): Promise<void>;
}

export class BudgetExceededError extends Error {
  constructor(message: string) { super(message); this.name = 'BudgetExceededError'; }
}

export const noBudget: BudgetGuard = { async check() {}, async add() {} };

export class MemoryStore implements SessionStore {
  sessions = new Map<string, SessionView>();
  traces: TurnTrace[] = [];

  create(id: string, chaos?: Partial<ChaosFlags>): SessionView {
    const s: SessionView = {
      id, state: 'active', facts: emptyFacts(), messages: [], createdAt: Date.now(),
      chaos: { llmTimeout: false, llmRateLimit: false, toolFailure: 'none', retrievalDown: false, ...chaos },
    };
    this.sessions.set(id, s);
    return s;
  }
  async get(id: string) { const s = this.sessions.get(id); return s ? structuredClone(s) : null; }
  async appendMessage(sessionId: string, msg: ChatMessage) { this.sessions.get(sessionId)?.messages.push(msg); }
  async saveFacts(sessionId: string, facts: SessionFacts, state: SessionState) {
    const s = this.sessions.get(sessionId);
    if (s) { s.facts = structuredClone(facts); s.state = state; }
  }
  async saveTrace(trace: TurnTrace) { this.traces.push(trace); }
}
