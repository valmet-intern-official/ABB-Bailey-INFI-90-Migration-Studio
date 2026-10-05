import { CAPABILITIES } from "./content";
import { Section, SectionHeader } from "./primitives";

function CapabilityBlock({ index, title, body, meta }: (typeof CAPABILITIES)[number]) {
  return (
    <li className="lp-capability lp-reveal">
      <span className="lp-capability__index">{index}</span>
      <div>
        <h3 className="lp-h3">{title}</h3>
        <p className="lp-capability__body">{body}</p>
        <p className="lp-capability__meta">{meta}</p>
      </div>
    </li>
  );
}

export function PlatformSection() {
  return (
    <Section id="platform" labelledBy="platform-title">
      <div className="lp-split">
        <div className="lp-split__aside">
          <SectionHeader
            id="platform-title"
            index="02"
            label="Platform at a glance"
            title="From legacy INFI 90 data to engineering-ready intelligence"
            lead="Four domains of the same engineering record, decoded from the files the controller already holds — not re-entered by hand."
          />
        </div>
        <ol className="lp-capabilities">
          {CAPABILITIES.map((c) => (
            <CapabilityBlock key={c.index} {...c} />
          ))}
        </ol>
      </div>
    </Section>
  );
}
