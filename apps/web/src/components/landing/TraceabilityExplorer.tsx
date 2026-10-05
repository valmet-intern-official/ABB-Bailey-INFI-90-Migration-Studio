"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

const CYCLE_MS = 4200;
import { LINEAGE } from "./content";

const LAST = LINEAGE.length - 1;

export function TraceabilityExplorer() {
  const root = useRef<HTMLDivElement>(null);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const [active, setActive] = useState(0);
  const [autoplay, setAutoplay] = useState(false);
  const [inView, setInView] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    setAutoplay(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const select = (i: number, focus = false) => {
    setAutoplay(false);
    setActive(i);
    if (focus) tabs.current[i]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const next: Record<string, number> = {
      ArrowRight: Math.min(active + 1, LAST),
      ArrowDown: Math.min(active + 1, LAST),
      ArrowLeft: Math.max(active - 1, 0),
      ArrowUp: Math.max(active - 1, 0),
      Home: 0,
      End: LAST,
    };
    if (e.key in next) {
      e.preventDefault();
      select(next[e.key], true);
    }
  };

  const running = autoplay && inView && !hovered;

  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => setActive((a) => (a === LAST ? 0 : a + 1)), CYCLE_MS);
    return () => clearTimeout(t);
  }, [running, active]);

  return (
    <div
      ref={root}
      className="lp-trace lp-reveal"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <ol
        className="lp-lineage lp-lineage--interactive"
        aria-label="Lineage of loop 131FC-163 from source file to output"
        style={{ ["--lp-progress" as string]: active / LAST }}
      >
        {LINEAGE.map((l, i) => (
          <li
            key={l.stage}
            className="lp-lineage__stage"
            data-state={i < active ? "done" : i === active ? "active" : "todo"}
          >
            <button
              ref={(el) => {
                tabs.current[i] = el;
              }}
              id={`lp-trace-tab-${i}`}
              type="button"
              aria-current={i === active ? "step" : undefined}
              tabIndex={i === active ? 0 : -1}
              className="lp-lineage__btn"
              onClick={() => select(i)}
              onKeyDown={onKeyDown}
            >
              <span className="lp-lineage__rail" aria-hidden>
                <span className="lp-lineage__node" />
              </span>
              <span className="lp-lineage__label">
                <span className="lp-lineage__n">{String(i + 1).padStart(2, "0")}</span>
                {l.stage}
              </span>
              <span className="lp-lineage__value">{l.value}</span>
              <span className="lp-lineage__detail">{l.detail}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
