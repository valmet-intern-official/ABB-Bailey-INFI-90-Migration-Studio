export type Phase = "upload" | "decode" | "build" | "done" | "error";

const CX = 500;
const CY = 230;
const ARC_R = 80;
const ARC_C = 2 * Math.PI * ARC_R;

const TICKS = Array.from({ length: 60 }, (_, i) => {
  const a = (i * 6 * Math.PI) / 180;
  const inner = i % 5 === 0 ? 90 : 94;
  return {
    x1: CX + Math.cos(a) * inner,
    y1: CY + Math.sin(a) * inner,
    x2: CX + Math.cos(a) * 100,
    y2: CY + Math.sin(a) * 100,
  };
});

const BYTES = Array.from({ length: 48 }, (_, i) => {
  const r = Math.floor(i / 6);
  const c = i % 6;
  return { x: 116 + c * 18, y: 182 + r * 15, d: ((r * 5 + c * 7) % 13) * 0.11 };
});

const IN_PATHS = [
  "M246 186 C 300 186, 330 214, 384 222",
  "M246 236 C 300 236, 330 232, 384 230",
  "M246 286 C 300 286, 330 250, 384 238",
];
const OUT_PATHS = ["M616 222 C 650 214, 668 176, 700 176", "M616 230 L 700 230", "M616 238 C 650 246, 668 290, 700 290"];

/** Full-page decode scene: source stack → decoder core (real progress ring) → output being built. */
export function ProcessingScene({ kind, phase, progress }: { kind: "cad" | "m1"; phase: Phase; progress: number }) {
  const uploadRatio = phase === "upload" ? Math.min(1, progress / 0.25) : 1;
  const angle = progress * Math.PI * 2 - Math.PI / 2;
  const head = { x: CX + Math.cos(angle) * ARC_R, y: CY + Math.sin(angle) * ARC_R };

  return (
    <svg className="pr-svg" viewBox="0 0 1000 460" role="img" aria-label="Decoding animation">
      <defs>
        <radialGradient id="pr-core-glow">
          <stop offset="0" stopColor="#2f9463" stopOpacity="0.2" />
          <stop offset="0.55" stopColor="#2f9463" stopOpacity="0.07" />
          <stop offset="1" stopColor="#2f9463" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="pr-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3fae78" />
          <stop offset="1" stopColor="#135a3a" />
        </linearGradient>
        <linearGradient id="pr-scan" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2f9463" stopOpacity="0" />
          <stop offset="1" stopColor="#2f9463" stopOpacity="0.22" />
        </linearGradient>
        <filter id="pr-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <clipPath id="pr-card-clip">
          <rect x="104" y="140" width="134" height="176" rx="12" />
        </clipPath>
        {IN_PATHS.map((d, i) => (
          <path key={d} id={`pr-in-${i}`} d={d} />
        ))}
        {OUT_PATHS.map((d, i) => (
          <path key={d} id={`pr-out-${i}`} d={d} />
        ))}
      </defs>

      {/* Back layer: halo and outer rings */}
      <g className="pr-layer pr-layer--back">
        <circle className="pr-halo" cx={CX} cy={CY} r="170" fill="url(#pr-core-glow)" />
        <circle className="pr-wave" cx={CX} cy={CY} r="60" />
        <circle className="pr-wave pr-wave--late" cx={CX} cy={CY} r="60" />
        <circle className="pr-ring-outer" cx={CX} cy={CY} r="124" />
        <circle className="pr-ring-thin" cx={CX} cy={CY} r="108" />
      </g>

      {/* Middle layer: source, streams, core */}
      <g className="pr-layer pr-layer--mid">
        <g className="pr-source">
          <rect className="pr-card pr-card--back" x="128" y="104" width="134" height="176" rx="12" />
          <rect className="pr-card pr-card--mid" x="116" y="122" width="134" height="176" rx="12" />
          <rect className="pr-card" x="104" y="140" width="134" height="176" rx="12" />
          <rect className="pr-card__bar" x="116" y="154" width="54" height="6" rx="3" />
          <rect className="pr-card__bar pr-card__bar--dim" x="176" y="154" width="30" height="6" rx="3" />
          <g clipPath="url(#pr-card-clip)">
            {BYTES.map((b, i) => (
              <rect key={i} className="pr-byte" x={b.x} y={b.y} width="12" height="8" rx="2" style={{ animationDelay: `${b.d}s` }} />
            ))}
            <g className="pr-scan">
              <rect x="104" y="150" width="134" height="26" fill="url(#pr-scan)" />
              <rect x="104" y="175" width="134" height="1.5" className="pr-scan__line" />
            </g>
          </g>
          <rect className="pr-upload-track" x="116" y="300" width="110" height="4" rx="2" />
          <rect className="pr-upload-fill" x="116" y="300" width={110 * uploadRatio} height="4" rx="2" />
        </g>

        {IN_PATHS.map((d) => (
          <path key={d} className="pr-stream" d={d} />
        ))}
        {IN_PATHS.map((_, i) =>
          [0, 1, 2].map((k) => (
            <circle key={`${i}-${k}`} className="pr-packet" r={k === 0 ? 3 : 2.2}>
              <animateMotion dur={`${1.5 + i * 0.2}s`} begin={`${-(k * 0.5 + i * 0.3)}s`} repeatCount="indefinite">
                <mpath href={`#pr-in-${i}`} />
              </animateMotion>
            </circle>
          ))
        )}

        {OUT_PATHS.map((d) => (
          <path key={d} className="pr-stream pr-stream--out" d={d} />
        ))}
        {OUT_PATHS.map((_, i) =>
          [0, 1].map((k) => (
            <circle key={`o${i}-${k}`} className="pr-packet pr-packet--out" r="2.6">
              <animateMotion dur={`${1.1 + i * 0.15}s`} begin={`${-(k * 0.55 + i * 0.2)}s`} repeatCount="indefinite">
                <mpath href={`#pr-out-${i}`} />
              </animateMotion>
            </circle>
          ))
        )}

        <g className="pr-core">
          <g className="pr-ticks">
            {TICKS.map((t, i) => (
              <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} />
            ))}
          </g>
          <g className="pr-orbit">
            <circle cx={CX + 116} cy={CY} r="3.2" />
            <circle cx={CX - 116} cy={CY} r="2.2" />
            <circle cx={CX} cy={CY + 116} r="2.6" />
          </g>
          <circle className="pr-arc-track" cx={CX} cy={CY} r={ARC_R} />
          <circle
            className="pr-arc"
            cx={CX}
            cy={CY}
            r={ARC_R}
            strokeDasharray={ARC_C}
            strokeDashoffset={ARC_C * (1 - progress)}
            transform={`rotate(-90 ${CX} ${CY})`}
            filter="url(#pr-glow)"
          />
          <circle className="pr-arc-head" cx={head.x} cy={head.y} r="5" filter="url(#pr-glow)" />
          <path className="pr-hex" d={hexPath(CX, CY, 54)} />
          <circle className="pr-disc" cx={CX} cy={CY} r="40" />
          <g key={phase} className="pr-glyph">
            <CoreGlyph phase={phase} />
          </g>
        </g>
      </g>

      {/* Front layer: the output being built */}
      <g className="pr-layer pr-layer--front">{kind === "cad" ? <CadOutput /> : <M1Output />}</g>
    </svg>
  );
}

