"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiUrl } from "@/lib/api-base";

type IoRecord = {
  id: string;
  ioType: string;
  channel?: string;
  slave?: string;
  deviceTag?: string;
  rawIoTag: string;
  loopTag?: string;
  description?: string;
  cadFile?: string;
  direction?: string;
  destinationCads: string[];
  s1?: string;
  s2?: string;
  mappingStatus: string;
};

type LogicRecord = {
  id: string;
  cadFile: string;
  loopTag?: string;
  description?: string;
  blockId?: string;
  functionCode?: string;
  /** Numeric Bailey function code decoded from the SPC LIST trailer. */
  functionCodeNumber?: number;
  s1?: string;
  s2?: string;
  s3?: string;
  logicFormula?: string;
  inputRefs: string[];
  outputRefs: string[];
  deviceTag?: string;
};

type CadSheet = {
  filename: string;
  title?: string;
  sheetId?: string;
  descriptions: string[];
  loopTags: string[];
  deviceTags: string[];
  ioRefs: { raw: string; ioType?: string }[];
  oreffs: { raw: string; tag?: string; point?: string; targetCad?: string }[];
  functionBlocks: {
    functionCode?: string;
    functionCodeNumber?: number;
    blockId?: string;
    blockNumber?: string;
    s1?: string;
    s2?: string;
  }[];
  engineeringModel?: {
    blocks: {
      id: string;
      functionCode?: string;
      functionCodeNumber?: number;
      blockNumber?: string;
      parameters: Record<string, string>;
      inputRefs: string[];
      outputRefs: string[];
      deviceTags: string[];
      notes?: string;
      ports: { id: string; name: string; direction: string; signalName?: string }[];
      trace?: {
        confidence: number;
        validationStatus: string;
        sourceText?: string;
        sourceFilename?: string;
        sourceMethod?: string;
        /** Byte offset of the originating record in the source file. */
        sourceIndex?: number;
      };
    }[];
    connections: {
      id: string;
      sourceBlockId?: string;
      targetBlockId?: string;
      signalName?: string;
      resolved: boolean;
    }[];
    stats: {
      blockCount: number;
      connectionCount: number;
      tagCount: number;
      crossRefCount: number;
      unresolvedConnections: number;
    };
    validation: { status: string; warnings: string[] };
  };
};

type Graphic = {
  filename: string;
  title?: string;
  graphicId?: string;
  tags: { tag: string; objectName?: string }[];
  objectNames: string[];
};

type Session = {
  meta: {
    id: string;
    name: string;
    loop?: string;
    cpu?: string;
    module?: string;
    sourceZipName: string;
  };
  stats: {
    cadCount: number;
    m1Count: number;
    ioByType: Record<string, number>;
    xrfExpectedCad?: number;
    unresolvedCount: number;
  };
  inventory: { filename: string; kind: string; size: number }[];
  ioRecords: IoRecord[];
  logicRecords: LogicRecord[];
  cadSheets: CadSheet[];
  graphics: Graphic[];
  validation: {
    id: string;
    type: string;
    severity: string;
    message: string;
    relatedCad?: string;
  }[];
};

type Tab = "overview" | "io" | "logic" | "cad" | "graphics" | "validation";

