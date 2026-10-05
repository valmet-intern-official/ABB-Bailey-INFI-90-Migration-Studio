"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

const CYCLE_MS = 4200;
import { WORKFLOW } from "./content";

const LAST = WORKFLOW.length - 1;

export function WorkflowStepper() {
  const root = useRef<HTMLDivElement>(null);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const [active, setActive] = useState(0);
  const [autoplay, setAutoplay] = useState(false);
  const [inView, setInView] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    setAutoplay(!reduce.matches);
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
      className="lp-flow lp-reveal"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <ol
        className="lp-steps lp-steps--interactive"
        aria-label="Workflow stages"
        style={{ ["--lp-progress" as string]: active / LAST }}
      >
        {WORKFLOW.map((s, i) => (
          <li key={s.step} className="lp-step" data-state={i < active ? "done" : i === active ? "active" : "todo"}>
            <button
              ref={(el) => {
                tabs.current[i] = el;
              }}
              id={`lp-flow-tab-${i}`}
              type="button"
              aria-current={i === active ? "step" : undefined}
              tabIndex={i === active ? 0 : -1}
              className="lp-step__btn"
              onClick={() => select(i)}
              onKeyDown={onKeyDown}
            >
              <span className="lp-step__node" aria-hidden />
              <span className="lp-step__index">{s.step}</span>
              <span className="lp-step__title">{s.title}</span>
              <span className="lp-step__body">{s.body}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
