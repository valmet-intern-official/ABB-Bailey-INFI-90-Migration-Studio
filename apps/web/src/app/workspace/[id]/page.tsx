"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";
import { apiUrl } from "@/lib/api-base";
import { peekResult, resultKey } from "@/lib/result-cache";
import {
  buildIoIndex,
  linksFromSheet,
  lookupIo,
  type IoNavHit,
} from "@/lib/io-navigation";
import { CadPdfView, centerInScroller, PDF_ZOOM_MAX, PDF_ZOOM_MIN } from "./cad-pdf-view";
import { LoopListView } from "./loop-list-view";
import { BlockSummaryView } from "./block-summary-view";

type IoRecord = {
  id: string;
  ioType: string;
  channel?: string;
  slave?: string;
  deviceTag?: string;
  rawIoTag: string;
  loopTag?: string;
  loopTagNote?: string;
  description?: string;
  descriptionNote?: string;
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
    crossReferences?: {
      signal?: string;
      address?: string;
      targetIdentifier?: string;
      targetSheet?: string;
    }[];
    validation: { status: string; warnings: string[] };
  };
};

type SheetLogicBlock = {
  block: number;
  functionCode: number | null;
  name: string | null;
  symbol: string | null;
  status: string;
  specs: {
    label: string;
    value: string | null;
    status: string;
    type: string;
    default: string;
    range: string;
    description: string;
    meaning: string | null;
  }[];
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
    ioByType: Record<string, number>;
    xrfExpectedCad?: number;
    unresolvedCount: number;
  };
  inventory: { filename: string; kind: string; size: number }[];
  ioRecords: IoRecord[];
  logicRecords: LogicRecord[];
  cadSheets: CadSheet[];
  validation: {
    id: string;
    type: string;
    severity: string;
    message: string;
    relatedCad?: string;
  }[];
};

type Tab = "overview" | "io" | "loops" | "logic" | "cad";

const DETAIL_WIDTH_KEY = "cad-viewer:detail-width";
const DETAIL_MIN_WIDTH = 420;
/** Sheet list plus the narrowest usable drawing. */
const DETAIL_RESERVED_WIDTH = 220 + 380;
const TABS: Tab[] = ["overview", "io", "loops", "logic", "cad"];

