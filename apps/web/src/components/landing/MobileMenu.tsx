"use client";

import { useEffect, useId, useState } from "react";
import { NAV } from "./content";

export function MobileMenu() {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="lp-menu" data-open={open || undefined}>
      <button
        type="button"
        className="lp-menu__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden />
      </button>
      <nav id={panelId} className="lp-menu__panel" aria-label="Primary (mobile)" hidden={!open}>
        {NAV.map((item) => (
          <a key={item.href} href={item.href} onClick={() => setOpen(false)}>
            {item.label}
          </a>
        ))}
        <a href="#studio" className="lp-menu__cta" onClick={() => setOpen(false)}>
          Open Migration Studio
        </a>
      </nav>
    </div>
  );
}
