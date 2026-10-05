import { Eyebrow } from "./primitives";
import { StudioUpload } from "./StudioUpload";

export function FinalCTA() {
  return (
    <section id="studio" className="lp-final" aria-labelledby="studio-title">
      <div className="lp-container lp-final__grid">
        <div className="lp-final__copy">
          <Eyebrow index="09">Migration Studio</Eyebrow>
          <h2 id="studio-title" className="lp-h2 lp-final__title">
            Ready to engineer.
          </h2>
          <p className="lp-final__lead">
            Start a session from a controller backup. The package is decoded, validated and opened in the engineering
            workspace — I/O list, loop list, logic and CAD viewer.
          </p>
          <ul className="lp-final__facts">
            <li>Archives are parsed only, never executed</li>
            <li>Path traversal and oversized entries are rejected</li>
            <li>Results stay with the session</li>
          </ul>
        </div>
        <StudioUpload />
      </div>
    </section>
  );
}
