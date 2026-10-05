"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { OUTPUT_SHEETS } from "./content";

const colLetter = (i: number) => String.fromCharCode(65 + i);

type Cell = { row: number; col: number };

const initialCell = (sheet: (typeof OUTPUT_SHEETS)[number]): Cell => ({ row: 0, col: sheet.tagColumns[0] ?? 0 });

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function OutputWorkbook() {
  const [sheetIndex, setSheetIndex] = useState(0);
  const sheet = OUTPUT_SHEETS[sheetIndex];
  const [cell, setCell] = useState<Cell>(() => initialCell(OUTPUT_SHEETS[0]));
  const gridRef = useRef<HTMLDivElement>(null);
  /** Rows that fit the grid without scrolling; null while measuring (all rows rendered). */
  const [fit, setFit] = useState<number | null>(null);

  const openSheet = (i: number) => {
    setSheetIndex(i);
    setCell(initialCell(OUTPUT_SHEETS[i]));
    setFit(null);
  };

  useIsoLayoutEffect(() => {
    if (fit !== null) return;
    const grid = gridRef.current;
    if (!grid) return;
    const limit = grid.getBoundingClientRect().top + grid.clientHeight;
    const rows = [...grid.querySelectorAll("tbody tr")];
    const count = rows.filter((tr) => tr.getBoundingClientRect().bottom <= limit + 0.5).length;
    setFit(Math.max(1, count));
  }, [fit, sheetIndex]);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    let width = grid.clientWidth;
    const ro = new ResizeObserver(() => {
      if (grid.clientWidth === width) return;
      width = grid.clientWidth;
      setFit(null);
    });
    ro.observe(grid);
    return () => ro.disconnect();
  }, []);

  const shown = fit ?? sheet.rows.length;
  const rows = sheet.rows.slice(0, shown);
  const ref = `${colLetter(cell.col)}${cell.row + 2}`;
  const value = sheet.rows[cell.row]?.[cell.col] ?? "";

  return (
    <figure className="lp-sheet lp-reveal" aria-labelledby="sheet-caption">
      <div className="lp-book">
        <div className="lp-book__title">
          <span className="lp-book__icon" aria-hidden>
            <svg viewBox="0 0 16 16" width="14" height="14">
              <rect x="1" y="2" width="14" height="12" rx="2" fill="currentColor" />
              <path d="m5 5 6 6m0-6-6 6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </span>
          <span className="lp-book__file">{sheet.file}</span>
          <span className="lp-book__mode">Read-only preview</span>
        </div>

        <div className="lp-book__formula">
          <span className="lp-book__namebox" aria-label="Selected cell">
            {ref}
          </span>
          <span className="lp-book__fx" aria-hidden>
            fx
          </span>
          <span className="lp-book__value">{value || "\u00a0"}</span>
        </div>

        <div
          ref={gridRef}
          className="lp-book__grid"
          role="tabpanel"
          id="lp-book-panel"
          aria-labelledby={`lp-book-tab-${sheet.id}`}
        >
          <table className="lp-book__table">
            <thead>
              <tr>
                <th className="lp-book__corner" aria-hidden />
                {sheet.columns.map((_, c) => (
                  <th key={c} className={`lp-book__letter${c === cell.col ? " is-on" : ""}`} aria-hidden>
                    {colLetter(c)}
                  </th>
                ))}
              </tr>
              <tr className="lp-book__head">
                <th className="lp-book__rownum" scope="row">
                  1
                </th>
                {sheet.columns.map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  <th className={`lp-book__rownum${r === cell.row ? " is-on" : ""}`} scope="row">
                    {r + 2}
                  </th>
                  {row.map((v, c) => {
                    const selected = r === cell.row && c === cell.col;
                    return (
                      <td
                        key={c}
                        className={[
                          sheet.tagColumns.includes(c) && "is-tag",
                          sheet.wrapColumns.includes(c) && "is-wrap",
                          selected && "is-selected",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={() => setCell({ row: r, col: c })}
                      >
                        {v}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="lp-book__tabs" role="tablist" aria-label="Workbook sheets">
          {OUTPUT_SHEETS.map((s, i) => (
            <button
              key={s.id}
              id={`lp-book-tab-${s.id}`}
              type="button"
              role="tab"
              aria-selected={i === sheetIndex}
              aria-controls="lp-book-panel"
              className="lp-book__tab"
              onClick={() => openSheet(i)}
            >
              {s.tab}
            </button>
          ))}
        </div>
      </div>
      <figcaption id="sheet-caption" className="lp-figcaption">
        {sheet.note.replace("{shown}", String(shown))}
      </figcaption>
    </figure>
  );
}