function ViewerInner() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const id = params.id;
  const [session, setSession] = useState<Session | null>(() => peekResult<Session>(resultKey.cadSession(id)) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(() => {
    const requested = search.get("tab") as Tab;
    if (requested === "io" && search.get("view") === "loops") return "loops";
    return TABS.includes(requested) ? requested : "overview";
  });
  const [ioFilter, setIoFilter] = useState<IoBucketFilter>("ALL");
  const [query, setQuery] = useState("");
  const [selectedCad, setSelectedCad] = useState<string | null>(() => {
    const requested = search.get("cad");
    if (requested) return requested === "summary" ? null : requested;
    return session?.cadSheets[0]?.filename ?? null;
  });
  const [cadQuery, setCadQuery] = useState("");
  const [cadSvgMarkup, setCadSvgMarkup] = useState<string | null>(() =>
    selectedCad ? peekResult<string>(resultKey.cadSvg(id, selectedCad)) ?? null : null
  );
  const [cadZoom, setCadZoom] = useState(1);
  const [cadFitWidth, setCadFitWidth] = useState(true);
  const cadCanvasRef = useRef<HTMLDivElement | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(
    null
  );
  const cadViewerRef = useRef<HTMLElement | null>(null);
  const [cadView, setCadView] = useState<"pdf" | "svg">("pdf");
  const [cadSummary, setCadSummary] = useState(search.get("cad") === "summary");
  const [sheetDetailTab, setSheetDetailTab] = useState<"io" | "logic">("io");
  /** null means the stylesheet default width. */
  const [detailWidth, setDetailWidth] = useState<number | null>(null);
  const [resizingDetail, setResizingDetail] = useState(false);
  const [ioNav, setIoNav] = useState<{
    hit: IoNavHit;
    links: ReturnType<typeof linksFromSheet>;
    top: number;
    left: number;
  } | null>(null);

  useEffect(() => {
    const saved = Number(window.localStorage.getItem(DETAIL_WIDTH_KEY));
    if (saved > 0) setDetailWidth(saved);
  }, []);

  const clampDetailWidth = useCallback((w: number) => {
    const total = cadViewerRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    const max = Math.max(DETAIL_MIN_WIDTH, total - DETAIL_RESERVED_WIDTH);
    return Math.round(Math.min(max, Math.max(DETAIL_MIN_WIDTH, w)));
  }, []);

  const commitDetailWidth = useCallback((w: number | null) => {
    setDetailWidth(w);
    if (w === null) window.localStorage.removeItem(DETAIL_WIDTH_KEY);
    else window.localStorage.setItem(DETAIL_WIDTH_KEY, String(w));
  }, []);

  const startDetailResize = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const viewer = cadViewerRef.current;
      if (!viewer) return;
      e.preventDefault();
      const handle = e.currentTarget;
      handle.setPointerCapture(e.pointerId);
      setResizingDetail(true);
      const right = viewer.getBoundingClientRect().right;
      let latest = detailWidth;
      const onMove = (ev: PointerEvent) => {
        latest = clampDetailWidth(right - ev.clientX);
        setDetailWidth(latest);
      };
      const onUp = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        setResizingDetail(false);
        commitDetailWidth(latest);
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    },
    [clampDetailWidth, commitDetailWidth, detailWidth]
  );

  const onDetailResizeKey = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const pane = cadViewerRef.current?.querySelector(".cad-viewer__right");
      const current = detailWidth ?? pane?.getBoundingClientRect().width ?? DETAIL_MIN_WIDTH;
      const step = e.shiftKey ? 80 : 20;
      if (e.key === "ArrowLeft") commitDetailWidth(clampDetailWidth(current + step));
      else if (e.key === "ArrowRight") commitDetailWidth(clampDetailWidth(current - step));
      else if (e.key === "Home") commitDetailWidth(null);
      else return;
      e.preventDefault();
    },
    [clampDetailWidth, commitDetailWidth, detailWidth]
  );
  const [logicVersion, setLogicVersion] = useState(0);
  const [reprocessing, setReprocessing] = useState(false);
  /** undefined while loading, null when the session has no specifications. */
  const [sheetBlocks, setSheetBlocks] = useState<SheetLogicBlock[] | null | undefined>(undefined);

  useEffect(() => {
    if (!selectedCad) {
      setSheetBlocks([]);
      return;
    }
    let cancelled = false;
    const preloaded = logicVersion === 0 ? peekResult<SheetLogicBlock[]>(resultKey.cadBlocks(id, selectedCad)) : undefined;
    if (preloaded) {
      setSheetBlocks(preloaded);
      return;
    }
    setSheetBlocks(undefined);
    void (async () => {
      const res = await fetch(
        apiUrl(`/api/projects/${id}/cad-logic/${encodeURIComponent(selectedCad)}`)
      );
      if (cancelled) return;
      if (!res.ok) {
        setSheetBlocks(null);
        return;
      }
      const data = (await res.json()) as { blocks: SheetLogicBlock[] };
      if (!cancelled) setSheetBlocks(data.blocks);
    })();
    return () => {
      cancelled = true;
    };
  }, [id, selectedCad, logicVersion]);

  const reprocessSession = useCallback(async () => {
    setReprocessing(true);
    try {
      await fetch(apiUrl(`/api/projects/${id}/redecode`), { method: "POST" });
    } finally {
      setReprocessing(false);
      setLogicVersion((v) => v + 1);
    }
  }, [id]);
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
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    setIoNav(null);
    if (!selectedCad) {
      setCadSvgMarkup(null);
      setSelectedBlockId(null);
      setSelectedConnectionId(null);
      return;
    }
    let cancelled = false;
    const preloaded = peekResult<string>(resultKey.cadSvg(id, selectedCad));
    if (preloaded) {
      setCadSvgMarkup(preloaded);
      setSelectedBlockId(null);
      setSelectedConnectionId(null);
      setCadZoom(1);
      setCadFitWidth(true);
      return;
    }
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
        setCadZoom(1);
        setCadFitWidth(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, selectedCad]);
  const CAD_ZOOM_MIN = 0.25;
  const CAD_ZOOM_MAX = 5;
  const CAD_ZOOM_STEP = 1.2;

  const cadSvgNatural = useMemo(() => {
    if (!cadSvgMarkup) return { w: 1200, h: 800 };
    const wm = /(?:\s|^)width="([\d.]+)"/.exec(cadSvgMarkup);
    const hm = /(?:\s|^)height="([\d.]+)"/.exec(cadSvgMarkup);
    return {
      w: Math.max(100, Number(wm?.[1] || 1200)),
      h: Math.max(100, Number(hm?.[1] || 800)),
    };
  }, [cadSvgMarkup]);

  const clampCadZoom = useCallback((z: number) => {
    return Math.min(CAD_ZOOM_MAX, Math.max(CAD_ZOOM_MIN, Math.round(z * 100) / 100));
  }, []);

  const currentCadBaseZoom = useCallback(() => {
    if (!cadFitWidth) return cadZoom;
    const el = cadCanvasRef.current;
    const host = el?.querySelector(".cad-viewer__svg-host") as HTMLElement | null;
    if (host && cadSvgNatural.w > 0) {
      return Math.max(0.05, host.clientWidth / cadSvgNatural.w);
    }
    return 1;
  }, [cadFitWidth, cadZoom, cadSvgNatural.w]);

  const zoomCadBy = useCallback(
    (factor: number) => {
      const base = currentCadBaseZoom();
      setCadFitWidth(false);
      setCadZoom(clampCadZoom(base * factor));
    },
    [clampCadZoom, currentCadBaseZoom]
  );

  const zoomCadIn = useCallback(() => zoomCadBy(CAD_ZOOM_STEP), [zoomCadBy]);
  const zoomCadOut = useCallback(() => zoomCadBy(1 / CAD_ZOOM_STEP), [zoomCadBy]);
  const zoomCadReset = useCallback(() => {
    setCadFitWidth(false);
    setCadZoom(1);
  }, []);
  const zoomCadFit = useCallback(() => {
    setCadFitWidth(true);
    setCadZoom(1);
  }, []);

  /** PDF points to CSS pixels; null fits the page width. */
  const [pdfZoom, setPdfZoom] = useState<number | null>(null);
  const [pdfFitScale, setPdfFitScale] = useState(1);
  const zoomPdfBy = useCallback(
    (factor: number) => {
      setPdfZoom((z) =>
        Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, (z ?? pdfFitScale) * factor))
      );
    },
    [pdfFitScale]
  );
  useEffect(() => {
    setPdfZoom(null);
  }, [selectedCad]);

  /** Drawing point (in unscaled SVG units) that must stay under the cursor after a wheel zoom. */
  const cadZoomAnchorRef = useRef<{ ux: number; uy: number; x: number; y: number } | null>(null);
  const cadBaseZoomRef = useRef(currentCadBaseZoom);
  cadBaseZoomRef.current = currentCadBaseZoom;

  const cadCanvasReady = tab === "cad" && !!session;
  useEffect(() => {
    const canvas = cadCanvasRef.current;
    if (!cadCanvasReady || !canvas) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const host = canvas.querySelector(".cad-viewer__svg-host") as HTMLElement | null;
      if (!host) return;
      e.preventDefault();
      const base = cadBaseZoomRef.current();
      const pixels = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      const delta = Math.max(-120, Math.min(120, pixels));
      const next = Math.min(CAD_ZOOM_MAX, Math.max(CAD_ZOOM_MIN, base * Math.exp(-delta * 0.0018)));
      if (next === base) return;
      const r = host.getBoundingClientRect();
      cadZoomAnchorRef.current = {
        ux: (e.clientX - r.left) / base,
        uy: (e.clientY - r.top) / base,
        x: e.clientX,
        y: e.clientY,
      };
      setCadFitWidth(false);
      setCadZoom(next);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [cadCanvasReady]);

  useLayoutEffect(() => {
    const anchor = cadZoomAnchorRef.current;
    const canvas = cadCanvasRef.current;
    const host = canvas?.querySelector(".cad-viewer__svg-host") as HTMLElement | null;
    cadZoomAnchorRef.current = null;
    if (!anchor || !canvas || !host) return;
    const r = host.getBoundingClientRect();
    canvas.scrollLeft += r.left + anchor.ux * cadZoom - anchor.x;
    canvas.scrollTop += r.top + anchor.uy * cadZoom - anchor.y;
  }, [cadZoom, cadFitWidth]);

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
      AO: 0,
      DI: 0,
      DO: 0,
    };
    if (!session) return counts;
    for (const r of session.ioRecords) {
      const bucket = resolveIoBucket(r);
      if (bucket) counts[bucket] += 1;
    }
    return counts;
  }, [session]);

  const cad = session?.cadSheets.find((c) => c.filename === selectedCad);

  const ioIndex = useMemo(() => {
    if (!session) return new Map<string, IoNavHit>();
    return buildIoIndex(session.cadSheets, session.ioRecords);
  }, [session]);

  const cadSvgHtml = useMemo(() => {
    if (!cadSvgMarkup) return "";
    return cadSvgMarkup.replace(/<text\b([^>]*)>([^<]*)<\/text>/g, (whole, attrs: string, body: string) => {
      const label = body
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&");
      const hit = lookupIo(ioIndex, label);
      if (!hit || linksFromSheet(hit, selectedCad).length === 0) return whole;
      const marked = /\bclass="/.test(attrs)
        ? attrs.replace(/\bclass="/, 'class="cad-io-hot ')
        : `${attrs} class="cad-io-hot"`;
      return `<text${marked}>${body}</text>`;
    });
  }, [cadSvgMarkup, ioIndex, selectedCad]);

  useEffect(() => {
    if (!cadSvgHtml) return;
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
  }, [cadSvgHtml, selectedBlockId, selectedConnectionId]);

  const [cadSearch, setCadSearch] = useState("");
  const [cadSearchActive, setCadSearchActive] = useState(0);
  const [pdfMatchCount, setPdfMatchCount] = useState(0);
  const [svgMatchCount, setSvgMatchCount] = useState(0);
  const cadSearchRef = useRef<HTMLInputElement | null>(null);
  const cadMatchCount = cadView === "pdf" ? pdfMatchCount : svgMatchCount;
  const cadMatchIndex = cadMatchCount
    ? ((cadSearchActive % cadMatchCount) + cadMatchCount) % cadMatchCount
    : 0;
  const stepCadSearch = useCallback(
    (dir: 1 | -1) => {
      if (cadMatchCount) setCadSearchActive((i) => i + dir);
    },
    [cadMatchCount]
  );

  useEffect(() => {
    setCadSearchActive(0);
  }, [cadSearch, selectedCad, cadView]);

  useEffect(() => {
    const root = document.querySelector(".cad-viewer__svg-host svg");
    if (!root) {
      setSvgMatchCount(0);
      return;
    }
    const nodes = Array.from(root.querySelectorAll("text"));
    nodes.forEach((n) => n.classList.remove("cad-search-hit", "cad-search-current"));
    const q = cadView === "svg" ? cadSearch.trim().toLowerCase() : "";
    if (!q) {
      setSvgMatchCount(0);
      return;
    }
    const hits = nodes.filter((n) => (n.textContent ?? "").toLowerCase().includes(q));
    hits.forEach((n) => n.classList.add("cad-search-hit"));
    setSvgMatchCount(hits.length);
    if (!hits.length) return;
    const current = hits[((cadSearchActive % hits.length) + hits.length) % hits.length];
    current.classList.add("cad-search-current");
    if (cadCanvasRef.current) centerInScroller(current, cadCanvasRef.current);
  }, [cadSvgHtml, cadSearch, cadSearchActive, cadView]);

  useEffect(() => {
    if (tab !== "cad") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f" && cadSearchRef.current) {
        e.preventDefault();
        cadSearchRef.current.focus();
        cadSearchRef.current.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab]);

  const selectedBlockNumber = useMemo(() => {
    if (!cad?.engineeringModel || !selectedBlockId) return null;
    const block = cad.engineeringModel.blocks.find((b) => b.id === selectedBlockId);
    const n = Number(block?.blockNumber);
    return Number.isFinite(n) ? n : null;
  }, [cad, selectedBlockId]);

  useEffect(() => {
    if (sheetDetailTab !== "logic" || selectedBlockNumber == null || !sheetBlocks) return;
    document.getElementById(`fb-${selectedBlockNumber}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [sheetDetailTab, selectedBlockNumber, sheetBlocks]);

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

  const cadSheetByUpper = useMemo(
    () => new Map((session?.cadSheets ?? []).map((s) => [s.filename.toUpperCase(), s])),
    [session]
  );
  const cadSheetTitles = useMemo(
    () => new Map([...cadSheetByUpper].map(([k, s]) => [k, s.title ?? ""])),
    [cadSheetByUpper]
  );

  const openCadSheet = (file: string) => {
    setSelectedCad(cadSheetByUpper.get(file.toUpperCase())?.filename ?? file);
    setCadSummary(false);
    setTab("cad");
  };

  const sheetIo = useMemo(() => {
    if (!session || !selectedCad) return [];
    const key = selectedCad.toUpperCase();
    return session.ioRecords.filter((r) => {
      const cadFile = (r.cadFile || "").toUpperCase();
      if (cadFile === key) return true;
      return r.destinationCads.some((d) => d.toUpperCase().includes(key.replace(/\.CAD$/i, "")));
    });
  }, [session, selectedCad]);

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
      id: "loops",
      label: "Loop List",
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="6" cy="7" r="2.2" />
          <circle cx="18" cy="17" r="2.2" />
          <path d="M8.2 7H14a3 3 0 0 1 3 3v4.8" />
          <path d="M6 9.2V14a3 3 0 0 0 3 3h6.8" />
        </svg>
      ),
    },
    {
      id: "logic",
      label: "Logic",
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3" y="4" width="7" height="6" rx="1.2" />
          <rect x="14" y="14" width="7" height="6" rx="1.2" />
          <path d="M10 7h3a2 2 0 0 1 2 2v5" />
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
  ];

  return (
    <div className="workspace-shell">
      <header className="site-header">
        <div className="site-header__inner site-header__inner--wide site-header__inner--workspace">
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
          <nav className="workspace-nav" aria-label="Workspace">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`workspace-nav__item ${tab === t.id ? "workspace-nav__item--active" : ""}`}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
              >
                <span className="workspace-nav__icon" aria-hidden>
                  {t.icon}
                </span>
                <span className="workspace-nav__label">{t.label}</span>
              </button>
            ))}
          </nav>
          <div className="workspace-header__end">
            {tab === "cad" && (
              <a className="btn-pdf" href={apiUrl(`/api/projects/${id}/cad-pdf`)}>
                <svg className="btn-pdf__icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="currentColor" opacity=".15" d="M6 2.5h8.2L20 8.2V21a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" />
                  <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" d="M6 2.5h8.2L20 8.2V21a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" />
                  <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" d="M14 2.5V8h5.8" />
                  <text x="12" y="17.2" textAnchor="middle" fill="currentColor" fontSize="5.4" fontWeight="700" fontFamily="Arial, sans-serif">PDF</text>
                </svg>
                <span className="btn-pdf__divider" aria-hidden="true" />
                Export PDF
              </a>
            )}
          </div>
        </div>
      </header>

        <main className="workspace-main">
        {tab === "overview" && (
          <section className="space-y-5">
            <div>
              <p className="text-xs font-semibold tracking-[0.14em] text-[var(--accent)] uppercase">
                Review session
              </p>
              <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight">
                {session.meta.name}
              </h1>
              <p className="mt-1 text-sm text-[var(--muted)] break-all">
                {session.meta.sourceZipName} · session file summary and complete inventory by category.
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
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
              {(
                [
                  ["AI", "Analog Input", ioBucketCounts.AI],
                  ["AO", "Analog Output", ioBucketCounts.AO],
                  ["DI", "Digital Input", ioBucketCounts.DI],
                  ["DO", "Digital Output", ioBucketCounts.DO],
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
                  "AO",
                  "DI",
                  "DO",
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
              <a className="btn-excel" href={apiUrl(`/api/projects/${id}/artifacts/io-xlsx`)}>
                <svg className="btn-excel__icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="currentColor" opacity=".18" d="M8 3h9l4 4v13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
                  <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" d="M8 3h9l4 4v13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
                  <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" d="M17 3v4h4" />
                  <path fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" d="M14 11h4M14 14h4M14 17h4" />
                  <rect x="2.5" y="8" width="10" height="10" rx="1.5" fill="currentColor" />
                  <path fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" d="m5.5 10.5 4 5m0-5-4 5" />
                </svg>
                <span className="btn-excel__divider" aria-hidden="true" />
                Export IO List
              </a>
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
                                onClick={() => openCadSheet(group.cadFile)}
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
                        <td title={r.loopTagNote}>{r.loopTag}</td>
                        <td title={r.descriptionNote}>{r.description || "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            </div>
          </section>
        )}

        {tab === "loops" && (
          <section className="space-y-4">
            <LoopListView projectId={id} onOpenCad={openCadSheet} />
          </section>
        )}

        {tab === "logic" && (
          <LogicSection
            projectId={id}
            sheets={session.cadSheets}
            logicVersion={logicVersion}
            reprocessing={reprocessing}
            onReprocess={() => void reprocessSession()}
            onOpenCad={openCadSheet}
          />
        )}

        {tab === "cad" && (
          <section
            ref={cadViewerRef}
            className={`cad-viewer${resizingDetail ? " cad-viewer--resizing" : ""}`}
            style={
              detailWidth === null
                ? undefined
                : ({
                    "--cad-detail-width": `max(${DETAIL_MIN_WIDTH}px, min(${detailWidth}px, calc(100% - ${DETAIL_RESERVED_WIDTH}px)))`
                  } as CSSProperties)
            }
          >
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
                <button
                  type="button"
                  onClick={() => setCadSummary(true)}
                  className={`cad-viewer__sheet cad-viewer__sheet--summary ${
                    cadSummary ? "cad-viewer__sheet--active" : ""
                  }`}
                >
                  <span className="cad-viewer__sheet-name">Block Summary</span>
                  <span className="cad-viewer__sheet-title">Function blocks across all CAD files</span>
                </button>
                {filteredCadSheets.map((s) => (
                  <button
                    key={s.filename}
                    type="button"
                    onClick={() => openCadSheet(s.filename)}
                    className={`cad-viewer__sheet ${
                      !cadSummary && selectedCad === s.filename ? "cad-viewer__sheet--active" : ""
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

            {cadSummary ? (
              <div className="cad-viewer__summary">
                <div className="cad-viewer__pane-head">
                  <h3>Block Summary</h3>
                  <p>Function blocks summed across every CAD file, mapped to the Function Code Application Manual · click a row to see where it is used</p>
                </div>
                <BlockSummaryView
                  key={logicVersion}
                  projectId={id}
                  sheetTitles={cadSheetTitles}
                  onOpenCad={openCadSheet}
                />
              </div>
            ) : (
            <>
            <div className="cad-viewer__middle">
              <div className="cad-viewer__pane-head">
                <div className="min-w-0">
                  <h3>{cad?.filename || "Select a CAD sheet"}</h3>
                  <p>{cad?.title || "Original PDF, with an SVG view of the same sheet"}</p>
                </div>
                <div className="cad-viewer__stats">
                  <div className="cad-view-switch" role="group" aria-label="Drawing view">
                    <button
                      type="button"
                      className={cadView === "pdf" ? "is-active" : ""}
                      aria-pressed={cadView === "pdf"}
                      onClick={() => setCadView("pdf")}
                    >
                      Original PDF
                    </button>
                    <button
                      type="button"
                      className={cadView === "svg" ? "is-active" : ""}
                      aria-pressed={cadView === "svg"}
                      onClick={() => setCadView("svg")}
                    >
                      SVG
                    </button>
                  </div>
                  {cad && cadView === "svg" && (
                    <div className="cad-viewer__zoom" role="group" aria-label="CAD zoom">
                      <button
                        type="button"
                        className="tab-btn"
                        onClick={zoomCadOut}
                        title="Zoom out"
                        aria-label="Zoom out"
                      >
                        −
                      </button>
                      <button
                        type="button"
                        className="tab-btn cad-viewer__zoom-label"
                        onClick={zoomCadReset}
                        title="Reset to 100%"
                        aria-label="Reset zoom to 100 percent"
                      >
                        {cadFitWidth ? "Fit" : `${Math.round(cadZoom * 100)}%`}
                      </button>
                      <button
                        type="button"
                        className="tab-btn"
                        onClick={zoomCadIn}
                        title="Zoom in"
                        aria-label="Zoom in"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        onClick={zoomCadFit}
                        className={`tab-btn ${cadFitWidth ? "tab-btn--active" : ""}`}
                        title="Fit sheet to width"
                      >
                        Fit width
                      </button>
                    </div>
                  )}
                  {selectedCad && cadView === "pdf" && (
                    <div className="cad-viewer__zoom" role="group" aria-label="PDF zoom">
                      <button
                        type="button"
                        className="tab-btn"
                        onClick={() => zoomPdfBy(1 / CAD_ZOOM_STEP)}
                        title="Zoom out"
                        aria-label="Zoom out"
                      >
                        −
                      </button>
                      <button
                        type="button"
                        className="tab-btn cad-viewer__zoom-label"
                        onClick={() => setPdfZoom(1)}
                        title="Reset to 100%"
                        aria-label="Reset zoom to 100 percent"
                      >
                        {pdfZoom == null ? "Fit" : `${Math.round(pdfZoom * 100)}%`}
                      </button>
                      <button
                        type="button"
                        className="tab-btn"
                        onClick={() => zoomPdfBy(CAD_ZOOM_STEP)}
                        title="Zoom in"
                        aria-label="Zoom in"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        onClick={() => setPdfZoom(null)}
                        className={`tab-btn ${pdfZoom == null ? "tab-btn--active" : ""}`}
                        title="Fit sheet to width"
                      >
                        Fit width
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {cad && (
                <div className="cad-search" role="search">
                  <label className="cad-search__field">
                    <svg viewBox="0 0 20 20" aria-hidden className="cad-search__icon">
                      <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
                      <path d="M12.6 12.6 17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                    <input
                      ref={cadSearchRef}
                      type="search"
                      value={cadSearch}
                      onChange={(e) => setCadSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          stepCadSearch(e.shiftKey ? -1 : 1);
                        } else if (e.key === "Escape") {
                          setCadSearch("");
                        }
                      }}
                      placeholder={`Search ${cadView === "pdf" ? "the PDF" : "the SVG"}: tag, block, address…`}
                      aria-label="Search this sheet"
                    />
                  </label>
                  <div className="cad-search__tools">
                  <span className="cad-search__count" aria-live="polite">
                    {cadSearch.trim()
                      ? cadMatchCount
                        ? `${cadMatchIndex + 1} of ${cadMatchCount}`
                        : "No matches"
                      : ""}
                  </span>
                  <div className="cad-search__nav">
                    <button
                      type="button"
                      className="tab-btn"
                      onClick={() => stepCadSearch(-1)}
                      disabled={!cadMatchCount}
                      title="Previous match (Shift+Enter)"
                      aria-label="Previous match"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="tab-btn"
                      onClick={() => stepCadSearch(1)}
                      disabled={!cadMatchCount}
                      title="Next match (Enter)"
                      aria-label="Next match"
                    >
                      ↓
                    </button>
                  </div>
                  </div>
                </div>
              )}
              <div className={`cad-flip${cadView === "svg" ? " cad-flip--svg" : ""}`}>
                <div className="cad-flip__face cad-flip__face--pdf">
                  {selectedCad ? (
                    <CadPdfView
                      key={selectedCad}
                      src={apiUrl(`/api/projects/${id}/cad-pdf/${encodeURIComponent(selectedCad)}`)}
                      zoom={pdfZoom}
                      onZoom={setPdfZoom}
                      onFitScale={setPdfFitScale}
                      query={cadView === "pdf" ? cadSearch : ""}
                      activeMatch={cadSearchActive}
                      onMatches={setPdfMatchCount}
                    />
                  ) : (
                    <p className="cad-viewer__empty">Choose a sheet from the left panel</p>
                  )}
                </div>
                <div className="cad-flip__face cad-flip__face--svg">
              <div
                className="cad-viewer__canvas"
                ref={cadCanvasRef}
              >
                {cad && cadSvgMarkup ? (
                  <div
                    className="cad-viewer__zoom-stage"
                    style={
                      cadFitWidth
                        ? undefined
                        : {
                            width: cadSvgNatural.w * cadZoom,
                            height: cadSvgNatural.h * cadZoom,
                          }
                    }
                  >
                    <div
                      className={`cad-viewer__svg-host ${
                        cadFitWidth ? "cad-viewer__svg-host--fit" : ""
                      }`}
                      style={
                        cadFitWidth
                          ? undefined
                          : {
                              width: cadSvgNatural.w,
                              height: cadSvgNatural.h,
                              transform: `scale(${cadZoom})`,
                              transformOrigin: "0 0",
                            }
                      }
                      dangerouslySetInnerHTML={{ __html: cadSvgHtml }}
                      onClick={(e) => {
                        const el = e.target as Element;
                        const label =
                          el.closest("text")?.textContent?.trim() ||
                          nearestSvgText(el, e.clientX, e.clientY);
                        const hit = label ? lookupIo(ioIndex, label) : null;
                        const links = hit ? linksFromSheet(hit, selectedCad) : [];
                        if (hit && links.length) {
                          const pane = (e.currentTarget as HTMLElement).closest(".cad-viewer__middle");
                          const box = pane?.getBoundingClientRect();
                          setIoNav({
                            hit,
                            links,
                            top: box ? e.clientY - box.top + 8 : 48,
                            left: box ? Math.min(e.clientX - box.left + 8, box.width - 280) : 16,
                          });
                          return;
                        }
                        setIoNav(null);
                        const block = el.closest("[data-block-id]");
                        if (block) {
                          setSelectedBlockId(block.getAttribute("data-block-id"));
                          setSelectedConnectionId(null);
                          setSheetDetailTab("logic");
                          return;
                        }
                        const wire = el.closest("[data-connection-id]");
                        if (wire) {
                          setSelectedConnectionId(
                            wire.getAttribute("data-connection-id")
                          );
                          setSelectedBlockId(null);
                          return;
                        }
                        setSelectedBlockId(null);
                        setSelectedConnectionId(null);
                      }}
                    />
                  </div>
                ) : cad ? (
                  <p className="cad-viewer__empty">Loading reconstructed sheet…</p>
                ) : (
                  <p className="cad-viewer__empty">Choose a sheet from the left panel</p>
                )}
              </div>
              {ioNav && (
                <div className="cad-io-nav" style={{ top: ioNav.top, left: ioNav.left }}>
                  <div className="cad-io-nav__head">
                    <div>
                      <p className="cad-io-nav__type">
                        {ioNav.hit.ioType ?? "I/O"}
                        {ioNav.hit.channel ? ` · ch ${ioNav.hit.channel}` : ""}
                        {ioNav.hit.slave ? ` · slave ${ioNav.hit.slave}` : ""}
                      </p>
                      <p className="cad-io-nav__label">{ioNav.hit.deviceTag || ioNav.hit.label}</p>
                      {ioNav.hit.loopTag && <p className="cad-io-nav__loop">{ioNav.hit.loopTag}</p>}
                    </div>
                    <button type="button" className="cad-io-nav__close" onClick={() => setIoNav(null)} aria-label="Close">
                      ×
                    </button>
                  </div>
                  {ioNav.hit.description && <p className="cad-io-nav__desc">{ioNav.hit.description}</p>}
                  <p className="cad-io-nav__kicker">Related CAD sheets</p>
                  <div className="cad-io-nav__links">
                    {ioNav.links.map((link) => (
                      <button
                        key={`${link.file}-${link.reason}`}
                        type="button"
                        className="cad-io-nav__link"
                        onClick={() => setSelectedCad(link.file)}
                      >
                        <span>{link.file}</span>
                        <span>{link.title || link.reason}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
                </div>
              </div>
            </div>

            <aside className="cad-viewer__right">
              <div
                className="cad-viewer__resizer"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize sheet details"
                aria-valuenow={detailWidth ?? undefined}
                aria-valuemin={DETAIL_MIN_WIDTH}
                tabIndex={0}
                title="Drag to resize · double-click to reset"
                onPointerDown={startDetailResize}
                onDoubleClick={() => commitDetailWidth(null)}
                onKeyDown={onDetailResizeKey}
              />
              <div className="cad-viewer__pane-head">
                <h3>Sheet details</h3>
                <p>{cad?.title || cad?.filename || "I/O and logic for the selected sheet"}</p>
              </div>
              <div className="cad-viewer__tabs">
                <button
                  type="button"
                  className={sheetDetailTab === "io" ? "is-active" : ""}
                  onClick={() => setSheetDetailTab("io")}
                >
                  I/O list ({sheetIo.length})
                </button>
                <button
                  type="button"
                  className={sheetDetailTab === "logic" ? "is-active" : ""}
                  onClick={() => setSheetDetailTab("logic")}
                >
                  Logic ({sheetBlocks?.length ?? cad?.engineeringModel?.stats.blockCount ?? 0})
                </button>
              </div>
              <div className="cad-viewer__detail-body">
                {!cad && <p className="cad-viewer__empty">No sheet selected</p>}
                {cad && sheetDetailTab === "io" && (
                  sheetIo.length === 0 ? (
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
                            <th>Loop tag</th>
                            <th>Description</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sheetIo.map((r) => (
                            <tr key={r.id}>
                              <td>{r.ioType}</td>
                              <td>{r.channel || "—"}</td>
                              <td>{r.slave || "—"}</td>
                              <td>{r.deviceTag || "—"}</td>
                              <td title={r.loopTagNote}>{r.loopTag || "—"}</td>
                              <td title={r.descriptionNote}>{r.description || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                )}
                {cad && sheetDetailTab === "logic" && (
                  <div className="cad-viewer__sections">
                    {sheetBlocks === undefined && <p className="cad-viewer__muted">Loading function blocks…</p>}
                    {sheetBlocks === null && (
                      <div className="fb-missing">
                        <p className="cad-viewer__muted">
                          Function-block specifications have not been generated for this session yet.
                        </p>
                        <button
                          type="button"
                          className="btn btn-sm !ml-0"
                          disabled={reprocessing}
                          onClick={() => void reprocessSession()}
                        >
                          {reprocessing ? "Processing… (can take a few minutes)" : "Generate from CAD"}
                        </button>
                      </div>
                    )}
                    {sheetBlocks && sheetBlocks.length === 0 && (
                      <p className="cad-viewer__muted">No function blocks on this sheet</p>
                    )}
                    {sheetBlocks?.map((b) => (
                      <section
                        key={b.block}
                        id={`fb-${b.block}`}
                        className={`fb-card ${selectedBlockNumber === b.block ? "fb-card--selected" : ""}`}
                      >
                        <header className="fb-card__head">
                          <span className="fb-card__id">Block {b.block}</span>
                          <span className="fb-card__fc">
                            {b.functionCode != null ? `FC ${b.functionCode}` : "No FC"}
                          </span>
                        </header>
                        <p className="fb-card__name">
                          {b.name ?? "No manual description for this function code"}
                          {b.symbol && <span className="fb-card__symbol"> · {b.symbol}</span>}
                        </p>
                        {b.specs.length === 0 ? (
                          <p className="cad-viewer__muted">No specification values in the CAD</p>
                        ) : (
                          <table className="fb-card__table">
                            <thead>
                              <tr>
                                <th>Spec</th>
                                <th>Value</th>
                                <th>Description</th>
                              </tr>
                            </thead>
                            <tbody>
                              {b.specs.map((s) => (
                                <tr key={s.label}>
                                  <td className="fb-card__label">{s.label}</td>
                                  <td className="fb-card__value">{s.value ?? "—"}</td>
                                  <td>
                                    {s.description || "—"}
                                    {s.meaning && <span className="fb-card__meaning">= {s.meaning}</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </section>
                    ))}
                  </div>
                )}
              </div>
            </aside>
            </>
            )}
          </section>
        )}

        </main>
    </div>
  );
}

function nearestSvgText(el: Element, x: number, y: number): string | null {
  const svg = el.closest("svg");
  if (!svg) return null;
  let bestD = 36;
  let bestText: string | null = null;
  svg.querySelectorAll("text").forEach((node) => {
    const text = node.textContent?.trim();
    if (!text) return;
    const r = node.getBoundingClientRect();
    const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
    if (d < bestD) {
      bestD = d;
      bestText = text;
    }
  });
  return bestText;
}

function blockMatches(b: SheetLogicBlock, q: string) {
  const fc = /^fc\s*(\d+)$/.exec(q);
  if (fc) return b.functionCode === Number(fc[1]);
  return (
    String(b.block).includes(q) ||
    (b.functionCode != null && `fc ${b.functionCode}`.includes(q)) ||
    (b.name ?? "").toLowerCase().includes(q) ||
    (b.symbol ?? "").toLowerCase().includes(q) ||
    b.specs.some((s) => s.description.toLowerCase().includes(q))
  );
}

function LogicSection({
  projectId,
  sheets,
  logicVersion,
  reprocessing,
  onReprocess,
  onOpenCad,
}: {
  projectId: string;
  sheets: CadSheet[];
  logicVersion: number;
  reprocessing: boolean;
  onReprocess: () => void;
  onOpenCad: (file: string) => void;
}) {
  /** undefined while loading, null when the session has no specifications. */
  const [logic, setLogic] = useState<Record<string, SheetLogicBlock[]> | null | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLogic(undefined);
    void (async () => {
      const res = await fetch(apiUrl(`/api/projects/${projectId}/cad-logic`));
      if (cancelled) return;
      if (!res.ok) {
        setLogic(null);
        return;
      }
      const data = (await res.json()) as { sheets: Record<string, SheetLogicBlock[]> };
      if (!cancelled) setLogic(data.sheets);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, logicVersion]);

  const groups = useMemo(() => {
    if (!logic) return [];
    const q = query.trim().toLowerCase();
    return sheets
      .map((s) => {
        const blocks = logic[s.filename.toUpperCase()] ?? [];
        if (!q) return { sheet: s, blocks };
        const sheetHit =
          s.filename.toLowerCase().includes(q) || (s.title ?? "").toLowerCase().includes(q);
        return { sheet: s, blocks: sheetHit ? blocks : blocks.filter((b) => blockMatches(b, q)) };
      })
      .filter(
        (g) =>
          !q ||
          g.blocks.length > 0 ||
          g.sheet.filename.toLowerCase().includes(q) ||
          (g.sheet.title ?? "").toLowerCase().includes(q)
      );
  }, [logic, sheets, query]);

  const current =
    groups.find((g) => g.sheet.filename === selected) ??
    groups.find((g) => g.blocks.length > 0) ??
    groups[0];

  const totals = useMemo(() => {
    const all = logic ? Object.values(logic).flat() : [];
    return {
      sheets: logic ? Object.values(logic).filter((b) => b.length).length : 0,
      blocks: all.length,
      specs: all.reduce((n, b) => n + b.specs.length, 0),
      codes: new Set(all.map((b) => b.functionCode).filter((c) => c != null)).size,
    };
  }, [logic]);

  const blocks = current?.blocks ?? [];

  return (
    <section className="cad-viewer logic-viewer">
      <aside className="cad-viewer__left">
        <div className="cad-viewer__pane-head">
          <h3>CAD sheets</h3>
          <p>
            {logic
              ? `${totals.sheets} sheets · ${totals.blocks} blocks · ${totals.specs} S values`
              : `${sheets.length} sheets`}
          </p>
        </div>
        <div className="cad-viewer__search">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sheet, block, FC 30, description…"
          />
        </div>
        <div className="cad-viewer__list">
          {groups.map(({ sheet, blocks: sheetBlocks }) => (
            <button
              key={sheet.filename}
              type="button"
              onClick={() => setSelected(sheet.filename)}
              className={`cad-viewer__sheet logic-viewer__sheet ${
                current?.sheet.filename === sheet.filename ? "cad-viewer__sheet--active" : ""
              } ${logic && sheetBlocks.length === 0 ? "logic-viewer__sheet--empty" : ""}`}
            >
              <span className="logic-viewer__sheet-row">
                <span className="cad-viewer__sheet-name">{sheet.filename}</span>
                {logic && <span className="logic-viewer__count">{sheetBlocks.length}</span>}
              </span>
              {sheet.title && <span className="cad-viewer__sheet-title">{sheet.title}</span>}
            </button>
          ))}
          {groups.length === 0 && (
            <p className="cad-viewer__empty">No sheets match “{query}”.</p>
          )}
        </div>
      </aside>

      <div className="logic-viewer__main">
        <div className="cad-viewer__pane-head logic-viewer__head">
          <div className="min-w-0">
            <h3>{current?.sheet.filename ?? "Logic"}</h3>
            <p>{current?.sheet.title ?? "Function blocks and S values from the CAD"}</p>
          </div>
          <div className="logic-viewer__actions">
            {logic && current && (
              <button
                type="button"
                className="btn-cad-open"
                onClick={() => onOpenCad(current.sheet.filename)}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Open in CAD viewer
              </button>
            )}
            {logic && (
              <a className="btn-pdf" href={apiUrl(`/api/projects/${projectId}/logic-report`)}>
                <svg className="btn-pdf__icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="currentColor" opacity=".15" d="M6 2.5h8.2L20 8.2V21a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" />
                  <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" d="M6 2.5h8.2L20 8.2V21a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" />
                  <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" d="M14 2.5V8h5.8" />
                  <text x="12" y="17.2" textAnchor="middle" fill="currentColor" fontSize="5.4" fontWeight="700" fontFamily="Arial, sans-serif">PDF</text>
                </svg>
                <span className="btn-pdf__divider" aria-hidden="true" />
                Generate Report
              </a>
            )}
          </div>
        </div>

        <div key={current?.sheet.filename} className="logic-viewer__body">
          {logic === undefined && <p className="cad-viewer__empty">Loading logic…</p>}
          {logic === null && (
            <div className="flex flex-col items-start gap-3 p-5">
              <p className="text-sm text-[var(--muted)]">
                Function-block specifications have not been generated for this session yet.
              </p>
              <button type="button" className="btn btn-sm !ml-0" disabled={reprocessing} onClick={onReprocess}>
                {reprocessing ? "Processing… (can take a few minutes)" : "Generate from CAD"}
              </button>
            </div>
          )}
          {logic && !current && <p className="cad-viewer__empty">Choose a sheet from the left panel</p>}
          {logic && current && blocks.length === 0 && (
            <p className="cad-viewer__empty">No function blocks on this sheet</p>
          )}

          {logic && current && blocks.length > 0 && (
            <table className="logic-table">
              <colgroup>
                <col style={{ width: "7%" }} />
                <col style={{ width: "6%" }} />
                <col style={{ width: "19%" }} />
                <col style={{ width: "6%" }} />
                <col style={{ width: "11%" }} />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th>Block</th>
                  <th>FC</th>
                  <th>Block description</th>
                  <th>Spec</th>
                  <th>Value</th>
                  <th>Description</th>
                </tr>
              </thead>
              {blocks.map((b) => {
                const rows = b.specs.length || 1;
                const head = (
                  <>
                    <td rowSpan={rows} className="logic-table__block">{b.block}</td>
                    <td rowSpan={rows} className="logic-table__merge">
                      {b.functionCode ?? "—"}
                    </td>
                    <td rowSpan={rows} className="logic-table__merge">
                      {b.name ?? "No manual description"}
                      {b.symbol && <span className="logic-table__symbol">{b.symbol}</span>}
                    </td>
                  </>
                );
                return (
                  <tbody key={b.block} className="logic-table__group">
                    {b.specs.length === 0 ? (
                      <tr>
                        {head}
                        <td colSpan={3} className="text-[var(--muted)]">
                          No specification values in the CAD
                        </td>
                      </tr>
                    ) : (
                      b.specs.map((s, i) => (
                        <tr key={s.label}>
                          {i === 0 && head}
                          <td className="logic-table__label">{s.label}</td>
                          <td
                            className="logic-table__value"
                            title={[
                              s.type && `Type ${s.type}`,
                              s.default && `Default ${s.default}`,
                              s.range && `Range ${s.range}`,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          >
                            {s.value ?? "—"}
                          </td>
                          <td>
                            {s.description || "—"}
                            {s.meaning && <span className="logic-table__meaning">= {s.meaning}</span>}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                );
              })}
            </table>
          )}
        </div>
      </div>
    </section>
  );
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type IoBucket = "AI" | "AO" | "DI" | "DO";

type IoBucketFilter = "ALL" | IoBucket;

function resolveIoBucket(r: IoRecord): IoBucket | null {
  const sources = [r.rawIoTag, r.deviceTag, r.loopTag, r.ioType]
    .filter(Boolean)
    .map((s) => String(s).toUpperCase());

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
