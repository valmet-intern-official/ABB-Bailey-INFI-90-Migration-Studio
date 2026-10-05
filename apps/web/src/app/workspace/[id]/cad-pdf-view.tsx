"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

export const PDF_ZOOM_MIN = 0.25;
export const PDF_ZOOM_MAX = 6;

type Matrix = [number, number, number, number, number, number];

interface PdfText {
  str: string;
  transform: Matrix;
  width: number;
}

function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

/** Scrolls `scroller` so that `el` sits in its middle. */
export function centerInScroller(el: Element, scroller: HTMLElement) {
  const r = el.getBoundingClientRect();
  const s = scroller.getBoundingClientRect();
  scroller.scrollBy({
    left: r.left + r.width / 2 - (s.left + s.width / 2),
    top: r.top + r.height / 2 - (s.top + s.height / 2),
    behavior: "smooth",
  });
}

/**
 * Paints the sheet PDF exactly as stored. Zoom only changes the viewer scale:
 * `zoom` is PDF points to CSS pixels (1 = 100 %), null fits the page width.
 * Search matches are drawn as an overlay; the page itself is never altered.
 */
export function CadPdfView({
  src,
  zoom,
  onZoom,
  onFitScale,
  query = "",
  activeMatch = 0,
  onMatches,
}: {
  src: string;
  zoom: number | null;
  onZoom: (zoom: number | null) => void;
  onFitScale: (scale: number) => void;
  query?: string;
  activeMatch?: number;
  onMatches?: (count: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("Loading sheet…");
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [texts, setTexts] = useState<PdfText[]>([]);
  const [width, setWidth] = useState(0);
  const [scale, setScale] = useState(0);
  const zoomRef = useRef(zoom);
  const fitRef = useRef(1);
  zoomRef.current = zoom;
  const onZoomRef = useRef(onZoom);
  onZoomRef.current = onZoom;
  const onFitRef = useRef(onFitScale);
  onFitRef.current = onFitScale;
  const onMatchesRef = useRef(onMatches);
  onMatchesRef.current = onMatches;

  useEffect(() => {
    let dead = false;
    let doc: PDFDocumentProxy | null = null;
    setStatus("Loading sheet…");
    setPage(null);
    setTexts([]);
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs?v=6.3.289";
        const data = new Uint8Array(await (await fetch(src)).arrayBuffer());
        if (dead) return;
        doc = await pdfjs.getDocument({ data }).promise;
        const first = await doc.getPage(1);
        if (dead) return;
        setPage(first);
        const content = await first.getTextContent();
        if (dead) return;
        const out: PdfText[] = [];
        for (const item of content.items) {
          if (!("str" in item) || !item.str.trim()) continue;
          out.push({ str: item.str, transform: item.transform as Matrix, width: item.width });
        }
        setTexts(out);
      } catch (err) {
        if (!dead) setStatus(err instanceof Error ? err.message : "Could not open the PDF");
      }
    })();
    return () => {
      dead = true;
      void doc?.cleanup();
    };
  }, [src]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(() => setWidth(wrap.clientWidth));
    observer.observe(wrap);
    setWidth(wrap.clientWidth);
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const current = zoomRef.current ?? fitRef.current;
      const pixels = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      const delta = Math.max(-120, Math.min(120, pixels));
      const next = current * Math.exp(-delta * 0.0018);
      onZoomRef.current(Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, next)));
    };
    wrap.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      wrap.removeEventListener("wheel", onWheel);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!page || !canvas || width <= 0) return;
    const base = page.getViewport({ scale: 1 });
    const fit = Math.max(0.05, (width - 24) / base.width);
    fitRef.current = fit;
    onFitRef.current(fit);
    const next = zoom ?? fit;
    setScale(next);
    const ratio = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: next * ratio });
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    canvas.style.width = `${Math.round(base.width * next)}px`;
    canvas.style.height = `${Math.round(base.height * next)}px`;
    const task = page.render({ canvasContext: ctx, canvas, viewport });
    task.promise.then(
      () => setStatus(""),
      (err: unknown) => {
        if ((err as { name?: string })?.name !== "RenderingCancelledException") {
          setStatus(err instanceof Error ? err.message : "Could not draw the PDF");
        }
      }
    );
    return () => task.cancel();
  }, [page, zoom, width]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return texts.filter((t) => t.str.toLowerCase().includes(q));
  }, [texts, query]);

  useEffect(() => {
    onMatchesRef.current?.(matches.length);
  }, [matches.length]);

  const boxes = useMemo(() => {
    if (!page || scale <= 0) return [];
    const vt = page.getViewport({ scale }).transform as Matrix;
    return matches.map((t) => {
      const m = multiply(vt, t.transform);
      const height = Math.max(4, Math.hypot(m[2], m[3]));
      return {
        left: m[4],
        top: m[5] - height,
        width: Math.max(4, t.width * scale),
        height,
        angle: Math.atan2(m[1], m[0]),
      };
    });
  }, [matches, page, scale]);

  const current = boxes.length ? ((activeMatch % boxes.length) + boxes.length) % boxes.length : -1;

  useEffect(() => {
    const wrap = wrapRef.current;
    if (wrap && activeRef.current) centerInScroller(activeRef.current, wrap);
  }, [current, matches]);

  return (
    <div ref={wrapRef} className="cad-pdf__view">
      {status ? <p className="cad-viewer__empty">{status}</p> : null}
      <div className="cad-pdf__page">
        <canvas ref={canvasRef} />
        {boxes.length > 0 && (
          <div className="cad-pdf__hits" aria-hidden>
            {boxes.map((b, i) => (
              <div
                key={i}
                ref={i === current ? activeRef : undefined}
                className={`cad-pdf__hit${i === current ? " cad-pdf__hit--current" : ""}`}
                style={{
                  left: b.left,
                  top: b.top,
                  width: b.width,
                  height: b.height,
                  transform: b.angle ? `rotate(${b.angle}rad)` : undefined,
                  transformOrigin: `0 ${b.height}px`,
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
