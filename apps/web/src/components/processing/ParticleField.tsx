"use client";

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";

export type ParticleFieldHandle = { burst: (clientX: number, clientY: number) => void };

type P = { x: number; y: number; vx: number; vy: number; r: number };

const LINK = 120;
const POINTER_LINK = 170;
const REPEL = 110;

/** Drifting point network behind the processing scene; links to and parts around the pointer. */
export function ParticleField({ ref }: { ref?: Ref<ParticleFieldHandle> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const particles = useRef<P[]>([]);
  const pointer = useRef<{ x: number; y: number; on: boolean }>({ x: 0, y: 0, on: false });

  useImperativeHandle(ref, () => ({
    burst(cx, cy) {
      for (const p of particles.current) {
        const dx = p.x - cx;
        const dy = p.y - cy;
        const d = Math.hypot(dx, dy) || 1;
        if (d < 260) {
          const f = (1 - d / 260) * 6;
          p.vx += (dx / d) * f;
          p.vy += (dy / d) * f;
        }
      }
    },
  }));

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let raf = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      el.width = w * dpr;
      el.height = h * dpr;
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round(Math.min(110, Math.max(40, (w * h) / 16000)));
      const list = particles.current;
      while (list.length < count) {
        list.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.35,
          vy: (Math.random() - 0.5) * 0.35,
          r: 0.8 + Math.random() * 1.4,
        });
      }
      list.length = count;
    };

    const draw = () => {
      const list = particles.current;
      const pt = pointer.current;
      ctx.clearRect(0, 0, w, h);

      for (const p of list) {
        if (!reduce) {
          if (pt.on) {
            const dx = p.x - pt.x;
            const dy = p.y - pt.y;
            const d = Math.hypot(dx, dy);
            if (d < REPEL && d > 0) {
              const f = (1 - d / REPEL) * 0.6;
              p.vx += (dx / d) * f;
              p.vy += (dy / d) * f;
            }
          }
          p.vx *= 0.97;
          p.vy *= 0.97;
          const speed = Math.hypot(p.vx, p.vy);
          if (speed < 0.12) {
            p.vx += (Math.random() - 0.5) * 0.05;
            p.vy += (Math.random() - 0.5) * 0.05;
          }
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < -10) p.x = w + 10;
          if (p.x > w + 10) p.x = -10;
          if (p.y < -10) p.y = h + 10;
          if (p.y > h + 10) p.y = -10;
        }
      }

      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < LINK) {
            ctx.strokeStyle = `rgba(31, 122, 77, ${(1 - d / LINK) * 0.14})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
        if (pt.on) {
          const d = Math.hypot(a.x - pt.x, a.y - pt.y);
          if (d < POINTER_LINK) {
            ctx.strokeStyle = `rgba(31, 122, 77, ${(1 - d / POINTER_LINK) * 0.4})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(pt.x, pt.y);
            ctx.stroke();
          }
        }
        ctx.fillStyle = "rgba(31, 122, 77, 0.38)";
        ctx.beginPath();
        ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!reduce) raf = requestAnimationFrame(draw);
    };

    const onMove = (e: globalThis.PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY, on: true };
    };
    const onLeave = () => {
      pointer.current.on = false;
    };

    resize();
    draw();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove);
    document.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return <canvas ref={canvas} className="pr__field" aria-hidden />;
}