function hexPath(cx: number, cy: number, r: number) {
  return (
    Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      return `${i ? "L" : "M"}${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r).toFixed(1)}`;
    }).join(" ") + " Z"
  );
}

function CoreGlyph({ phase }: { phase: Phase }) {
  const t = `translate(${CX - 14} ${CY - 14})`;
  if (phase === "done")
    return <path className="pr-glyph__check" transform={t} d="M5 15l6 6 12-13" />;
  if (phase === "error") return <path className="pr-glyph__line" transform={t} d="M14 6v10m0 5v1" />;
  if (phase === "upload") return <path className="pr-glyph__line" transform={t} d="M14 22V6m0 0-6 6m6-6 6 6" />;
  if (phase === "decode")
    return (
      <g className="pr-glyph__line" transform={t}>
        <rect x="7" y="7" width="14" height="14" rx="2.5" />
        <path d="M11 3v4m6-4v4M11 21v4m6-4v4M3 11h4m-4 6h4m14-6h4m-4 6h4" />
      </g>
    );
  return <path className="pr-glyph__line" transform={t} d="m14 4 10 5-10 5-10-5 10-5Zm-10 10 10 5 10-5M4 19l10 5 10-5" />;
}

function PanelChrome() {
  return (
    <>
      <circle className="pr-dot" cx="718" cy="116" r="3" />
      <circle className="pr-dot" cx="728" cy="116" r="3" />
      <circle className="pr-dot" cx="738" cy="116" r="3" />
      <rect className="pr-panel__bar" x="756" y="113" width="64" height="6" rx="3" />
    </>
  );
}

