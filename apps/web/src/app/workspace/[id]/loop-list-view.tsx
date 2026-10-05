"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { apiUrl } from "@/lib/api-base";

type Device = {
  ioRecordId: string;
  role: "input" | "output";
  cardType: string;
  deviceTag: string;
  rawIoTag: string;
  description: string;
  cadFile?: string;
  loopEvidence: string;
};
type Loop = {
  id: string;
  loopTag: string;
  relatedDevices: Device[];
};
type Row = { loopId: string; cells: string[] };
type LoopListResponse = { loops: Loop[]; rows: Row[] };

const COLUMNS = [
  "$(PACKAGE)",
  "Process Area ID",
  "$(EXE)",
  "$(CTRLROOM)",
  "$(ALGROUP)",
  "$(NAME40_1)",
  "$(TAG)",
  "$(CARDTYPE1)",
  "$(DEVICETAG1)",
  "$(DEVICETAG1:MIN)",
  "$(DEVICETAG1:MAX)",
  "$(DEVICETAG1:UNIT)",
  "$(CARDTYPE2)",
  "$(DEVICETAG2)",
  "$(DEVICETAG2:MIN)",
  "$(DEVICETAG2:MAX)",
  "$(DEVICETAG2:UNIT)",
];
const TAG_COLUMN = 6;

type LoopKind = "control" | "input" | "output";
type KindFilter = "ALL" | LoopKind;

function loopKind(loop: Loop): LoopKind {
  const hasIn = loop.relatedDevices.some((d) => d.role === "input");
  const hasOut = loop.relatedDevices.some((d) => d.role === "output");
  if (hasIn && hasOut) return "control";
  return hasOut ? "output" : "input";
}

export function LoopListView({
  projectId,
  onOpenCad,
}: {
  projectId: string;
  onOpenCad: (file: string) => void;
}) {
  const [data, setData] = useState<LoopListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [kind, setKind] = useState<KindFilter>("ALL");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(apiUrl(`/api/projects/${projectId}/loop-list`));
      if (cancelled) return;
      if (!res.ok) {
        setError("Loop List is not available for this session");
        return;
      }
      setData((await res.json()) as LoopListResponse);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const loops = useMemo(() => new Map((data?.loops ?? []).map((l) => [l.id, l])), [data]);

  const kinds = useMemo(
    () => new Map((data?.loops ?? []).map((l) => [l.id, loopKind(l)])),
    [data]
  );

  const counts = useMemo(() => {
    const c = { ALL: kinds.size, control: 0, input: 0, output: 0 };
    for (const k of kinds.values()) c[k]++;
    return c;
  }, [kinds]);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => kind === "ALL" || kinds.get(row.loopId) === kind)
      .filter(({ row }) => !q || row.cells.some((c) => c.toLowerCase().includes(q)));
  }, [data, query, kind, kinds]);

  if (error || !data) {
    return (
      <p className="panel px-4 py-6 text-sm text-[var(--muted)]">
        {error ?? "Building Loop List…"}
      </p>
    );
  }

  return (
    <>
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        {(
          [
            ["ALL", "Loops", "All loop tags"],
            ["control", "Control", "Input and output"],
            ["input", "Input only", "Monitoring loops"],
            ["output", "Output only", "Output-driven loops"],
          ] as const
        ).map(([k, code, label]) => (
          <button
            key={k}
            type="button"
            className={`panel p-4 text-left transition ${
              kind === k && k !== "ALL" ? "ring-2 ring-[var(--accent)] border-[var(--accent)]" : ""
            }`}
            onClick={() => setKind((prev) => (prev === k ? "ALL" : k))}
          >
            <span className="inline-flex rounded-md bg-[var(--accent-soft)] px-2 py-1 text-xs font-bold tracking-wide text-[var(--accent-dark)]">
              {code}
            </span>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{counts[k]}</p>
            <p className="mt-1 text-[0.7rem] leading-snug text-[var(--muted)]">{label}</p>
          </button>
        ))}
      </div>

      <div className="panel overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-4 py-3">
        <span className="text-sm text-[var(--muted)] tabular-nums">
          {rows.length} rows
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search loop tag, device, description…"
          className="min-w-[220px] flex-1 rounded-[10px] border border-[var(--line)] bg-white px-3 py-1.5 text-sm"
        />
        <a className="btn-excel" href={apiUrl(`/api/projects/${projectId}/artifacts/loop-xlsx`)}>
          <svg className="btn-excel__icon" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" opacity=".18" d="M8 3h9l4 4v13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
            <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" d="M8 3h9l4 4v13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
            <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" d="M17 3v4h4" />
            <path fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" d="M14 11h4M14 14h4M14 17h4" />
            <rect x="2.5" y="8" width="10" height="10" rx="1.5" fill="currentColor" />
            <path fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" d="m5.5 10.5 4 5m0-5-4 5" />
          </svg>
          <span className="btn-excel__divider" aria-hidden="true" />
          Export Loop List
        </a>
      </div>
      <div className="table-wrap excel-wrap loop-wrap">
        <table className="excel-table loop-table" style={{ ["--excel-cols" as string]: COLUMNS.length }}>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ row, index }) => {
              const loop = loops.get(row.loopId);
              return (
                <Fragment key={index}>
                  <tr className="loop-row" onClick={() => setOpen((o) => (o === index ? null : index))}>
                    {row.cells.map((c, i) => (
                      <td key={i} className={i === TAG_COLUMN ? "font-semibold" : undefined}>
                        {c}
                      </td>
                    ))}
                  </tr>
                  {open === index && loop && (
                    <tr className="loop-detail">
                      <td colSpan={COLUMNS.length}>
                        <table className="loop-members">
                          <thead>
                            <tr>
                              <th>Role</th>
                              <th>Card</th>
                              <th>Device tag</th>
                              <th>Raw I/O tag</th>
                              <th>CAD</th>
                              <th>Description</th>
                              <th>Loop-tag source</th>
                            </tr>
                          </thead>
                          <tbody>
                            {loop.relatedDevices.map((d) => (
                              <tr key={d.ioRecordId}>
                                <td>{d.role}</td>
                                <td>{d.cardType}</td>
                                <td className="font-semibold">{d.deviceTag}</td>
                                <td>{d.rawIoTag}</td>
                                <td>
                                  {d.cadFile ? (
                                    <button
                                      type="button"
                                      className="text-[var(--accent)] underline"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onOpenCad(d.cadFile!);
                                      }}
                                    >
                                      {d.cadFile}
                                    </button>
                                  ) : (
                                    "—"
                                  )}
                                </td>
                                <td>{d.description}</td>
                                <td className="text-xs">{d.loopEvidence}</td>
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
          </tbody>
        </table>
      </div>
      </div>
    </>
  );
}
