import { HeroVideo } from "./HeroVideo";
import { Eyebrow, PrimaryButton, SecondaryButton } from "./primitives";

function HeroCopy() {
  return (
    <div className="lp-hero__copy">
      <Eyebrow>ABB Bailey INFI 90 engineering migration platform</Eyebrow>
      <h1 id="hero-title" className="lp-display">
        <span>Decode.</span>
        <span>Reconstruct.</span>
        <span className="lp-display__accent">Migrate.</span>
      </h1>
      <p className="lp-hero__body">
        Decode legacy ABB Bailey INFI 90 engineering data, reconstruct graphics and engineering relationships, and
        generate traceable migration-ready outputs through a deterministic, source-first workflow.
      </p>
      <div className="lp-hero__actions">
        <PrimaryButton href="#studio">Open Migration Studio</PrimaryButton>
        <SecondaryButton href="#platform">Explore platform</SecondaryButton>
      </div>
      <p className="lp-hero__micro">
        <span>Source-first</span>
        <span aria-hidden>·</span>
        <span>Deterministic</span>
        <span aria-hidden>·</span>
        <span>Traceable</span>
      </p>
    </div>
  );
}

export function Hero() {
  return (
    <section className="lp-hero" aria-labelledby="hero-title">
      <div className="lp-hero__media">
        <HeroVideo />
      </div>
      <div className="lp-hero__grid">
        <HeroCopy />
      </div>
    </section>
  );
}
