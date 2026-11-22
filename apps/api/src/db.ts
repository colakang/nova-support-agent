// Postgres adapters for the agent's ports: sessions/messages/traces + the spend ledger.
import { randomBytes } from 'node:crypto';
import type { JSONValue, Sql } from 'postgres';
import { type BudgetGuard, BudgetExceededError, type SessionStore } from '@sa/agent';
import { type ChaosFlags, type ChatMessage, ChaosFlags as ChaosSchema, type SessionFacts, type SessionState, type SessionView, type TurnTrace, emptyFacts } from '@sa/shared';

/** postgres.js wants JSONValue; our zod types are JSON-safe by construction. */
const J = (sql: Sql, v: unknown) => sql.json(v as JSONValue);

export const newSessionId = () => `ses_${randomBytes(12).toString('base64url')}`;

type MsgRow = { id: string; turn_id: string | null; role: 'user' | 'assistant'; mode: 'text' | 'voice'; content: string; kind: string | null; citations: unknown; interrupted: boolean; created_at: Date };

export function pgStore(sql: Sql): SessionStore & {
  create(ip: string | null): Promise<SessionView>;
  setChaos(id: string, chaos: ChaosFlags): Promise<void>;
  traces(id: string): Promise<TurnTrace[]>;
} {
  const get = async (id: string): Promise<SessionView | null> => {
    const [s] = await sql<{ id: string; state: SessionState; facts: SessionFacts; chaos: Partial<ChaosFlags>; created_at: Date }[]>`
      select id, state, facts, chaos, created_at from sessions where id = ${id}`;
    if (!s) return null;
    const msgs = await sql<MsgRow[]>`
      select id, turn_id, role, mode, content, kind, citations, interrupted, created_at
      from messages where session_id = ${id} order by created_at asc, id asc`;
    return {
      id: s.id,
      state: s.state,
      facts: { ...emptyFacts(), ...s.facts },
      chaos: ChaosSchema.parse(s.chaos ?? {}),
      createdAt: s.created_at.getTime(),
      messages: msgs.map((m) => ({
        id: m.id, role: m.role, mode: m.mode, content: m.content, at: m.created_at.getTime(),
        ...(m.turn_id ? { turnId: m.turn_id } : {}),
        ...(m.kind ? { kind: m.kind as ChatMessage['kind'] } : {}),
        ...(Array.isArray(m.citations) && m.citations.length ? { citations: m.citations as ChatMessage['citations'] } : {}),
        ...(m.interrupted ? { interrupted: true } : {}),
      })),
    };
  };
  return {
    get,
    async create(ip) {
      const id = newSessionId();
      await sql`insert into sessions (id, facts, chaos, client_ip) values (${id}, ${J(sql, emptyFacts())}, ${J(sql, ChaosSchema.parse({}))}, ${ip})`;
      return (await get(id))!;
    },
    async appendMessage(sessionId, m) {
      await sql`
        insert into messages (id, session_id, turn_id, role, mode, content, kind, citations, interrupted, created_at)
        values (${m.id}, ${sessionId}, ${m.turnId ?? null}, ${m.role}, ${m.mode}, ${m.content}, ${m.kind ?? null},
                ${m.citations ? J(sql, m.citations) : null}, ${m.interrupted ?? false}, ${new Date(m.at)})`;
    },
    async saveFacts(sessionId, facts, state) {
      await sql`update sessions set facts = ${J(sql, facts)}, state = ${state}, updated_at = now() where id = ${sessionId}`;
    },
    async saveTrace(t) {
      await sql`
        insert into traces (turn_id, session_id, mode, data, cost_usd)
        values (${t.turnId}, ${t.sessionId}, ${t.mode}, ${J(sql, t)}, ${t.totals.costUsd})
        on conflict (turn_id) do update set data = excluded.data, cost_usd = excluded.cost_usd`;
    },
    async setChaos(id, chaos) {
      await sql`update sessions set chaos = ${J(sql, chaos)}, updated_at = now() where id = ${id}`;
    },
    async traces(id) {
      const rows = await sql<{ data: TurnTrace }[]>`select data from traces where session_id = ${id} order by created_at asc`;
      return rows.map((r) => r.data);
    },
  };
}

/** Hard daily cap across everything + a per-session cap (keeps one visitor from eating the demo budget). */
export function pgBudget(sql: Sql, dailyUsd: number, sessionUsd: number): BudgetGuard & { today(): Promise<number> } {
  const perSession = new Map<string, number>();
  const day = () => new Date().toISOString().slice(0, 10);
  const today = async () => {
    const [r] = await sql<{ usd: string }[]>`select usd from spend where day = ${day()}`;
    return r ? Number(r.usd) : 0;
  };
  return {
    today,
    async check(sessionId) {
      if (dailyUsd > 0 && (await today()) >= dailyUsd) throw new BudgetExceededError(`daily budget $${dailyUsd} reached`);
      if (sessionUsd > 0 && (perSession.get(sessionId) ?? 0) >= sessionUsd) throw new BudgetExceededError(`session budget $${sessionUsd} reached`);
    },
    async add(sessionId, usd) {
      if (!usd) return;
      perSession.set(sessionId, (perSession.get(sessionId) ?? 0) + usd);
      await sql`insert into spend (day, usd) values (${day()}, ${usd}) on conflict (day) do update set usd = spend.usd + excluded.usd`;
    },
  };
}
