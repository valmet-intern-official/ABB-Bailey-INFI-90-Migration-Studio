"use client";

import { useState, type ReactNode } from "react";

/** Click (or Enter / Space) anywhere on the card to turn it over; both faces share one grid cell. */
export function FlipCard({
  front,
  back,
  label,
  className = "",
  backClassName = "",
  tone = "light",
}: {
  front: ReactNode;
  back: ReactNode;
  label: string;
  className?: string;
  backClassName?: string;
  tone?: "light" | "dark";
}) {
  const [flipped, setFlipped] = useState(false);
  const toggle = () => setFlipped((f) => !f);

  return (
    <div className={`lp-flip lp-flip--${tone} ${className}`} data-flipped={flipped || undefined}>
      <div
        className="lp-flip__inner"
        role="button"
        tabIndex={0}
        aria-pressed={flipped}
        title={flipped ? `Back to ${label}` : `Show details: ${label}`}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
      >
        <div className="lp-flip__face lp-flip__front" inert={flipped}>
          {front}
        </div>
        <div className={`lp-flip__face lp-flip__back ${backClassName}`} inert={!flipped}>
          {back}
        </div>
      </div>
    </div>
  );
}

/** Heading + key/value list used on card backs. */
export function FlipDetails({
  kicker,
  title,
  rows,
  note,
}: {
  kicker: string;
  title: string;
  rows: ReadonlyArray<readonly [string, string]>;
  note?: string;
}) {
  return (
    <div className="lp-flip__details">
      <p className="lp-flip__kicker">{kicker}</p>
      <h4 className="lp-flip__title">{title}</h4>
      <dl className="lp-flip__list">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {note && <p className="lp-flip__note">{note}</p>}
    </div>
  );
}
