import Image from "next/image";
import { Fragment } from "react";
import { DECODED_BLOCKS, FLIP_DETAILS, GRAPHIC_421P01, SOURCE_BYTES } from "./content";
import { FlipCard, FlipDetails } from "./FlipCard";
import { Section, SectionHeader } from "./primitives";

const BYTES_PER_ROW = 8;
const TAG_TOTAL = GRAPHIC_421P01.tagKinds.reduce((n, k) => n + k.count, 0);

function hexRows() {
  const bytes = SOURCE_BYTES.hex.split(" ").map((h) => parseInt(h, 16));
  const marked = (offset: number) => SOURCE_BYTES.highlight.some(([a, b]) => offset >= a && offset <= b);
  const rows = [];
  for (let i = 0; i < bytes.length; i += BYTES_PER_ROW) {
    const offset = SOURCE_BYTES.start + i;
    rows.push({
      offset: offset.toString(16).toUpperCase().padStart(4, "0"),
      cells: bytes.slice(i, i + BYTES_PER_ROW).map((b, j) => ({
        hex: b.toString(16).toUpperCase().padStart(2, "0"),
        ascii: b > 31 && b < 127 ? String.fromCharCode(b) : ".",
        marked: marked(offset + j),
      })),
    });
  }
  return rows;
}

type HexCell = ReturnType<typeof hexRows>[number]["cells"][number];

/** Consecutive highlighted cells share one <mark> so the decoded text reads as a single run. */
function Runs({ cells, field, sep }: { cells: HexCell[]; field: "hex" | "ascii"; sep: string }) {
  const runs: { marked: boolean; text: string[] }[] = [];
  for (const c of cells) {
    const last = runs[runs.length - 1];
    if (last && last.marked === c.marked) last.text.push(c[field]);
    else runs.push({ marked: c.marked, text: [c[field]] });
  }
  return (
    <>
      {runs.map((r, i) => (
        <Fragment key={i}>
          {i > 0 && sep}
          {r.marked ? <mark>{r.text.join(sep)}</mark> : r.text.join(sep)}
        </Fragment>
      ))}
    </>
  );
}

function StageLabel({ n, title, meta }: { n: string; title: string; meta: string }) {
  return (
    <figcaption className="lp-stage__label">
      <span className="lp-stage__n">{n}</span>
      <span className="lp-stage__title">{title}</span>
      <span className="lp-stage__meta">{meta}</span>
    </figcaption>
  );
}

