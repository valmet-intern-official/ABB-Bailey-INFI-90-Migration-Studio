import type { ReactNode } from "react";

export function Eyebrow({ children, index }: { children: ReactNode; index?: string }) {
  return (
    <p className="lp-eyebrow">
      {index && <span className="lp-eyebrow__index">{index}</span>}
      {children}
    </p>
  );
}

export function ArrowIcon() {
  return (
    <svg className="lp-btn__icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3 8h9.5M8.5 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
    </svg>
  );
}

export function PrimaryButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="lp-btn lp-btn--primary">
      {children}
      <ArrowIcon />
    </a>
  );
}

export function SecondaryButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="lp-btn lp-btn--secondary">
      {children}
    </a>
  );
}

export function SectionHeader({
  index,
  label,
  title,
  lead,
  id,
}: {
  index: string;
  label: string;
  title: ReactNode;
  lead?: ReactNode;
  id: string;
}) {
  return (
    <header className="lp-section-header">
      <Eyebrow index={index}>{label}</Eyebrow>
      <h2 id={id} className="lp-h2">
        {title}
      </h2>
      {lead && <p className="lp-lead">{lead}</p>}
    </header>
  );
}

export function Section({
  id,
  labelledBy,
  tone = "default",
  children,
}: {
  id: string;
  labelledBy: string;
  tone?: "default" | "alt";
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={labelledBy} className={`lp-section lp-section--${tone}`}>
      <div className="lp-container">{children}</div>
    </section>
  );
}
