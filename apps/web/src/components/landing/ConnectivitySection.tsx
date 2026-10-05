import { FLIP_DETAILS, LOOP_TRACE } from "./content";
import { FlipCard, FlipDetails } from "./FlipCard";
import { Section, SectionHeader } from "./primitives";

const { input, station, output } = LOOP_TRACE;

const LEGEND = [
  { term: "Object", value: `${input.kind} ${input.tag}` },
  { term: "Logic", value: `FC ${station.fc} ${station.name} · block ${station.block}` },
  { term: "I/O", value: `${input.kind} slave ${input.slave} ch ${input.channel} → ${output.kind} slave ${output.slave} ch ${output.channel}` },
  { term: "Reference", value: `${input.sheet} → ${station.sheet} → ${output.sheet}` },
  { term: "Connection", value: "CAD wiring · 2 hops in, 1 hop out" },
] as const;

function Node({ kind, title, lines }: { kind: string; title: string; lines: string[] }) {
  return (
    <div className="lp-node">
      <span className="lp-node__kind">{kind}</span>
      <span className="lp-node__title">{title}</span>
      {lines.map((l) => (
        <span key={l} className="lp-node__line">
          {l}
        </span>
      ))}
    </div>
  );
}

function Wire({ label }: { label: string }) {
  return (
    <div className="lp-wire" aria-hidden>
      <span className="lp-wire__line" />
      <span className="lp-wire__label">{label}</span>
    </div>
  );
}

export function ConnectivitySection() {
  return (
    <Section id="connectivity" labelledBy="connectivity-title" tone="alt">
      <div className="lp-split lp-split--reverse">
        <div className="lp-split__aside">
          <SectionHeader
            id="connectivity-title"
            index="05"
            label="Logic & connectivity"
            title="Loops are resolved by wiring, never by row order"
            lead="From each I/O point the studio follows CAD wiring and cross-sheet references to the block that carries the loop tag. Input and output are told apart by card type, so an AI and an AO on different sheets still meet in one loop."
          />
        </div>

        <FlipCard
          label={`Loop ${LOOP_TRACE.loopTag}`}
          className="lp-reveal"
          backClassName="lp-flip__card"
          back={<FlipDetails {...FLIP_DETAILS.loop} />}
          front={
        <figure className="lp-loop" aria-labelledby="loop-caption">
          <div className="lp-loop__head">
            <span className="lp-loop__tag">{LOOP_TRACE.loopTag}</span>
            <span className="lp-loop__desc">{LOOP_TRACE.description}</span>
          </div>
          <div className="lp-loop__diagram">
            <Node kind="Input" title={`${input.kind} ${input.tag}`} lines={[input.sheet, `slave ${input.slave} · ch ${input.channel}`]} />
            <Wire label="wiring · 2 hops" />
            <Node kind={`FC ${station.fc}`} title={`${station.name} ${station.block}`} lines={[station.sheet, "carries loop tag"]} />
            <Wire label="wiring · 1 hop" />
            <Node kind="Output" title={`${output.kind} ${output.tag}`} lines={[output.sheet, `slave ${output.slave} · ch ${output.channel}`]} />
          </div>
          <dl className="lp-legend">
            {LEGEND.map((l) => (
              <div key={l.term}>
                <dt>{l.term}</dt>
                <dd>{l.value}</dd>
              </div>
            ))}
          </dl>
          <figcaption id="loop-caption" className="lp-figcaption">
            Loop {LOOP_TRACE.loopTag} in the M10 reference module, as resolved by the studio.
          </figcaption>
        </figure>
          }
        />
      </div>
    </Section>
  );
}
