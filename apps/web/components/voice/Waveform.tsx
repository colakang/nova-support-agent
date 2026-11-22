'use client';
// Live dual waveform: rolling loudness history for the mic (above the axis) and Nova (below).
// Canvas + AnalyserNode + requestAnimationFrame; colours come from CSS tokens so it follows the theme.
import { useEffect, useRef, type RefObject } from 'react';
import type { Analysers } from '@/lib/voice/useVoiceCall';

const BAR = 3; // px
const GAP = 2; // px

function rms(a: AnalyserNode, buf: Float32Array<ArrayBuffer>): number {
  a.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!;
  return Math.sqrt(sum / buf.length);
}

export function Waveform({ analysers, live, className }: { analysers: RefObject<Analysers>; live: boolean; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const g = canvas.getContext('2d');
    if (!g) return;

    let raf = 0;
    let frame = 0;
    let mic: number[] = [];
    let nova: number[] = [];
    let colors = { mic: '#0ea5e9', nova: '#8b5cf6', axis: '#e3e3e8' };
    const buf = new Float32Array(new ArrayBuffer(1024 * 4));

    const readColors = () => {
      const cs = getComputedStyle(canvas);
      colors = {
        mic: cs.getPropertyValue('--color-mic').trim() || colors.mic,
        nova: cs.getPropertyValue('--color-nova').trim() || colors.nova,
        axis: cs.getPropertyValue('--color-line').trim() || colors.axis,
      };
    };
    readColors();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', readColors);

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = () => {
      const { width: w, height: h } = canvas.getBoundingClientRect();
      const n = Math.max(1, Math.floor(w / (BAR + GAP)));
      // Sample every other frame (~30 Hz) so the history scrolls at a readable pace.
      if (frame++ % 2 === 0) {
        const a = analysers.current;
        // Perceptual-ish scaling: speech RMS is ~0.02–0.3, so lift and compress it.
        const level = (node: AnalyserNode | null) => (live && node ? Math.min(1, Math.sqrt(rms(node, buf)) * 1.6) : 0);
        mic.push(level(a?.mic ?? null));
        nova.push(level(a?.nova ?? null));
        if (mic.length > n) mic = mic.slice(-n);
        if (nova.length > n) nova = nova.slice(-n);
      }

      g.clearRect(0, 0, w, h);
      const mid = h / 2;
      g.fillStyle = colors.axis;
      g.fillRect(0, mid - 0.5, w, 1);

      if (!live) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const half = mid - 4;
      const offset = w - mic.length * (BAR + GAP);
      for (let i = 0; i < mic.length; i++) {
        const x = offset + i * (BAR + GAP);
        const m = Math.max(1, mic[i]! * half);
        const v = Math.max(1, nova[i]! * half);
        g.fillStyle = colors.mic;
        g.globalAlpha = mic[i]! > 0.02 ? 1 : 0.35;
        g.fillRect(x, mid - 1 - m, BAR, m);
        g.fillStyle = colors.nova;
        g.globalAlpha = nova[i]! > 0.02 ? 1 : 0.35;
        g.fillRect(x, mid + 1, BAR, v);
      }
      g.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mq.removeEventListener('change', readColors);
    };
  }, [analysers, live]);

  return <canvas ref={canvasRef} className={className} role="img" aria-label="Live audio levels: your microphone above the line, Nova below" />;
}