function ViewerInner() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const id = params.id;
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>((search.get("tab") as Tab) || "overview");
  const [ioFilter, setIoFilter] = useState<IoBucketFilter>("ALL");
  const [logicFilter, setLogicFilter] = useState<string>("ALL");
  const [query, setQuery] = useState("");
  const [logicQuery, setLogicQuery] = useState("");
  const [selectedCad, setSelectedCad] = useState<string | null>(search.get("cad"));
  const [selectedGraphic, setSelectedGraphic] = useState<string | null>(null);
  const [cadQuery, setCadQuery] = useState("");
  const [m1Query, setM1Query] = useState("");
  const [cadSvgMarkup, setCadSvgMarkup] = useState<string | null>(null);
  const [cadFitWidth, setCadFitWidth] = useState(true);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(
    null
  );
  const [sheetDetailTab, setSheetDetailTab] = useState<
    "overview" | "io" | "logic" | "links"
  >("overview");
  const [graphicDetailTab, setGraphicDetailTab] = useState<
    "overview" | "tags" | "io" | "logic"
  >("overview");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch(apiUrl(`/api/projects/${id}`));
      if (!res.ok) {
        setError("Session not found or expired");
        return;
      }
      const data = (await res.json()) as Session;
      setSession(data);
      if (!selectedCad && data.cadSheets[0]) {
        setSelectedCad(data.cadSheets[0].filename);
      }
      if (!selectedGraphic && data.graphics[0]) {
        setSelectedGraphic(data.graphics[0].filename);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!selectedCad) {
      setCadSvgMarkup(null);
      setSelectedBlockId(null);
      setSelectedConnectionId(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const res = await fetch(
        apiUrl(`/api/projects/${id}/cad-svg/${encodeURIComponent(selectedCad)}`)
      );
      if (!res.ok || cancelled) return;
      const text = await res.text();
      if (!cancelled) {
        setCadSvgMarkup(text);
        setSelectedBlockId(null);
        setSelectedConnectionId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, selectedCad]);

  useEffect(() => {
    if (!cadSvgMarkup) return;
    const root = document.querySelector(".cad-viewer__svg-host svg");
    if (!root) return;
    root.querySelectorAll(".cad-block--selected").forEach((el) => {
      el.classList.remove("cad-block--selected");
    });
    root.querySelectorAll(".cad-wire--selected").forEach((el) => {
      el.classList.remove("cad-wire--selected");
    });
    if (selectedBlockId) {
      root
        .querySelector(`[data-block-id="${CSS.escape(selectedBlockId)}"]`)
        ?.classList.add("cad-block--selected");
    }
    if (selectedConnectionId) {
      root
        .querySelectorAll(
          `[data-connection-id="${CSS.escape(selectedConnectionId)}"]`
        )
        .forEach((el) => el.classList.add("cad-wire--selected"));
    }
  }, [cadSvgMarkup, selectedBlockId, selectedConnectionId]);

  const kindSummary = useMemo(() => {
    if (!session) return [];
    const counts = new Map<string, number>();
    for (const f of session.inventory) {
      counts.set(f.kind, (counts.get(f.kind) || 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [session]);

  const filteredIo = useMemo(() => {
    if (!session) return [];
    return session.ioRecords.filter((r) => {
      if (ioFilter !== "ALL") {
        const bucket = resolveIoBucket(r);
        if (bucket !== ioFilter) return false;
      }
      if (!query) return true;
      const q = query.toLowerCase();
      return (
        r.rawIoTag.toLowerCase().includes(q) ||
        r.deviceTag?.toLowerCase().includes(q) ||
        r.cadFile?.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q) ||
        r.loopTag?.toLowerCase().includes(q)
      );
    });
  }, [session, ioFilter, query]);

  const ioRows = useMemo(() => {
    const sorted = [...filteredIo].sort((a, b) => {
      const cadA = (a.cadFile || "—").toUpperCase();
      const cadB = (b.cadFile || "—").toUpperCase();
      if (cadA !== cadB) return cadA.localeCompare(cadB);
      return (a.rawIoTag || "").localeCompare(b.rawIoTag || "");
    });

    const groups = new Map<string, IoRecord[]>();
    for (const row of sorted) {
      const key = row.cadFile || "—";
      const list = groups.get(key) || [];
      list.push(row);
      groups.set(key, list);
    }

    return Array.from(groups.entries()).map(([cadFile, rows]) => ({
      cadFile,
      rows,
    }));
  }, [filteredIo]);

  const ioBucketCounts = useMemo(() => {
    const counts: Record<IoBucket, number> = {
      AI: 0,
      AI800_: 0,
      AO: 0,
      AO800_: 0,
      DI: 0,
      DI800_: 0,
      DO: 0,
      DO800_: 0,
    };
    if (!session) return counts;
    for (const r of session.ioRecords) {
      const bucket = resolveIoBucket(r);
      if (bucket) counts[bucket] += 1;
    }
    return counts;
  }, [session]);

  const logicSummary = useMemo(() => {
    const empty = {
      total: 0,
      cadSheets: 0,
      functionCodes: 0,
      withFormula: 0,
      withDevice: 0,
      withInputs: 0,
      withOutputs: 0,
      withSpecs: 0,
      topCodes: [] as { code: string; count: number }[],
    };
    if (!session) return empty;

    const cadSet = new Set<string>();
    const fcMap = new Map<string, number>();
    let withFormula = 0;
    let withDevice = 0;
    let withInputs = 0;
    let withOutputs = 0;
    let withSpecs = 0;

    for (const r of session.logicRecords) {
      if (r.cadFile) cadSet.add(r.cadFile);
      const code = r.functionCode || "—";
      fcMap.set(code, (fcMap.get(code) || 0) + 1);
      if (r.logicFormula) withFormula += 1;
      if (r.deviceTag) withDevice += 1;
      if (r.inputRefs.length) withInputs += 1;
      if (r.outputRefs.length) withOutputs += 1;
      if (r.s1 || r.s2) withSpecs += 1;
    }

    return {
      total: session.logicRecords.length,
      cadSheets: cadSet.size,
      functionCodes: fcMap.size,
      withFormula,
      withDevice,
      withInputs,
      withOutputs,
      withSpecs,
      topCodes: Array.from(fcMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([code, count]) => ({ code, count })),
    };
  }, [session]);

  const filteredLogic = useMemo(() => {
    if (!session) return [];
    return session.logicRecords.filter((r) => {
      if (logicFilter !== "ALL" && (r.functionCode || "—") !== logicFilter) {
        return false;
      }
      if (!logicQuery) return true;
      const q = logicQuery.toLowerCase();
      return (
        r.cadFile.toLowerCase().includes(q) ||
        r.blockId?.toLowerCase().includes(q) ||
        r.functionCode?.toLowerCase().includes(q) ||
        r.logicFormula?.toLowerCase().includes(q) ||
        r.deviceTag?.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q) ||
        r.s1?.toLowerCase().includes(q) ||
        r.s2?.toLowerCase().includes(q)
      );
    });
  }, [session, logicFilter, logicQuery]);

  const cad = session?.cadSheets.find((c) => c.filename === selectedCad);
  const graphic = session?.graphics.find((g) => g.filename === selectedGraphic);

  const selectedBlock = useMemo(() => {
    if (!cad?.engineeringModel || !selectedBlockId) return null;
    return (
      cad.engineeringModel.blocks.find((b) => b.id === selectedBlockId) ?? null
    );
  }, [cad, selectedBlockId]);

  const selectedConnection = useMemo(() => {
    if (!cad?.engineeringModel || !selectedConnectionId) return null;
    return (
      cad.engineeringModel.connections.find((c) => c.id === selectedConnectionId) ??
      null
    );
  }, [cad, selectedConnectionId]);

  const filteredCadSheets = useMemo(() => {
    if (!session) return [];
    if (!cadQuery) return session.cadSheets;
    const q = cadQuery.toLowerCase();
    return session.cadSheets.filter(
      (s) =>
        s.filename.toLowerCase().includes(q) ||
        s.title?.toLowerCase().includes(q) ||
        s.sheetId?.toLowerCase().includes(q)
    );
  }, [session, cadQuery]);

  const sheetIo = useMemo(() => {
    if (!session || !selectedCad) return [];
    const key = selectedCad.toUpperCase();
    return session.ioRecords.filter((r) => {
      const cadFile = (r.cadFile || "").toUpperCase();
      if (cadFile === key) return true;
      return r.destinationCads.some((d) => d.toUpperCase().includes(key.replace(/\.CAD$/i, "")));
    });
  }, [session, selectedCad]);

  const sheetLogic = useMemo(() => {
    if (!session || !selectedCad) return [];
    const key = selectedCad.toUpperCase();
    return session.logicRecords.filter(
      (r) => (r.cadFile || "").toUpperCase() === key
    );
  }, [session, selectedCad]);

  const sheetDevices = useMemo(() => {
    const tags = new Set<string>();
    cad?.deviceTags.forEach((t) => tags.add(t));
    sheetIo.forEach((r) => {
      if (r.deviceTag) tags.add(r.deviceTag);
    });
    sheetLogic.forEach((r) => {
      if (r.deviceTag) tags.add(r.deviceTag);
    });
    return Array.from(tags).sort((a, b) => a.localeCompare(b));
  }, [cad, sheetIo, sheetLogic]);

  const filteredGraphics = useMemo(() => {
    if (!session) return [];
    if (!m1Query) return session.graphics;
    const q = m1Query.toLowerCase();
    return session.graphics.filter(
      (g) =>
        g.filename.toLowerCase().includes(q) ||
        g.title?.toLowerCase().includes(q) ||
        g.graphicId?.toLowerCase().includes(q) ||
        g.tags.some((t) => t.tag.toLowerCase().includes(q))
    );
  }, [session, m1Query]);

  const graphicTagRows = useMemo(() => {
    if (!session || !graphic) return [];
    return graphic.tags.map((t) => {
      const io = session.ioRecords.find(
        (r) =>
          r.deviceTag?.toUpperCase() === t.tag.toUpperCase() ||
          r.rawIoTag.toUpperCase().includes(t.tag.toUpperCase())
      );
      const logic = session.logicRecords.filter(
        (r) =>
          r.deviceTag?.toUpperCase() === t.tag.toUpperCase() ||
          (io?.cadFile && r.cadFile.toUpperCase() === io.cadFile.toUpperCase())
      );
      return { ...t, io, logic };
    });
  }, [session, graphic]);

  const graphicIo = useMemo(() => {
    const seen = new Set<string>();
    const rows: IoRecord[] = [];
    for (const row of graphicTagRows) {
      if (row.io && !seen.has(row.io.id)) {
        seen.add(row.io.id);
        rows.push(row.io);
      }
    }
    return rows;
  }, [graphicTagRows]);

  const graphicLogic = useMemo(() => {
    const seen = new Set<string>();
    const rows: LogicRecord[] = [];
    for (const row of graphicTagRows) {
      for (const logic of row.logic) {
        if (!seen.has(logic.id)) {
          seen.add(logic.id);
          rows.push(logic);
        }
      }
    }
    return rows;
  }, [graphicTagRows]);

  const graphicDevices = useMemo(() => {
    const tags = new Set<string>();
    graphic?.tags.forEach((t) => tags.add(t.tag));
    graphic?.objectNames.forEach((n) => tags.add(n));
    graphicIo.forEach((r) => {
      if (r.deviceTag) tags.add(r.deviceTag);
    });
    return Array.from(tags).sort((a, b) => a.localeCompare(b));
  }, [graphic, graphicIo]);

  if (error) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-16">
        <p className="text-red-700">{error}</p>
        <Link href="/#upload" className="btn mt-4 inline-flex">
          Back to home
        </Link>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-16">
        <p className="text-[var(--muted)]">Loading session…</p>
      </main>
    );
  }

  const tabs: {
    id: Tab;
    label: string;
    icon: ReactNode;
  }[] = [
    {
      id: "overview",
      label: "Overview",
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" />
        </svg>
      ),
    },
    {
      id: "io",
      label: "I/O List",
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M8 9h8M8 12h8M8 15h5" />
        </svg>
      ),
    },
    {
      id: "logic",
      label: "Logic",
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3" y="5" width="7" height="5" rx="1" />
          <rect x="14" y="14" width="7" height="5" rx="1" />
          <path d="M10 7.5h2.5a2 2 0 0 1 2 2V16.5H14" />
        </svg>
      ),
    },
    {
      id: "cad",
      label: "CAD Viewer",
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18M9 3v18" />
        </svg>
      ),
    },
    {
      id: "graphics",
      label: "M1 Graphics",
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3" y="4" width="18" height="14" rx="2" />
          <path d="m7 14 3-3 2.5 2.5L16 10l3 4" />
          <circle cx="9" cy="8" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      ),
    },
    {
      id: "validation",
      label: "Validation",
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="8.5" />
          <path d="m8.5 12.2 2.4 2.4 4.6-5" />
        </svg>
      ),
    },
  ];

  return (
    <div className="workspace-shell">
      <header className="site-header">
        <div className="site-header__inner site-header__inner--wide">
          <Link href="/" className="brand">
            <Image
              src="/valmet-logo.webp"
              alt="Valmet"
              width={140}
              height={40}
              className="brand__logo"
              priority
            />
            <span className="brand__divider" aria-hidden>
              |
            </span>
            <span className="brand__product">ABB Bailey INFI 90 Migration Studio</span>
          </Link>
          <div className="workspace-export">
            <a className="btn btn-secondary btn-sm !ml-0" href={apiUrl(`/api/projects/${id}/artifacts/io-xlsx`)}>
              I/O Excel
            </a>
            <a className="btn btn-secondary btn-sm !ml-0" href={apiUrl(`/api/projects/${id}/artifacts/logic-xlsx`)}>
              Logic Excel
            </a>
            <a className="btn btn-secondary btn-sm !ml-0" href={apiUrl(`/api/projects/${id}/artifacts/cad-pdf`)}>
              CAD PDF
            </a>
            <a className="btn btn-sm !ml-0" href={apiUrl(`/api/projects/${id}/artifacts/m1-pdf`)}>
              Graphics PDF
            </a>
          </div>
        </div>
      </header>

      <div
        className={`workspace-layout ${sidebarCollapsed ? "workspace-layout--collapsed" : ""}`}
      >
        <aside className="workspace-sidebar">
          <div className="workspace-sidebar__top">
            <div className="workspace-sidebar__meta">
              <p className="text-xs font-semibold tracking-[0.14em] text-[var(--accent)] uppercase">
                Review session
              </p>
              <h1 className="mt-1 font-[family-name:var(--font-display)] text-lg font-semibold tracking-tight leading-snug">
                {session.meta.name}
              </h1>
              <p className="mt-1 text-xs text-[var(--muted)] break-all">
                {session.meta.sourceZipName}
              </p>
            </div>
            <button
              type="button"
              className="workspace-sidebar__collapse"
              onClick={() => setSidebarCollapsed((v) => !v)}
              aria-label={sidebarCollapsed ? "Expand menu" : "Collapse menu"}
              title={sidebarCollapsed ? "Expand menu" : "Collapse menu"}
            >
              {sidebarCollapsed ? "»" : "«"}
            </button>
          </div>
          <nav className="workspace-nav" aria-label="Workspace">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`workspace-nav__item ${tab === t.id ? "workspace-nav__item--active" : ""}`}
                onClick={() => setTab(t.id)}
                title={t.label}
                aria-label={t.label}
              >
                <span className="workspace-nav__icon" aria-hidden>
                  {t.icon}
                </span>
                <span className="workspace-nav__label">{t.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="workspace-main">
        {tab === "overview" && (
          <section className="space-y-5">
            <div>
              <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight">
                Overview
              </h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Session file summary and complete inventory by category.
              </p>
            </div>

            <div className="panel p-5">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3 className="text-lg font-semibold">Category summary</h3>
                  <p className="text-sm text-[var(--muted)]">
                    File counts grouped by engineering category
                  </p>
                </div>
                <p className="text-sm font-semibold text-[var(--accent)]">
                  {session.inventory.length} files total
                </p>
              </div>
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                {kindSummary.map(([kind, count]) => (
                  <div
                    key={kind}
                    className="rounded-xl border border-[var(--line)] bg-white px-4 py-3 shadow-[0_4px_12px_rgba(15,40,28,0.04)]"
                  >
                    <span className="inline-flex rounded-md bg-[var(--accent-soft)] px-2.5 py-1 text-sm font-bold tracking-wide text-[var(--accent-dark)]">
                      {kind}
                    </span>
                    <p className="mt-2.5 text-2xl font-semibold tabular-nums text-[var(--ink)]">
                      {count}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel overflow-hidden">
              <div className="border-b border-[var(--line)] px-5 py-4">
                <h3 className="text-lg font-semibold">All files</h3>
                <p className="text-sm text-[var(--muted)]">
                  Complete package inventory with file name and category
                </p>
              </div>
              <div className="table-wrap max-h-[min(70vh,720px)]">
                <table className="data inventory-table">
                  <colgroup>
                    <col />
                    <col />
                    <col />
                    <col />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>File name</th>
                      <th>Category</th>
                      <th>Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {session.inventory.map((f, index) => (
                      <tr key={`${f.kind}-${f.filename}-${index}`}>
                        <td className="text-[var(--muted)]">{index + 1}</td>
                        <td className="font-medium">{f.filename}</td>
                        <td>
                          <span className="inline-flex rounded-md bg-[var(--accent-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--accent-dark)]">
                            {f.kind}
                          </span>
                        </td>
                        <td className="tabular-nums text-[var(--muted)]">
                          {formatSize(f.size)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {tab === "io" && (
          <section className="space-y-4">
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4 xl:grid-cols-8">
              {(
                [
                  ["AI", "Analog Input", ioBucketCounts.AI],
                  ["AI800_", "AI800 series", ioBucketCounts.AI800_],
                  ["AO", "Analog Output", ioBucketCounts.AO],
                  ["AO800_", "AO800 series", ioBucketCounts.AO800_],
                  ["DI", "Digital Input", ioBucketCounts.DI],
                  ["DI800_", "DI800 series", ioBucketCounts.DI800_],
                  ["DO", "Digital Output", ioBucketCounts.DO],
                  ["DO800_", "DO800 series", ioBucketCounts.DO800_],
                ] as const
              ).map(([code, label, count]) => (
                <button
                  key={code}
                  type="button"
                  className={`panel p-4 text-left transition ${
                    ioFilter === code
                      ? "ring-2 ring-[var(--accent)] border-[var(--accent)]"
                      : ""
                  }`}
                  onClick={() =>
                    setIoFilter((prev) => (prev === code ? "ALL" : code))
                  }
                >
                  <span className="inline-flex rounded-md bg-[var(--accent-soft)] px-2 py-1 text-xs font-bold tracking-wide text-[var(--accent-dark)]">
                    {code}
                  </span>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">{count}</p>
                  <p className="mt-1 text-[0.7rem] leading-snug text-[var(--muted)]">
                    {label}
                  </p>
                </button>
              ))}
            </div>

            <div className="panel overflow-hidden p-0">
            <div className="flex flex-wrap gap-2 border-b border-[var(--line)] px-4 py-3">
              {(
                [
                  "ALL",
                  "AI",
                  "AI800_",
                  "AO",
                  "AO800_",
                  "DI",
                  "DI800_",
                  "DO",
                  "DO800_",
                ] as const
              ).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`tab-btn ${ioFilter === t ? "tab-btn--active" : "border border-[var(--line)]"}`}
                  onClick={() => setIoFilter(t)}
                >
                  {t}
                </button>
              ))}
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search tags, CAD, description…"
                className="min-w-[220px] flex-1 rounded-[10px] border border-[var(--line)] bg-white px-3 py-1.5 text-sm"
              />
            </div>
            <div className="table-wrap excel-wrap">
              <table className="excel-table" style={{ ["--excel-cols" as string]: 7 }}>
                <colgroup>
                  <col /><col /><col /><col /><col /><col /><col />
                </colgroup>
                <thead>
                  <tr>
                    <th>CAD</th>
                    <th>Type</th>
                    <th>Ch</th>
                    <th>Slave</th>
                    <th>Device</th>
                    <th>Loop tag</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {ioRows.map((group) =>
                    group.rows.map((r, index) => (
                      <tr key={r.id}>
                        {index === 0 && (
                          <td
                            rowSpan={group.rows.length}
                            className="excel-merge-cell"
                          >
                            {group.cadFile !== "—" ? (
                              <button
                                type="button"
                                className="text-[var(--accent)] underline font-semibold"
                                onClick={() => {
                                  setSelectedCad(group.cadFile);
                                  setTab("cad");
                                }}
                              >
                                {group.cadFile}
                              </button>
                            ) : (
                              "—"
                            )}
                          </td>
                        )}
                        <td>{r.ioType}</td>
                        <td>{r.channel}</td>
                        <td>{r.slave}</td>
                        <td>{r.deviceTag}</td>
                        <td>{r.loopTag}</td>
                        <td title={r.description}>{r.description || "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            </div>
          </section>
        )}

        {tab === "logic" && (
          <section className="space-y-4">
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4 xl:grid-cols-8">
              {(
                [
                  ["Total", "Logic blocks", logicSummary.total, "ALL"],
                  ["CAD", "Sheets used", logicSummary.cadSheets, "ALL"],
                  ["FC", "Function codes", logicSummary.functionCodes, "ALL"],
                  ["Formula", "With formula", logicSummary.withFormula, "ALL"],
                  ["Device", "With device tag", logicSummary.withDevice, "ALL"],
                  ["Inputs", "With inputs", logicSummary.withInputs, "ALL"],
                  ["Outputs", "With outputs", logicSummary.withOutputs, "ALL"],
                  ["Specs", "With S1 / S2", logicSummary.withSpecs, "ALL"],
                ] as const
              ).map(([code, label, count]) => (
                <div key={code} className="panel p-4">
                  <span className="inline-flex rounded-md bg-[var(--accent-soft)] px-2 py-1 text-xs font-bold tracking-wide text-[var(--accent-dark)]">
                    {code}
                  </span>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">{count}</p>
                  <p className="mt-1 text-[0.7rem] leading-snug text-[var(--muted)]">
                    {label}
                  </p>
                </div>
              ))}
            </div>

            <div className="panel overflow-hidden p-0">
              <div className="flex flex-wrap gap-2 border-b border-[var(--line)] px-4 py-3">
                <button
                  type="button"
                  className={`tab-btn ${logicFilter === "ALL" ? "tab-btn--active" : "border border-[var(--line)]"}`}
                  onClick={() => setLogicFilter("ALL")}
                >
                  ALL
                </button>
                {logicSummary.topCodes.map(({ code, count }) => (
                  <button
                    key={code}
                    type="button"
                    className={`tab-btn ${logicFilter === code ? "tab-btn--active" : "border border-[var(--line)]"}`}
                    onClick={() =>
                      setLogicFilter((prev) => (prev === code ? "ALL" : code))
                    }
                  >
                    {code} ({count})
                  </button>
                ))}
                <input
                  value={logicQuery}
                  onChange={(e) => setLogicQuery(e.target.value)}
                  placeholder="Search CAD, block, FC, formula…"
                  className="min-w-[220px] flex-1 rounded-[10px] border border-[var(--line)] bg-white px-3 py-1.5 text-sm"
                />
              </div>
              <div className="table-wrap excel-wrap">
                <table className="excel-table" style={{ ["--excel-cols" as string]: 10 }}>
                  <colgroup>
                    {Array.from({ length: 10 }).map((_, i) => (
                      <col key={i} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>
                      <th>CAD</th>
                      <th>Block</th>
                      <th>FC</th>
                      <th>S1</th>
                      <th>S2</th>
                      <th>Formula</th>
                      <th>Inputs</th>
                      <th>Outputs</th>
                      <th>Device</th>
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLogic.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <button
                            type="button"
                            className="text-[var(--accent)] underline font-semibold"
                            onClick={() => {
                              setSelectedCad(r.cadFile);
                              setTab("cad");
                            }}
                          >
                            {r.cadFile}
                          </button>
                        </td>
                        <td>{r.blockId || "—"}</td>
                        <td>
                          {r.functionCode || "—"}
                          {r.functionCodeNumber != null && (
                            <span className="text-[var(--muted)]">
                              {" "}
                              ({r.functionCodeNumber})
                            </span>
                          )}
                        </td>
                        <td>{r.s1 || "—"}</td>
                        <td>{r.s2 || "—"}</td>
                        <td title={r.logicFormula}>{r.logicFormula || "—"}</td>
                        <td>{r.inputRefs.join(", ") || "—"}</td>
                        <td>{r.outputRefs.join(", ") || "—"}</td>
                        <td>{r.deviceTag || "—"}</td>
                        <td>{r.description || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {tab === "cad" && (
          <section className="cad-viewer">
            <aside className="cad-viewer__left">
              <div className="cad-viewer__pane-head">
                <h3>CAD sheets</h3>
                <p>{session.cadSheets.length} sheets</p>
              </div>
              <div className="cad-viewer__search">
                <input
                  value={cadQuery}
                  onChange={(e) => setCadQuery(e.target.value)}
                  placeholder="Search sheets…"
                />
              </div>
              <div className="cad-viewer__list">
                {filteredCadSheets.map((s) => (
                  <button
                    key={s.filename}
                    type="button"
                    onClick={() => {
                      setSelectedCad(s.filename);
                      setSheetDetailTab("overview");
                    }}
                    className={`cad-viewer__sheet ${
                      selectedCad === s.filename ? "cad-viewer__sheet--active" : ""
                    }`}
                  >
                    <span className="cad-viewer__sheet-name">{s.filename}</span>
                    {s.title && (
                      <span className="cad-viewer__sheet-title">{s.title}</span>
                    )}
                  </button>
                ))}
              </div>
            </aside>

            <div className="cad-viewer__middle">
              <div className="cad-viewer__pane-head">
                <div>
                  <h3>{cad?.filename || "Select a CAD sheet"}</h3>
                  <p>Reconstructed engineering logic</p>
                </div>
                {cad && (
                  <div className="cad-viewer__stats">
                    <span>
                      {cad.engineeringModel?.stats.blockCount ??
                        cad.functionBlocks.length}{" "}
                      blocks
                    </span>
                    <span>
                      {cad.engineeringModel?.stats.connectionCount ?? 0} conn
                    </span>
                    <span>{sheetIo.length} I/O</span>
                    <span>{sheetDevices.length} devices</span>
                    <button
                      type="button"
                      onClick={() => setCadFitWidth((v) => !v)}
                      className="tab-btn"
                    >
                      {cadFitWidth ? "Actual size" : "Fit width"}
                    </button>
                  </div>
                )}
              </div>
              <div className="cad-viewer__canvas">
                {cad && cadSvgMarkup ? (
                  <div
                    className={`cad-viewer__svg-host ${
                      cadFitWidth ? "cad-viewer__svg-host--fit" : ""
                    }`}
                    dangerouslySetInnerHTML={{ __html: cadSvgMarkup }}
                    onClick={(e) => {
                      const el = e.target as Element;
                      const block = el.closest("[data-block-id]");
                      if (block) {
                        setSelectedBlockId(block.getAttribute("data-block-id"));
                        setSelectedConnectionId(null);
                        setSheetDetailTab("overview");
                        return;
                      }
                      const wire = el.closest("[data-connection-id]");
                      if (wire) {
                        setSelectedConnectionId(
                          wire.getAttribute("data-connection-id")
                        );
                        setSelectedBlockId(null);
                        setSheetDetailTab("overview");
                        return;
                      }
                      setSelectedBlockId(null);
                      setSelectedConnectionId(null);
                    }}
                  />
                ) : cad ? (
                  <p className="cad-viewer__empty">Loading reconstructed sheet…</p>
                ) : (
                  <p className="cad-viewer__empty">Choose a sheet from the left panel</p>
                )}
              </div>
            </div>

            <aside className="cad-viewer__right">
              <div className="cad-viewer__pane-head">
                <h3>Sheet details</h3>
                <p>{cad?.title || cad?.sheetId || "Selected sheet data"}</p>
              </div>

              <div className="cad-viewer__tabs">
                {(
                  [
                    ["overview", "Overview"],
                    ["io", "I/O"],
                    ["logic", "Logic S1/S2"],
                    ["links", "Links"],
                  ] as const
                ).map(([idTab, label]) => (
                  <button
                    key={idTab}
                    type="button"
                    className={sheetDetailTab === idTab ? "is-active" : ""}
                    onClick={() => setSheetDetailTab(idTab)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="cad-viewer__detail-body">
                {!cad && (
                  <p className="cad-viewer__empty">No sheet selected</p>
                )}

                {cad && sheetDetailTab === "overview" && (
                  <div className="cad-viewer__sections">
                    {selectedBlock && (
                      <section className="cad-viewer__block-detail">
                        <h4>Block details</h4>
                        <dl className="cad-viewer__meta">
                          <div>
                            <dt>Block ID</dt>
                            <dd>{selectedBlock.id}</dd>
                          </div>
                          <div>
                            <dt>Function code</dt>
                            <dd>
                              {selectedBlock.functionCodeNumber != null
                                ? `(${selectedBlock.functionCodeNumber}) `
                                : ""}
                              {selectedBlock.functionCode || "—"}
                            </dd>
                          </div>
                          <div>
                            <dt>Block #</dt>
                            <dd>{selectedBlock.blockNumber || "—"}</dd>
                          </div>
                          <div>
                            <dt>Inputs</dt>
                            <dd>
                              {selectedBlock.inputRefs.join(", ") || "—"}
                            </dd>
                          </div>
                          <div>
                            <dt>Outputs</dt>
                            <dd>
                              {selectedBlock.outputRefs.join(", ") || "—"}
                            </dd>
                          </div>
                          <div>
                            <dt>Tags</dt>
                            <dd>
                              {selectedBlock.deviceTags.join(", ") || "—"}
                            </dd>
                          </div>
                          <div>
                            <dt>Confidence</dt>
                            <dd>
                              {selectedBlock.trace
                                ? `${Math.round(selectedBlock.trace.confidence * 100)}% / ${selectedBlock.trace.validationStatus}`
                                : "—"}
                            </dd>
                          </div>
                          {/* Provenance: the byte this block was decoded from. */}
                          <div>
                            <dt>Source evidence</dt>
                            <dd>
                              {selectedBlock.trace?.sourceIndex != null
                                ? `${selectedBlock.trace.sourceFilename ?? cad.filename} @ byte ${selectedBlock.trace.sourceIndex}` +
                                  (selectedBlock.trace.sourceMethod
                                    ? ` (${selectedBlock.trace.sourceMethod})`
                                    : "")
                                : "—"}
                            </dd>
                          </div>
                        </dl>
                        {Object.keys(selectedBlock.parameters).length > 0 && (
                          <>
                            <h4 className="cad-viewer__subhead">S1… parameters</h4>
                            <dl className="cad-viewer__meta">
                              {Object.entries(selectedBlock.parameters).map(
                                ([k, v]) => (
                                  <div key={k}>
                                    <dt>{k}</dt>
                                    <dd>{v || "—"}</dd>
                                  </div>
                                )
                              )}
                            </dl>
                          </>
                        )}
                        {selectedBlock.ports.length > 0 && (
                          <>
                            <h4 className="cad-viewer__subhead">Ports</h4>
                            <ul className="cad-viewer__bullets">
                              {selectedBlock.ports.map((p) => (
                                <li key={p.id}>
                                  {p.name} ({p.direction})
                                  {p.signalName ? ` — ${p.signalName}` : ""}
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                      </section>
                    )}

                    {selectedConnection && (
                      <section className="cad-viewer__block-detail">
                        <h4>Connection details</h4>
                        <dl className="cad-viewer__meta">
                          <div>
                            <dt>ID</dt>
                            <dd>{selectedConnection.id}</dd>
                          </div>
                          <div>
                            <dt>Source</dt>
                            <dd>{selectedConnection.sourceBlockId || "—"}</dd>
                          </div>
                          <div>
                            <dt>Target</dt>
                            <dd>{selectedConnection.targetBlockId || "—"}</dd>
                          </div>
                          <div>
                            <dt>Signal</dt>
                            <dd>{selectedConnection.signalName || "—"}</dd>
                          </div>
                          <div>
                            <dt>Resolved</dt>
                            <dd>
                              {selectedConnection.resolved ? "yes" : "no"}
                            </dd>
                          </div>
                        </dl>
                      </section>
                    )}

                    <section>
                      <h4>Sheet data</h4>
                      <dl className="cad-viewer__meta">
                        <div>
                          <dt>File</dt>
                          <dd>{cad.filename}</dd>
                        </div>
                        <div>
                          <dt>Title</dt>
                          <dd>{cad.title || "—"}</dd>
                        </div>
                        <div>
                          <dt>Sheet ID</dt>
                          <dd>{cad.sheetId || "—"}</dd>
                        </div>
                        <div>
                          <dt>Loop tags</dt>
                          <dd>{cad.loopTags.join(", ") || "—"}</dd>
                        </div>
                        {cad.engineeringModel && (
                          <>
                            <div>
                              <dt>Model status</dt>
                              <dd>{cad.engineeringModel.validation.status}</dd>
                            </div>
                            <div>
                              <dt>Unresolved xref</dt>
                              <dd>
                                {
                                  cad.engineeringModel.stats
                                    .unresolvedConnections
                                }
                              </dd>
                            </div>
                          </>
                        )}
                      </dl>
                    </section>

                    <section>
                      <h4>Descriptions</h4>
                      {cad.descriptions.length === 0 ? (
                        <p className="cad-viewer__muted">No descriptions</p>
                      ) : (
                        <ul className="cad-viewer__bullets">
                          {cad.descriptions.map((d) => (
                            <li key={d}>{d}</li>
                          ))}
                        </ul>
                      )}
                    </section>

                    <section>
                      <h4>Device tags ({sheetDevices.length})</h4>
                      {sheetDevices.length === 0 ? (
                        <p className="cad-viewer__muted">No device tags</p>
                      ) : (
                        <div className="cad-viewer__chips">
                          {sheetDevices.map((tag) => (
                            <span key={tag}>{tag}</span>
                          ))}
                        </div>
                      )}
                    </section>

                    <section>
                      <h4>Function blocks ({cad.functionBlocks.length})</h4>
                      {cad.functionBlocks.length === 0 ? (
                        <p className="cad-viewer__muted">No function blocks</p>
                      ) : (
                        <div className="cad-viewer__mini-table-wrap">
                          <table className="cad-viewer__mini-table">
                            <thead>
                              <tr>
                                <th>Block</th>
                                <th>FC</th>
                                <th>S1</th>
                                <th>S2</th>
                              </tr>
                            </thead>
                            <tbody>
                              {cad.functionBlocks.map((b, i) => (
                                <tr key={`${b.blockId ?? b.functionCode}-${i}`}>
                                  <td>{b.blockId || "—"}</td>
                                  <td>
                                    {b.functionCode || "—"}
                                    {b.functionCodeNumber != null && (
                                      <span className="text-[var(--muted)]">
                                        {" "}
                                        ({b.functionCodeNumber})
                                      </span>
                                    )}
                                  </td>
                                  <td>{b.s1 || "—"}</td>
                                  <td>{b.s2 || "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>
                  </div>
                )}

                {cad && sheetDetailTab === "io" && (
                  <div className="cad-viewer__sections">
                    <section>
                      <h4>I/O on this sheet ({sheetIo.length})</h4>
                      {sheetIo.length === 0 ? (
                        <p className="cad-viewer__muted">No I/O mapped to this sheet</p>
                      ) : (
                        <div className="cad-viewer__mini-table-wrap">
                          <table className="cad-viewer__mini-table">
                            <thead>
                              <tr>
                                <th>Type</th>
                                <th>Ch</th>
                                <th>Slave</th>
                                <th>Device</th>
                                <th>Loop</th>
                                <th>S1</th>
                                <th>S2</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sheetIo.map((r) => (
                                <tr key={r.id}>
                                  <td>{r.ioType}</td>
                                  <td>{r.channel || "—"}</td>
                                  <td>{r.slave || "—"}</td>
                                  <td>{r.deviceTag || "—"}</td>
                                  <td>{r.loopTag || "—"}</td>
                                  <td>{r.s1 || "—"}</td>
                                  <td>{r.s2 || "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>

                    <section>
                      <h4>Sheet I/O refs ({cad.ioRefs.length})</h4>
                      {cad.ioRefs.length === 0 ? (
                        <p className="cad-viewer__muted">No I/O refs on sheet</p>
                      ) : (
                        <ul className="cad-viewer__bullets">
                          {cad.ioRefs.map((io) => (
                            <li key={io.raw}>
                              <strong>{io.ioType || "IO"}</strong> {io.raw}
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  </div>
                )}

                {cad && sheetDetailTab === "logic" && (
                  <div className="cad-viewer__sections">
                    <section>
                      <h4>Logic blocks with S1 / S2 ({sheetLogic.length})</h4>
                      {sheetLogic.length === 0 ? (
                        <p className="cad-viewer__muted">No logic records for this sheet</p>
                      ) : (
                        <div className="cad-viewer__mini-table-wrap">
                          <table className="cad-viewer__mini-table">
                            <thead>
                              <tr>
                                <th>Block</th>
                                <th>FC</th>
                                <th>S1</th>
                                <th>S2</th>
                                <th>Device</th>
                                <th>Formula</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sheetLogic.map((r) => (
                                <tr key={r.id}>
                                  <td>{r.blockId || "—"}</td>
                                  <td>{r.functionCode || "—"}</td>
                                  <td>{r.s1 || "—"}</td>
                                  <td>{r.s2 || "—"}</td>
                                  <td>{r.deviceTag || "—"}</td>
                                  <td>{r.logicFormula || "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>
                  </div>
                )}

                {cad && sheetDetailTab === "links" && (
                  <div className="cad-viewer__sections">
                    <section>
                      <h4>Cross-sheet links ({cad.oreffs.length})</h4>
                      {cad.oreffs.length === 0 ? (
                        <p className="cad-viewer__muted">No OREF links</p>
                      ) : (
                        <ul className="cad-viewer__bullets">
                          {cad.oreffs.map((o, i) => (
                            <li key={`${o.raw}-${i}`}>
                              {o.tag || o.raw}
                              {o.targetCad ? (
                                <>
                                  {" → "}
                                  <button
                                    type="button"
                                    className="cad-viewer__link"
                                    onClick={() => {
                                      const hit = session.cadSheets.find((c) =>
                                        c.filename
                                          .toUpperCase()
                                          .startsWith(o.targetCad!.toUpperCase())
                                      );
                                      if (hit) setSelectedCad(hit.filename);
                                    }}
                                  >
                                    {o.targetCad}
                                  </button>
                                </>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  </div>
                )}
              </div>
            </aside>
          </section>
        )}

        {tab === "graphics" && (
          <section className="cad-viewer">
            <aside className="cad-viewer__left">
              <div className="cad-viewer__pane-head">
                <h3>M1 graphics</h3>
                <p>{session.graphics.length} graphics</p>
              </div>
              <div className="cad-viewer__search">
                <input
                  value={m1Query}
                  onChange={(e) => setM1Query(e.target.value)}
                  placeholder="Search graphics…"
                />
              </div>
              <div className="cad-viewer__list">
                {filteredGraphics.map((g) => (
                  <button
                    key={g.filename}
                    type="button"
                    onClick={() => {
                      setSelectedGraphic(g.filename);
                      setGraphicDetailTab("overview");
                    }}
                    className={`cad-viewer__sheet ${
                      selectedGraphic === g.filename ? "cad-viewer__sheet--active" : ""
                    }`}
                  >
                    <span className="cad-viewer__sheet-name">{g.filename}</span>
                    {g.title && (
                      <span className="cad-viewer__sheet-title">{g.title}</span>
                    )}
                  </button>
                ))}
              </div>
            </aside>

            <div className="cad-viewer__middle">
              <div className="cad-viewer__pane-head">
                <div>
                  <h3>{graphic?.filename || "Select an M1 graphic"}</h3>
                  <p>Reconstructed graphics view</p>
                </div>
                {graphic && (
                  <div className="cad-viewer__stats">
                    <span>{graphic.tags.length} tags</span>
                    <span>{graphicIo.length} I/O</span>
                    <span>{graphicLogic.length} logic</span>
                    <span>{graphicDevices.length} devices</span>
                  </div>
                )}
              </div>
              <div className="cad-viewer__canvas">
                {graphic ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={apiUrl(`/api/projects/${id}/m1-svg/${encodeURIComponent(graphic.filename)}`)}
                    alt={graphic.filename}
                  />
                ) : (
                  <p className="cad-viewer__empty">Choose a graphic from the left panel</p>
                )}
              </div>
            </div>

            <aside className="cad-viewer__right">
              <div className="cad-viewer__pane-head">
                <h3>Graphic details</h3>
                <p>{graphic?.title || graphic?.graphicId || "Selected graphic data"}</p>
              </div>

              <div className="cad-viewer__tabs">
                {(
                  [
                    ["overview", "Overview"],
                    ["tags", "Tags"],
                    ["io", "I/O"],
                    ["logic", "Logic S1/S2"],
                  ] as const
                ).map(([idTab, label]) => (
                  <button
                    key={idTab}
                    type="button"
                    className={graphicDetailTab === idTab ? "is-active" : ""}
                    onClick={() => setGraphicDetailTab(idTab)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="cad-viewer__detail-body">
                {!graphic && (
                  <p className="cad-viewer__empty">No graphic selected</p>
                )}

                {graphic && graphicDetailTab === "overview" && (
                  <div className="cad-viewer__sections">
                    <section>
                      <h4>Graphic data</h4>
                      <dl className="cad-viewer__meta">
                        <div>
                          <dt>File</dt>
                          <dd>{graphic.filename}</dd>
                        </div>
                        <div>
                          <dt>Title</dt>
                          <dd>{graphic.title || "—"}</dd>
                        </div>
                        <div>
                          <dt>Graphic ID</dt>
                          <dd>{graphic.graphicId || "—"}</dd>
                        </div>
                        <div>
                          <dt>Tags</dt>
                          <dd>{graphic.tags.length}</dd>
                        </div>
                      </dl>
                    </section>

                    <section>
                      <h4>Device / object tags ({graphicDevices.length})</h4>
                      {graphicDevices.length === 0 ? (
                        <p className="cad-viewer__muted">No device tags</p>
                      ) : (
                        <div className="cad-viewer__chips">
                          {graphicDevices.map((tag) => (
                            <span key={tag}>{tag}</span>
                          ))}
                        </div>
                      )}
                    </section>

                    <section>
                      <h4>Object names ({graphic.objectNames.length})</h4>
                      {graphic.objectNames.length === 0 ? (
                        <p className="cad-viewer__muted">No object names</p>
                      ) : (
                        <ul className="cad-viewer__bullets">
                          {graphic.objectNames.map((name) => (
                            <li key={name}>{name}</li>
                          ))}
                        </ul>
                      )}
                    </section>
                  </div>
                )}

                {graphic && graphicDetailTab === "tags" && (
                  <div className="cad-viewer__sections">
                    <section>
                      <h4>Tags on graphic ({graphic.tags.length})</h4>
                      {graphicTagRows.length === 0 ? (
                        <p className="cad-viewer__muted">No tags on this graphic</p>
                      ) : (
                        <div className="cad-viewer__mini-table-wrap">
                          <table className="cad-viewer__mini-table">
                            <thead>
                              <tr>
                                <th>Tag</th>
                                <th>Object</th>
                                <th>I/O</th>
                                <th>CAD</th>
                              </tr>
                            </thead>
                            <tbody>
                              {graphicTagRows.map((t) => (
                                <tr key={`${t.tag}-${t.objectName || ""}`}>
                                  <td>{t.tag}</td>
                                  <td>{t.objectName || "—"}</td>
                                  <td>{t.io?.ioType || "—"}</td>
                                  <td>
                                    {t.io?.cadFile ? (
                                      <button
                                        type="button"
                                        className="cad-viewer__link"
                                        onClick={() => {
                                          setSelectedCad(t.io!.cadFile!);
                                          setTab("cad");
                                        }}
                                      >
                                        {t.io.cadFile}
                                      </button>
                                    ) : (
                                      "—"
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>
                  </div>
                )}

                {graphic && graphicDetailTab === "io" && (
                  <div className="cad-viewer__sections">
                    <section>
                      <h4>I/O linked to this graphic ({graphicIo.length})</h4>
                      {graphicIo.length === 0 ? (
                        <p className="cad-viewer__muted">No linked I/O records</p>
                      ) : (
                        <div className="cad-viewer__mini-table-wrap">
                          <table className="cad-viewer__mini-table">
                            <thead>
                              <tr>
                                <th>Type</th>
                                <th>Ch</th>
                                <th>Slave</th>
                                <th>Device</th>
                                <th>Loop</th>
                                <th>S1</th>
                                <th>S2</th>
                                <th>CAD</th>
                              </tr>
                            </thead>
                            <tbody>
                              {graphicIo.map((r) => (
                                <tr key={r.id}>
                                  <td>{r.ioType}</td>
                                  <td>{r.channel || "—"}</td>
                                  <td>{r.slave || "—"}</td>
                                  <td>{r.deviceTag || "—"}</td>
                                  <td>{r.loopTag || "—"}</td>
                                  <td>{r.s1 || "—"}</td>
                                  <td>{r.s2 || "—"}</td>
                                  <td>
                                    {r.cadFile ? (
                                      <button
                                        type="button"
                                        className="cad-viewer__link"
                                        onClick={() => {
                                          setSelectedCad(r.cadFile!);
                                          setTab("cad");
                                        }}
                                      >
                                        {r.cadFile}
                                      </button>
                                    ) : (
                                      "—"
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>
                  </div>
                )}

                {graphic && graphicDetailTab === "logic" && (
                  <div className="cad-viewer__sections">
                    <section>
                      <h4>Logic with S1 / S2 ({graphicLogic.length})</h4>
                      {graphicLogic.length === 0 ? (
                        <p className="cad-viewer__muted">No linked logic records</p>
                      ) : (
                        <div className="cad-viewer__mini-table-wrap">
                          <table className="cad-viewer__mini-table">
                            <thead>
                              <tr>
                                <th>CAD</th>
                                <th>Block</th>
                                <th>FC</th>
                                <th>S1</th>
                                <th>S2</th>
                                <th>Device</th>
                                <th>Formula</th>
                              </tr>
                            </thead>
                            <tbody>
                              {graphicLogic.map((r) => (
                                <tr key={r.id}>
                                  <td>
                                    <button
                                      type="button"
                                      className="cad-viewer__link"
                                      onClick={() => {
                                        setSelectedCad(r.cadFile);
                                        setTab("cad");
                                      }}
                                    >
                                      {r.cadFile}
                                    </button>
                                  </td>
                                  <td>{r.blockId || "—"}</td>
                                  <td>{r.functionCode || "—"}</td>
                                  <td>{r.s1 || "—"}</td>
                                  <td>{r.s2 || "—"}</td>
                                  <td>{r.deviceTag || "—"}</td>
                                  <td>{r.logicFormula || "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>
                  </div>
                )}
              </div>
            </aside>
          </section>
        )}

        {tab === "validation" && (
          <section className="panel p-4">
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Severity</th>
                    <th>Type</th>
                    <th>Message</th>
                    <th>CAD</th>
                  </tr>
                </thead>
                <tbody>
                  {session.validation.map((v) => (
                    <tr key={v.id}>
                      <td>{v.severity}</td>
                      <td>{v.type}</td>
                      <td className="max-w-xl whitespace-normal">{v.message}</td>
                      <td>{v.relatedCad}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        </main>
      </div>
    </div>
  );
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type IoBucket =
  | "AI"
  | "AI800_"
  | "AO"
  | "AO800_"
  | "DI"
  | "DI800_"
  | "DO"
  | "DO800_";

type IoBucketFilter = "ALL" | IoBucket;

function resolveIoBucket(r: IoRecord): IoBucket | null {
  const sources = [r.rawIoTag, r.deviceTag, r.loopTag, r.ioType]
    .filter(Boolean)
    .map((s) => String(s).toUpperCase());

  for (const src of sources) {
    if (src.startsWith("AI800_")) return "AI800_";
    if (src.startsWith("AO800_")) return "AO800_";
    if (src.startsWith("DI800_")) return "DI800_";
    if (src.startsWith("DO800_")) return "DO800_";
  }

  for (const src of sources) {
    if (src === "AI" || src.startsWith("AI")) return "AI";
    if (src === "AO" || src.startsWith("AO")) return "AO";
    if (src === "DI" || src.startsWith("DI")) return "DI";
    if (src === "DO" || src.startsWith("DO")) return "DO";
  }

  return null;
}

export default function WorkspacePage() {
  return (
    <Suspense fallback={<main className="p-8 text-[var(--muted)]">Loading…</main>}>
      <ViewerInner />
    </Suspense>
  );
}