function EngineeringVisual() {
  return (
    <div className="lp-stages lp-reveal">
      <FlipCard
        label="Legacy source"
        className="lp-flip--stage"
        backClassName="lp-flip__card"
        back={<FlipDetails {...FLIP_DETAILS.source} />}
        front={
      <figure className="lp-stage">
        <StageLabel n="A" title="Legacy source" meta="20710A1C.CAD · 2,194 bytes" />
        <div className="lp-stage__body lp-hex" role="img" aria-label="Hex dump of bytes 03D0 to 041F of sheet 20710A1C.CAD, containing the output reference AO1-24/131LV381AD24-04.06">
          {hexRows().map((row) => (
            <div key={row.offset} className="lp-hex__row">
              <span className="lp-hex__offset">{row.offset}</span>
              <span className="lp-hex__bytes">
                <Runs cells={row.cells} field="hex" sep=" " />
              </span>
              <span className="lp-hex__ascii">
                <Runs cells={row.cells} field="ascii" sep="" />
              </span>
            </div>
          ))}
        </div>
      </figure>
        }
      />

      <span className="lp-stage__link" aria-hidden />

      <FlipCard
        label="Decoded model"
        className="lp-flip--stage"
        backClassName="lp-flip__card"
        back={<FlipDetails {...FLIP_DETAILS.model} />}
        front={
      <figure className="lp-stage">
        <StageLabel n="B" title="Decoded model" meta="6 function blocks" />
        <div className="lp-stage__body">
          <table className="lp-mini-table">
            <thead>
              <tr>
                <th scope="col">Block</th>
                <th scope="col">FC</th>
                <th scope="col">Function</th>
              </tr>
            </thead>
            <tbody>
              {DECODED_BLOCKS.map((b) => (
                <tr key={b.block}>
                  <td>{b.block}</td>
                  <td>{b.fc}</td>
                  <td>
                    {b.name} <span className="lp-mini-table__sym">{b.symbol}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </figure>
        }
      />

      <span className="lp-stage__link" aria-hidden />

      <FlipCard
        label="Reconstructed sheet"
        className="lp-flip--stage"
        backClassName="lp-flip__card"
        back={<FlipDetails {...FLIP_DETAILS.sheet} />}
        front={
      <figure className="lp-stage">
        <StageLabel n="C" title="Reconstructed sheet" meta="SVG · vector" />
        <div className="lp-stage__body lp-stage__body--drawing">
          {/* eslint-disable-next-line @next/next/no-img-element -- vector drawing, served as-is */}
          <img
            src="/media/cad-20710A1C.svg"
            alt="Reconstructed logic of sheet 20710A1C.CAD: control station, PID controller, summer and trend blocks with their wiring"
            width={560}
            height={210}
            loading="lazy"
            decoding="async"
          />
        </div>
      </figure>
        }
      />
    </div>
  );
}

export function ReconstructionSection() {
  return (
    <Section id="reconstruction" labelledBy="reconstruction-title">
      <SectionHeader
        id="reconstruction-title"
        index="04"
        label="Engineering reconstruction"
        title="One sheet, from raw bytes to a readable drawing"
        lead="Sheet 20710A1C.CAD from the M10 reference module, shown at each stage. The output reference in the source bytes, the blocks in the model and the drawing all come from the same file."
      />
      <EngineeringVisual />

      <figure className="lp-graphic lp-reveal">
        <FlipCard
          label="Operator display 421P01"
          tone="dark"
          backClassName="lp-flip__card lp-flip__card--dark"
          back={<FlipDetails {...FLIP_DETAILS.graphic} />}
          front={
            <div className="lp-graphic__frame">
              <Image
                src="/media/graphics-421P01.png"
                alt="Decoded M1 operator display 421P01: blow tanks, washer stages and pumps with live tag fields for each loop"
                width={1280}
                height={957}
                sizes="(min-width: 1240px) 1200px, 100vw"
                className="lp-graphic__img"
              />
            </div>
          }
        />
        <figcaption className="lp-graphic__caption">
          <span className="lp-graphic__fig">Fig. 02</span>
          <h3 className="lp-h3">Operator graphics, redrawn</h3>
          <p>
            M1 display 421P01, decoded from its binary graphic file and drawn again with every shape, label and tag
            field in its original position.
          </p>
          <p className="lp-graphic__source">
            {GRAPHIC_421P01.file} · {GRAPHIC_421P01.bytes} · {GRAPHIC_421P01.records}
          </p>
          <dl className="lp-graphic__stats">
            {GRAPHIC_421P01.stats.map((s) => (
              <div key={s.label}>
                <dt>{s.label}</dt>
                <dd>{s.value}</dd>
              </div>
            ))}
          </dl>
          <div className="lp-graphic__tags">
            <p className="lp-graphic__tags-title">Tags on this display</p>
            <ul>
              {GRAPHIC_421P01.tagKinds.map((k) => (
                <li key={k.code} style={{ ["--share" as string]: k.count / TAG_TOTAL }}>
                  <span className="lp-graphic__tag-code">{k.code}</span>
                  <span className="lp-graphic__tag-label">{k.label}</span>
                  <span className="lp-graphic__tag-count">{k.count}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="lp-capability__meta">M1 → SVG · PNG · PDF</p>
        </figcaption>
      </figure>
    </Section>
  );
}
