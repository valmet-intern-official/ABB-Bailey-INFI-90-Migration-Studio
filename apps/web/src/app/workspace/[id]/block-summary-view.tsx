"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { apiUrl } from "@/lib/api-base";

type SummaryRow = {
  functionCode: number | null;
  name: string;
  symbol: string | null;
  count: number;
  sheets: { file: string; blocks: number[] }[];
};
type Summary = { totalBlocks: number; sheetCount: number; rows: SummaryRow[] };

const COLS = 5;

export function BlockSummaryView({
  projectId,
  sheetTitles,
  onOpenCad,
}: {
  projectId: string;
  sheetTitles: Map<string, string>;
  onOpenCad: (file: string) => void;
}) {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(apiUrl(`/api/projects/${projectId}/block-summary`));
      if (cancelled) return;
      if (!res.ok) {
        setError("Function-block specifications are not available for this session");
        return;
      }
      setData((await res.json()) as Summary);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.rows;
    return data.rows.filter(
      (r) =>
        `fc ${r.functionCode ?? ""}`.includes(q) ||
        String(r.functionCode ?? "") === q ||
        r.name.toLowerCase().includes(q) ||
        (r.symbol ?? "").toLowerCase().includes(q) ||
        r.sheets.some((s) => s.file.toLowerCase().includes(q))
    );
  }, [data, query]);

  if (error || !data) {
    return <p className="cad-viewer__empty">{error ?? "Counting function blocks…"}</p>;
  }

  const cards = [
    { badge: "FB", value: data.totalBlocks, label: "Function blocks across all CAD files" },
    { badge: "FC", value: data.rows.length, label: "Distinct function codes used" },
    { badge: "CAD", value: data.sheetCount, label: "CAD sheets" },
  ];

  return (
    <div className="block-summary">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <div key={c.badge} className="panel p-4">
            <span className="inline-flex rounded-md bg-[var(--accent-soft)] px-2 py-1 text-xs font-bold tracking-wide text-[var(--accent-dark)]">
              {c.badge}
            </span>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{c.value}</p>
            <p className="mt-1 text-[0.7rem] leading-snug text-[var(--muted)]">{c.label}</p>
          </div>
        ))}
      </div>

      <div className="panel overflow-hidden p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-4 py-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search function code, block name, symbol, CAD file…"
            className="min-w-[220px] flex-1 rounded-[10px] border border-[var(--line)] bg-white px-3 py-1.5 text-sm"
          />
          <a className="btn-excel" href={apiUrl(`/api/projects/${projectId}/artifacts/blocks-xlsx`)}>
            <svg className="btn-excel__icon" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" opacity=".18" d="M8 3h9l4 4v13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
              <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" d="M8 3h9l4 4v13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
              <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" d="M17 3v4h4" />
              <path fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" d="M14 11h4M14 14h4M14 17h4" />
              <rect x="2.5" y="8" width="10" height="10" rx="1.5" fill="currentColor" />
              <path fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" d="m5.5 10.5 4 5m0-5-4 5" />
            </svg>
            <span className="btn-excel__divider" aria-hidden="true" />
            Export Block Summary
          </a>
        </div>

        <div className="table-wrap excel-wrap excel-wrap--page block-summary__wrap">
          <table className="excel-table" style={{ ["--excel-cols" as string]: COLS }}>
            <colgroup>
              {Array.from({ length: COLS }, (_, i) => (
                <col key={i} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th>FC</th>
                <th>Block name</th>
                <th>Symbol</th>
                <th>Blocks</th>
                <th>CAD files</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const key = String(r.functionCode ?? r.name);
                const isOpen = open === key;
                return (
                  <Fragment key={key}>
                    <tr
                      className={`block-summary__row${isOpen ? " is-open" : ""}`}
                      onClick={() => setOpen(isOpen ? null : key)}
                      aria-expanded={isOpen}
                    >
                      <td className="font-semibold">
                        <span className="block-summary__chev" aria-hidden>
                          {isOpen ? "▾" : "▸"}
                        </span>
                        {r.functionCode ?? "—"}
                      </td>
                      <td>{r.name}</td>
                      <td>{r.symbol ?? "—"}</td>
                      <td className="font-semibold tabular-nums">{r.count}</td>
                      <td className="tabular-nums">{r.sheets.length}</td>
                    </tr>
                    {isOpen && (
                      <tr className="loop-detail">
                        <td colSpan={COLS}>
                          <table className="loop-members">
                            <thead>
                              <tr>
                                <th>CAD file</th>
                                <th>Sheet title</th>
                                <th>Count</th>
                                <th>Block numbers</th>
                              </tr>
                            </thead>
                            <tbody>
                              {r.sheets.map((s) => (
                                <tr key={s.file}>
                                  <td>
                                    <button
                                      type="button"
                                      className="text-[var(--accent)] underline font-semibold"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onOpenCad(s.file);
                                      }}
                                    >
                                      {s.file}
                                    </button>
                                  </td>
                                  <td>{sheetTitles.get(s.file) || "—"}</td>
                                  <td className="tabular-nums">{s.blocks.length}</td>
                                  <td className="tabular-nums">{s.blocks.join(", ")}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={COLS} className="text-[var(--muted)]">
                    No function blocks match the search
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
