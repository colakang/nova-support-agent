// Small, dependency-free formatters used across the console.

export function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(2)} s`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function fmtUsd(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (v === 0) return '$0.00';
  if (Math.abs(v) < 0.0001) return '<$0.0001';
  if (Math.abs(v) < 0.01) return `$${v.toFixed(4)}`;
  if (Math.abs(v) < 1) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(2)}`;
}

export function fmtMoney(v: number): string {
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function fmtTokens(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (n < 1000) return String(n);
  if (n < 100_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

export function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** "customer_request" → "Customer request" */
export function humanize(s: string): string {
  const t = s.replace(/[_.-]+/g, ' ').trim();
  return t ? t[0]!.toUpperCase() + t.slice(1) : t;
}

export function avg(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
