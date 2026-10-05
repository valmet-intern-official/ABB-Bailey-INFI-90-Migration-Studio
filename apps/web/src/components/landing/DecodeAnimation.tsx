const COLS = 5;
const ROWS = 6;
const BYTES = Array.from({ length: COLS * ROWS }, (_, i) => {
  const r = Math.floor(i / COLS);
  const c = i % COLS;
  return { x: 14 + c * 13, y: 14 + r * 17, d: ((r * 7 + c * 3) % 11) * 0.13 };
});
const LANES = [46, 66, 86];

/** Text-free "the package is being decoded" scene shown in place of the drop zone while a job runs. */
export function DecodeAnimation({ variant, progress }: { variant: "cad" | "m1"; progress?: number | null }) {
  const determinate = typeof progress === "number";
  return (
    <div className={`lp-dec lp-dec--${variant}`} aria-hidden>
      <svg className="lp-dec__svg" viewBox="0 0 320 132" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id={`lp-dec-glow-${variant}`} x1="0" x2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0.55" />
          </linearGradient>
        </defs>

        {/* Source bytes being read */}
        <g className="lp-dec__bytes">
          {BYTES.map((b, i) => (
            <rect key={i} className="lp-dec__byte" x={b.x} y={b.y} width="9" height="9" rx="2" style={{ animationDelay: `${b.d}s` }} />
          ))}
        </g>
        <g className="lp-dec__scan">
          <rect x="6" y="8" width="10" height="114" fill={`url(#lp-dec-glow-${variant})`} />
          <rect x="15" y="8" width="1.5" height="114" className="lp-dec__scanline" />
        </g>

        {/* Bits flowing into the decoder */}
        {LANES.map((y, i) => (
          <g key={y}>
            <line className="lp-dec__lane" x1="86" y1={y} x2="134" y2={66 + (y - 66) * 0.35} />
            {[0, 1].map((k) => (
              <rect
                key={k}
                className="lp-dec__bit"
                x="84"
                y={y - 1.5}
                width="7"
                height="3"
                rx="1.5"
                style={{ animationDelay: `${i * 0.22 + k * 0.55}s`, ["--dy" as string]: `${(66 - y) * 0.65}px` }}
              />
            ))}
          </g>
        ))}

        {/* Decoder core */}
        <g className="lp-dec__core">
          <circle className="lp-dec__halo" cx="160" cy="66" r="26" />
          <circle className="lp-dec__ring" cx="160" cy="66" r="31" />
          <circle className="lp-dec__ring lp-dec__ring--inner" cx="160" cy="66" r="18" />
          <circle className="lp-dec__disc" cx="160" cy="66" r="12" />
          <path className="lp-dec__gem" d="M160 59 L167 66 L160 73 L153 66 Z" />
        </g>

        {/* Structured output leaving the decoder */}
        {[56, 76].map((y, i) => (
          <g key={y}>
            <line className="lp-dec__lane" x1="190" y1={66 + (y - 66) * 0.3} x2="208" y2={y} />
            <rect
              className="lp-dec__bit lp-dec__bit--out"
              x="188"
              y={64.5 + (y - 66) * 0.3}
              width="7"
              height="3"
              rx="1.5"
              style={{ animationDelay: `${0.35 + i * 0.4}s`, ["--dy" as string]: `${(y - 66) * 0.7}px` }}
            />
          </g>
        ))}

        {variant === "cad" ? <CadBuild /> : <M1Build />}
      </svg>
      <div className={`lp-dec__bar${determinate ? "" : " lp-dec__bar--indeterminate"}`}>
        <span style={determinate ? { width: `${Math.max(4, Math.min(100, progress! * 100))}%` } : undefined} />
      </div>
    </div>
  );
}

/** Function-block sheet assembling itself: two inputs wired into a controller block. */
function CadBuild() {
  return (
    <g className="lp-dec__build">
      <rect className="lp-dec__frame" x="212" y="12" width="100" height="108" rx="6" />
      <g className="lp-dec__pop" style={{ animationDelay: "0s" }}>
        <rect className="lp-dec__block" x="220" y="24" width="32" height="22" rx="3" />
        <path className="lp-dec__bars" d="M226 32h14M226 38h20" />
      </g>
      <g className="lp-dec__pop" style={{ animationDelay: "0.35s" }}>
        <rect className="lp-dec__block" x="220" y="86" width="32" height="22" rx="3" />
        <path className="lp-dec__bars" d="M226 94h18M226 100h12" />
      </g>
      <path className="lp-dec__wire" d="M252 35h10v26h10" style={{ animationDelay: "0.7s" }} />
      <path className="lp-dec__wire" d="M252 97h10v-26h10" style={{ animationDelay: "0.85s" }} />
      <g className="lp-dec__pop" style={{ animationDelay: "1.15s" }}>
        <rect className="lp-dec__block lp-dec__block--key" x="272" y="52" width="32" height="28" rx="3" />
        <path className="lp-dec__bars" d="M278 61h20M278 67h14M278 73h18" />
      </g>
      <circle className="lp-dec__node" cx="262" cy="35" r="2" style={{ animationDelay: "0.9s" }} />
      <circle className="lp-dec__node" cx="262" cy="97" r="2" style={{ animationDelay: "1.05s" }} />
      <circle className="lp-dec__node" cx="272" cy="66" r="2.4" style={{ animationDelay: "1.3s" }} />
    </g>
  );
}

/** Operator display being redrawn: tank, pipe, valve, pump and a live trend. */
function M1Build() {
  return (
    <g className="lp-dec__build">
      <rect className="lp-dec__screen" x="212" y="12" width="100" height="108" rx="6" />
      <polyline
        className="lp-dec__wire lp-dec__wire--trend"
        points="220,32 231,25 242,29 253,20 264,27 275,22 286,28 297,19 305,23"
        style={{ animationDelay: "0.1s" }}
      />
      <g className="lp-dec__pop" style={{ animationDelay: "0.3s" }}>
        <rect className="lp-dec__tank" x="224" y="44" width="24" height="58" rx="4" />
        <rect className="lp-dec__liquid" x="226" y="46" width="20" height="54" rx="2.5" />
      </g>
      <path className="lp-dec__wire lp-dec__wire--pipe" d="M248 92h22V58h22" style={{ animationDelay: "0.65s" }} />
      <g className="lp-dec__pop" style={{ animationDelay: "1s" }}>
        <path className="lp-dec__valve" d="M264 69l12 10v-10l-12 10z" />
      </g>
      <g className="lp-dec__pop" style={{ animationDelay: "1.2s" }}>
        <circle className="lp-dec__pump" cx="298" cy="58" r="8" />
        <path className="lp-dec__impeller" d="M298 52v12M292 58h12" />
      </g>
      <circle className="lp-dec__lamp" cx="290" cy="110" r="2.2" style={{ animationDelay: "0s" }} />
      <circle className="lp-dec__lamp" cx="298" cy="110" r="2.2" style={{ animationDelay: "0.4s" }} />
      <circle className="lp-dec__lamp lp-dec__lamp--warn" cx="306" cy="110" r="2.2" style={{ animationDelay: "0.8s" }} />
    </g>
  );
}

/** Three pulsing dots used as the busy label of a submit button. */
export function BusyDots() {
  return (
    <span className="lp-dots" aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}
