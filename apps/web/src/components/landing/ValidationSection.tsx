import { VALIDATION, VALIDATION_LOG } from "./content";
import { Section, SectionHeader } from "./primitives";

const LEVEL_LABEL = { info: "Resolved", warn: "Warning", error: "Open" } as const;

export function ValidationSection() {
  return (
    <Section id="validation" labelledBy="validation-title" tone="alt">
      <SectionHeader
        id="validation-title"
        index="08"
        label="Validation"
        title="Gaps are reported, not hidden"
        lead="Before anything is exported, the package is checked against its own cross-reference and error listings. Findings stay attached to the file and sheet they concern."
      />
      <div className="lp-validation">
        <ul className="lp-checks">
          {VALIDATION.map((v, i) => (
            <li key={v.title} className="lp-check lp-reveal">
              <span className="lp-check__n">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="lp-h3">{v.title}</h3>
              <p>{v.body}</p>
            </li>
          ))}
        </ul>

        <figure className="lp-log lp-reveal" aria-labelledby="log-caption">
          <ul className="lp-log__list">
            {VALIDATION_LOG.map((entry) => (
              <li key={entry.message} className={`lp-log__entry lp-log__entry--${entry.level}`}>
                <span className="lp-log__level">{LEVEL_LABEL[entry.level]}</span>
                <span className="lp-log__source">{entry.source}</span>
                <span className="lp-log__message">{entry.message}</span>
              </li>
            ))}
          </ul>
          <figcaption id="log-caption" className="lp-figcaption">
            Three of the findings reported for the M10 reference module.
          </figcaption>
        </figure>
      </div>
    </Section>
  );
}
