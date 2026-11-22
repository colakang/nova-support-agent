'use client';
// Minimal toast system: one provider, one hook, one live region.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

export type ToastTone = 'neutral' | 'ok' | 'warn' | 'bad' | 'esc';

export interface Toast {
  id: number;
  title: string;
  body?: string;
  tone: ToastTone;
}

interface ToastApi {
  toast: (t: { title: string; body?: string; tone?: ToastTone; durationMs?: number }) => void;
}

const Ctx = createContext<ToastApi | null>(null);
const ToastsCtx = createContext<{ toasts: Toast[]; dismiss: (id: number) => void }>({ toasts: [], dismiss: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const toast = useCallback<ToastApi['toast']>(
    ({ title, body, tone = 'neutral', durationMs = 4000 }) => {
      const id = ++seq.current;
      setToasts((ts) => [...ts.slice(-3), { id, title, tone, ...(body ? { body } : {}) }]);
      window.setTimeout(() => dismiss(id), durationMs);
    },
    [dismiss],
  );
  const api = useMemo(() => ({ toast }), [toast]);
  const list = useMemo(() => ({ toasts, dismiss }), [toasts, dismiss]);
  return (
    <Ctx.Provider value={api}>
      <ToastsCtx.Provider value={list}>{children}</ToastsCtx.Provider>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const c = useContext(Ctx);
  if (!c) throw new Error('useToast outside ToastProvider');
  return c;
}

export function useToastList() {
  return useContext(ToastsCtx);
}
