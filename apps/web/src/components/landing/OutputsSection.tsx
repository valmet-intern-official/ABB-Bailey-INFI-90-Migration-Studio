import { OUTPUTS } from "./content";
import { OutputWorkbook } from "./OutputWorkbook";
import { Section, SectionHeader } from "./primitives";

export function OutputsSection() {
  return (
    <Section id="outputs" labelledBy="outputs-title">
      <SectionHeader
        id="outputs-title"
        index="06"
        label="Engineering outputs"
        title="Deliverables an engineering team can review offline"
        lead="Generated for every session and downloadable from the workspace. Values are carried over exactly as found in the source."
      />
      <div className="lp-outputs">
        <ul className="lp-output-list">
          {OUTPUTS.map((o) => (
            <li key={o.title} className="lp-output lp-reveal">
              <h3 className="lp-h3">{o.title}</h3>
              <p className="lp-output__file">{o.file}</p>
              <p className="lp-output__body">{o.body}</p>
            </li>
          ))}
        </ul>
        <OutputWorkbook />
      </div>
    </Section>
  );
}