/** Logic sheet assembling above a workbook that fills row by row. */
function CadOutput() {
  return (
    <g className="pr-out">
      <rect className="pr-panel" x="704" y="100" width="236" height="262" rx="14" />
      <PanelChrome />
      <g className="pr-pop" style={{ animationDelay: "0s" }}>
        <rect className="pr-block" x="718" y="140" width="56" height="34" rx="5" />
        <path className="pr-block__bars" d="M727 152h26M727 161h36" />
      </g>
      <g className="pr-pop" style={{ animationDelay: "0.35s" }}>
        <rect className="pr-block" x="718" y="196" width="56" height="34" rx="5" />
        <path className="pr-block__bars" d="M727 208h32M727 217h22" />
      </g>
      <path className="pr-wire" d="M774 157h18v28h20" style={{ animationDelay: "0.7s" }} />
      <path className="pr-wire" d="M774 213h18v-28h20" style={{ animationDelay: "0.85s" }} />
      <g className="pr-pop" style={{ animationDelay: "1.15s" }}>
        <rect className="pr-block pr-block--key" x="812" y="164" width="64" height="42" rx="6" />
        <path className="pr-block__bars pr-block__bars--key" d="M822 177h40M822 186h28M822 195h34" />
      </g>
      <path className="pr-wire" d="M876 185h40" style={{ animationDelay: "1.4s" }} />
      <circle className="pr-node" cx="792" cy="157" r="2.6" style={{ animationDelay: "0.9s" }} />
      <circle className="pr-node" cx="792" cy="213" r="2.6" style={{ animationDelay: "1.05s" }} />
      <circle className="pr-node pr-node--end" cx="920" cy="185" r="4" style={{ animationDelay: "1.6s" }} />

      <rect className="pr-sheet__head" x="718" y="254" width="208" height="14" rx="3" />
      {[0, 1, 2, 3, 4].map((r) => (
        <g key={r}>
          <rect className="pr-sheet__row" x="718" y={274 + r * 16} width="208" height="12" rx="2" />
          {[
            [722, 40],
            [768, 64],
            [838, 84],
          ].map(([x, w], c) => (
            <rect
              key={c}
              className="pr-cell"
              x={x}
              y={277 + r * 16}
              width={w - (r * 7 + c * 11) % 22}
              height="6"
              rx="3"
              style={{ animationDelay: `${0.9 + r * 0.22 + c * 0.08}s` }}
            />
          ))}
        </g>
      ))}
    </g>
  );
}

/** Operator display being redrawn: tanks, flowing pipe, valve, pump, trend and alarm lamps. */
function M1Output() {
  return (
    <g className="pr-out pr-out--m1">
      <rect className="pr-panel pr-panel--screen" x="704" y="100" width="236" height="262" rx="14" />
      <PanelChrome />
      <polyline
        className="pr-wire pr-wire--trend"
        points="718,160 738,146 758,152 778,138 798,150 818,140 838,148 858,134 878,146 898,138 922,144"
        style={{ animationDelay: "0.1s" }}
      />
      <g className="pr-pop" style={{ animationDelay: "0.3s" }}>
        <rect className="pr-tank" x="722" y="186" width="38" height="112" rx="6" />
        <rect className="pr-liquid" x="725" y="189" width="32" height="106" rx="4" />
      </g>
      <g className="pr-pop" style={{ animationDelay: "0.55s" }}>
        <rect className="pr-tank" x="852" y="210" width="34" height="78" rx="6" />
        <rect className="pr-liquid pr-liquid--b" x="855" y="213" width="28" height="72" rx="4" />
      </g>
      <path className="pr-wire pr-wire--pipe" d="M760 280h44v-48h48" style={{ animationDelay: "0.75s" }} />
      <path className="pr-flow" d="M760 280h44v-48h48" />
      <g className="pr-pop" style={{ animationDelay: "1.05s" }}>
        <path className="pr-valve" d="M796 248l16 14v-14l-16 14z" />
      </g>
      <path className="pr-wire pr-wire--pipe" d="M886 276h24v28" style={{ animationDelay: "1.1s" }} />
      <g className="pr-pop" style={{ animationDelay: "1.3s" }}>
        <circle className="pr-pump" cx="910" cy="318" r="14" />
        <path className="pr-impeller" d="M910 308v20M900 318h20" />
      </g>
      {[0, 1, 2, 3, 4].map((i) => (
        <circle
          key={i}
          className={`pr-lamp${i === 3 ? " pr-lamp--warn" : ""}`}
          cx={724 + i * 14}
          cy="344"
          r="3.4"
          style={{ animationDelay: `${i * 0.3}s` }}
        />
      ))}
    </g>
  );
}
