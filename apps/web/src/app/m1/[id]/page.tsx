"use client";

import Image from "next/image";
import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiUrl } from "@/lib/api-base";
import { peekResult, resultKey } from "@/lib/result-cache";

type M1File = { name: string; sourceFile: string };
type M1Failure = { file: string; error: string };
type Category = { id: string; name: string; files: string[] };
type Variant = "original" | "marking";

const UNCATEGORIZED_ID = "__uncategorized__";
const ZOOM_STEP = 1.25;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 8;

type Editor = { id: string | null; name: string; files: Set<string>; filter: string };

function svgSize(text: string): { w: number; h: number } {
  const head = text.slice(0, 600);
  const w = Number(/\swidth="([\d.]+)/.exec(head)?.[1]);
  const h = Number(/\sheight="([\d.]+)/.exec(head)?.[1]);
  if (w > 0 && h > 0) return { w, h };
  const vb = /viewBox="[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)"/.exec(head);
  return vb ? { w: Number(vb[1]), h: Number(vb[2]) } : { w: 1200, h: 800 };
}

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function PdfIcon() {
  return (
    <svg className="btn-pdf__icon" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" opacity=".15" d="M6 2.5h8.2L20 8.2V21a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" />
      <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" d="M6 2.5h8.2L20 8.2V21a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" />
      <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" d="M14 2.5V8h5.8" />
      <text x="12" y="17.2" textAnchor="middle" fill="currentColor" fontSize="5.4" fontWeight="700" fontFamily="Arial, sans-serif">
        PDF
      </text>
    </svg>
  );
}

async function readError(r: Response) {
  try {
    const j = await r.json();
    return j.error || `HTTP ${r.status}`;
  } catch {
    return `HTTP ${r.status}`;
  }
}

export default function M1PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [preloaded] = useState(() => {
    const index = peekResult<{ index: { files: M1File[]; failures?: M1Failure[] } }>(resultKey.m1Index(id));
    const cats = peekResult<{ categories: Category[] }>(resultKey.m1Categories(id));
    if (!index || !cats) return null;
    const first = index.index.files[0]?.name ?? null;
    const url = first ? apiUrl(`/api/m1/${id}/asset/${encodeURIComponent(first)}/graphics/original.svg`) : null;
    const text = url ? peekResult<string>(resultKey.m1Svg(url)) : undefined;
    return { index: index.index, categories: cats.categories, first, svg: url && text ? { url, text } : null };
  });
  const [files, setFiles] = useState<M1File[] | null>(preloaded?.index.files ?? null);
  const [failures, setFailures] = useState<M1Failure[]>(preloaded?.index.failures ?? []);
  const [categories, setCategories] = useState<Category[]>(preloaded?.categories ?? []);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [file, setFile] = useState<string | null>(preloaded?.first ?? null);
  const [variant, setVariant] = useState<Variant>("original");
  const [zoom, setZoom] = useState<number | null>(null);
  const [svg, setSvg] = useState<{ url: string; text: string } | null>(preloaded?.svg ?? null);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editor, setEditor] = useState<Editor | null>(null);
  const [exportSel, setExportSel] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState<"save" | "export" | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([
      fetch(apiUrl(`/api/m1/${id}`)).then(async (r) => {
        if (!r.ok) throw new Error(await readError(r));
        return (await r.json()) as { index: { files: M1File[]; failures?: M1Failure[] } };
      }),
      fetch(apiUrl(`/api/m1/${id}/categories`)).then(async (r) => {
        if (!r.ok) throw new Error(await readError(r));
        return (await r.json()) as { categories: Category[] };
      }),
    ])
      .then(([s, c]) => {
        setFiles(s.index.files);
        setFailures(s.index.failures ?? []);
        setCategories(c.categories);
        setFile((current) => current ?? s.index.files[0]?.name ?? null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  const svgUrl = file
    ? apiUrl(`/api/m1/${id}/asset/${encodeURIComponent(file)}/graphics/${variant === "marking" ? "with-marking-tag" : "original"}.svg`)
    : null;

  useEffect(() => {
    if (!svgUrl) return;
    const cached = peekResult<string>(resultKey.m1Svg(svgUrl));
    if (cached) {
      setSvg({ url: svgUrl, text: cached });
      return;
    }
    let alive = true;
    fetch(svgUrl)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((text) => alive && setSvg({ url: svgUrl, text }))
      .catch((e) => alive && setNotice(`Could not load graphic: ${e instanceof Error ? e.message : e}`));
    return () => {
      alive = false;
    };
  }, [svgUrl]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const natural = useMemo(() => (svg ? svgSize(svg.text) : { w: 0, h: 0 }), [svg]);
  const byName = useMemo(() => new Map((files ?? []).map((f) => [f.name, f])), [files]);
  const assigned = useMemo(() => new Set(categories.flatMap((c) => c.files)), [categories]);
  const uncategorized = useMemo(() => (files ?? []).filter((f) => !assigned.has(f.name)), [files, assigned]);

  const matches = useCallback(
    (f: M1File) => {
      const q = query.trim().toLowerCase();
      return !q || f.sourceFile.toLowerCase().includes(q) || f.name.toLowerCase().includes(q);
    },
    [query]
  );

  /** Navigation order follows the sidebar so ←/→ walk what the user sees. */
  const navOrder = useMemo(() => {
    if (!files) return [];
    const seq = categories.length
      ? [...categories.flatMap((c) => c.files), ...uncategorized.map((f) => f.name)]
      : files.map((f) => f.name);
    return [...new Set(seq)].filter((n) => matches(byName.get(n)!));
  }, [files, categories, uncategorized, matches, byName]);

  const step = useCallback(
    (dir: 1 | -1) => {
      if (!navOrder.length) return;
      const i = file ? navOrder.indexOf(file) : -1;
      setFile(navOrder[(i + dir + navOrder.length) % navOrder.length]);
    },
    [navOrder, file]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editor || exportSel) return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        step(1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        step(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, editor, exportSel]);

  const fitScale = useCallback(() => {
    const el = canvasRef.current;
    if (!el || !natural.w) return 1;
    return Math.max(ZOOM_MIN, (el.clientWidth - 32) / natural.w);
  }, [natural.w]);

  const zoomBy = useCallback(
    (k: number) => setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (z ?? fitScale()) * k))),
    [fitScale]
  );

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  async function persist(next: Category[]) {
    setBusy("save");
    try {
      const r = await fetch(apiUrl(`/api/m1/${id}/categories`), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ categories: next }),
      });
      if (!r.ok) throw new Error(await readError(r));
      const j = (await r.json()) as { categories: Category[] };
      setCategories(j.categories);
      return true;
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function saveEditor() {
    if (!editor) return;
    const name = editor.name.trim();
    if (!name) return setNotice("Category name is required");
    const filesArr = [...editor.files];
    const next = editor.id
      ? categories.map((c) => (c.id === editor.id ? { ...c, name, files: filesArr } : c))
      : [...categories, { id: newId(), name, files: filesArr }];
    if (await persist(next)) setEditor(null);
  }

  async function deleteCategory(cat: Category) {
    if (!window.confirm(`Delete category "${cat.name}"? The graphics stay in the session.`)) return;
    if (await persist(categories.filter((c) => c.id !== cat.id))) setEditor(null);
  }

  async function runExport(selection?: string[]) {
    setBusy("export");
    try {
      const r = await fetch(apiUrl(`/api/m1/${id}/export`), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ categories: selection, variant }),
      });
      if (!r.ok) throw new Error(await readError(r));
      const blob = await r.blob();
      const disp = r.headers.get("content-disposition") ?? "";
      const fallback = `M1-graphics-${id}.${blob.type.includes("zip") ? "zip" : "pdf"}`;
      const filename = /filename="([^"]+)"/.exec(disp)?.[1] ?? fallback;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setExportSel(null);
    } catch (e) {
      setNotice(`Export failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(null);
    }
  }

  function onExportClick() {
    if (!categories.length) return void runExport();
    const sel = new Set(categories.filter((c) => c.files.length).map((c) => c.id));
    if (uncategorized.length) sel.add(UNCATEGORIZED_ID);
    setExportSel(sel);
  }

  function toggleGroup(key: string) {
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  if (error) return <p className="p-5 text-sm text-red-700">{error}</p>;
  if (!files) return <p className="p-5 text-sm text-[var(--muted)]">Loading…</p>;

  const current = file ? byName.get(file) : undefined;
  const currentCats = file ? categories.filter((c) => c.files.includes(file)) : [];
  const position = file ? navOrder.indexOf(file) : -1;

  const fileButton = (f: M1File, groupKey: string) => (
    <button
      key={`${groupKey}:${f.name}`}
      type="button"
      onClick={() => setFile(f.name)}
      className={`cad-viewer__sheet ${file === f.name ? "cad-viewer__sheet--active" : ""}`}
      title={f.sourceFile}
    >
      <span className="cad-viewer__sheet-name">{f.sourceFile}</span>
      {f.sourceFile.replace(/\.m1$/i, "") !== f.name && <span className="cad-viewer__sheet-title">{f.name}</span>}
    </button>
  );

  const group = (key: string, title: string, members: M1File[], cat?: Category) => {
    const shown = members.filter(matches);
    const open = !collapsed.has(key);
    return (
      <div key={key} className="m1-group">
        <div className="m1-group__head">
          <button type="button" className="m1-group__toggle" onClick={() => toggleGroup(key)} aria-expanded={open}>
            <span className={`m1-group__chevron${open ? " is-open" : ""}`} aria-hidden>
              ▸
            </span>
            <span className="m1-group__name">{title}</span>
            <span className="m1-group__count">{members.length}</span>
          </button>
          {cat && (
            <button
              type="button"
              className="m1-group__edit"
              onClick={() => setEditor({ id: cat.id, name: cat.name, files: new Set(cat.files), filter: "" })}
              title={`Edit "${cat.name}"`}
              aria-label={`Edit category ${cat.name}`}
            >
              Edit
            </button>
          )}
        </div>
        {open &&
          (shown.length ? (
            shown.map((f) => fileButton(f, key))
          ) : (
            <p className="m1-group__empty">{members.length ? "No matches" : "No graphics yet. Use Edit to add some."}</p>
          ))}
      </div>
    );
  };

  const editorFiles = editor
    ? files.filter((f) => {
        const q = editor.filter.trim().toLowerCase();
        return !q || f.sourceFile.toLowerCase().includes(q) || f.name.toLowerCase().includes(q);
      })
    : [];

  const exportOptions = [
    ...categories.map((c) => ({ id: c.id, name: c.name, count: c.files.length })),
    ...(uncategorized.length ? [{ id: UNCATEGORIZED_ID, name: "Uncategorized", count: uncategorized.length }] : []),
  ];

  return (
    <div className="workspace-shell">
      <header className="site-header">
        <div className="site-header__inner site-header__inner--wide site-header__inner--workspace">
          <Link href="/" className="brand">
            <Image src="/valmet-logo.webp" alt="Valmet" width={140} height={40} className="brand__logo" priority />
            <span className="brand__divider" aria-hidden>
              |
            </span>
            <span className="brand__product">ABB Bailey INFI 90 Migration Studio</span>
          </Link>
          <div />
          <div className="workspace-header__end">
            <button type="button" className="btn-pdf" onClick={onExportClick} disabled={busy === "export" || !files.length}>
              <PdfIcon />
              <span className="btn-pdf__divider" aria-hidden="true" />
              {busy === "export" && !exportSel ? "Exporting…" : "Export Graphics"}
            </button>
          </div>
        </div>
      </header>

      <main className="workspace-main">
        <section className="cad-viewer cad-viewer--m1">
          <aside className="cad-viewer__left">
            <div className="cad-viewer__pane-head">
              <h3>M1 graphics</h3>
              <p>
                {files.length} graphic{files.length === 1 ? "" : "s"}
                {categories.length ? ` · ${categories.length} categor${categories.length === 1 ? "y" : "ies"}` : ""}
                {failures.length > 0 && (
                  <span className="text-red-700" title={failures.map((f) => `${f.file}: ${f.error}`).join("\n")}>
                    {` · ${failures.length} skipped (could not be decoded)`}
                  </span>
                )}
              </p>
            </div>
            <div className="cad-viewer__search">
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search graphics…" />
            </div>
            <div className="m1-cats__bar">
              <span>Categories</span>
              <button
                type="button"
                className="m1-cats__new"
                onClick={() => setEditor({ id: null, name: "", files: new Set(), filter: "" })}
              >
                + New category
              </button>
            </div>
            <div className="cad-viewer__list">
              {categories.length ? (
                <>
                  {categories.map((c) =>
                    group(
                      c.id,
                      c.name,
                      c.files.map((n) => byName.get(n)!).filter(Boolean),
                      c
                    )
                  )}
                  {uncategorized.length > 0 && group(UNCATEGORIZED_ID, "Uncategorized", uncategorized)}
                </>
              ) : (
                <>
                  <p className="m1-cats__hint">
                    Categories are optional. Create one to group graphics by area; each category exports as its own PDF.
                  </p>
                  {files.filter(matches).map((f) => fileButton(f, "all"))}
                </>
              )}
            </div>
          </aside>

          <div className="cad-viewer__middle">
            <div className="cad-viewer__pane-head">
              <div className="min-w-0">
                <h3 className="truncate">{current?.sourceFile || "Select a graphic"}</h3>
                <p>
                  {current
                    ? `${position >= 0 ? `${position + 1} of ${navOrder.length} · ` : ""}${
                        currentCats.length ? currentCats.map((c) => c.name).join(", ") : categories.length ? "Uncategorized" : "Decoded M1 graphic"
                      }`
                    : "Choose a graphic from the left panel"}
                </p>
              </div>
              <div className="cad-viewer__stats">
                <div className="cad-view-switch" role="group" aria-label="Graphic view">
                  <button type="button" className={variant === "original" ? "is-active" : ""} aria-pressed={variant === "original"} onClick={() => setVariant("original")}>
                    Original
                  </button>
                  <button type="button" className={variant === "marking" ? "is-active" : ""} aria-pressed={variant === "marking"} onClick={() => setVariant("marking")}>
                    With marking tags
                  </button>
                </div>
                <div className="cad-viewer__zoom" role="group" aria-label="Graphic navigation">
                  <button type="button" className="tab-btn" onClick={() => step(-1)} title="Previous graphic (←)" aria-label="Previous graphic">
                    ‹
                  </button>
                  <button type="button" className="tab-btn" onClick={() => step(1)} title="Next graphic (→)" aria-label="Next graphic">
                    ›
                  </button>
                </div>
                <div className="cad-viewer__zoom" role="group" aria-label="Zoom">
                  <button type="button" className="tab-btn" onClick={() => zoomBy(1 / ZOOM_STEP)} title="Zoom out" aria-label="Zoom out">
                    −
                  </button>
                  <button type="button" className="tab-btn cad-viewer__zoom-label" onClick={() => setZoom(1)} title="Reset to 100%" aria-label="Reset zoom to 100 percent">
                    {zoom == null ? "Fit" : `${Math.round(zoom * 100)}%`}
                  </button>
                  <button type="button" className="tab-btn" onClick={() => zoomBy(ZOOM_STEP)} title="Zoom in" aria-label="Zoom in">
                    +
                  </button>
                  <button type="button" className={`tab-btn ${zoom == null ? "tab-btn--active" : ""}`} onClick={() => setZoom(null)} title="Fit graphic to width">
                    Fit width
                  </button>
                </div>
              </div>
            </div>
            <div className="cad-viewer__canvas" ref={canvasRef}>
              {svg && svg.url === svgUrl ? (
                <div
                  className="cad-viewer__zoom-stage"
                  style={zoom == null ? undefined : { width: natural.w * zoom, height: natural.h * zoom }}
                >
                  <div
                    className={`cad-viewer__svg-host m1-svg-host ${zoom == null ? "cad-viewer__svg-host--fit" : ""}`}
                    style={
                      zoom == null
                        ? undefined
                        : { width: natural.w, height: natural.h, transform: `scale(${zoom})`, transformOrigin: "0 0" }
                    }
                    dangerouslySetInnerHTML={{ __html: svg.text }}
                  />
                </div>
              ) : file ? (
                <p className="cad-viewer__empty">Loading graphic…</p>
              ) : (
                <p className="cad-viewer__empty">Choose a graphic from the left panel</p>
              )}
            </div>
          </div>
        </section>
      </main>

      {notice && (
        <div className="m1-toast" role="status" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}

      {editor && (
        <div className="m1-dialog__backdrop" onMouseDown={(e) => e.target === e.currentTarget && setEditor(null)}>
          <div className="m1-dialog" role="dialog" aria-modal="true" aria-labelledby="m1-cat-title">
            <div className="m1-dialog__head">
              <h2 id="m1-cat-title">{editor.id ? "Edit category" : "New category"}</h2>
              <button type="button" className="m1-dialog__close" onClick={() => setEditor(null)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="m1-dialog__body">
              <label className="m1-field">
                <span>Category name</span>
                <input
                  autoFocus
                  value={editor.name}
                  maxLength={80}
                  onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && void saveEditor()}
                  placeholder="e.g. Boiler feed water"
                />
              </label>
              <div className="m1-pick__bar">
                <span>
                  Graphics <strong>{editor.files.size}</strong> / {files.length} selected
                </span>
                <div className="m1-pick__actions">
                  <button type="button" onClick={() => setEditor({ ...editor, files: new Set([...editor.files, ...editorFiles.map((f) => f.name)]) })}>
                    Select shown
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditor({ ...editor, files: new Set(uncategorized.map((f) => f.name).concat([...editor.files])) })}
                    disabled={!uncategorized.length}
                  >
                    Add uncategorized
                  </button>
                  <button type="button" onClick={() => setEditor({ ...editor, files: new Set() })}>
                    Clear
                  </button>
                </div>
              </div>
              <input
                className="m1-pick__filter"
                value={editor.filter}
                onChange={(e) => setEditor({ ...editor, filter: e.target.value })}
                placeholder="Filter graphics…"
              />
              <div className="m1-pick__list">
                {editorFiles.map((f) => {
                  const others = categories.filter((c) => c.id !== editor.id && c.files.includes(f.name));
                  return (
                    <label key={f.name} className="m1-pick__item">
                      <input
                        type="checkbox"
                        checked={editor.files.has(f.name)}
                        onChange={(e) => {
                          const n = new Set(editor.files);
                          if (e.target.checked) n.add(f.name);
                          else n.delete(f.name);
                          setEditor({ ...editor, files: n });
                        }}
                      />
                      <span className="m1-pick__name">{f.sourceFile}</span>
                      {others.length > 0 && <span className="m1-pick__tag">{others.map((c) => c.name).join(", ")}</span>}
                    </label>
                  );
                })}
                {!editorFiles.length && <p className="m1-group__empty">No graphics match the filter.</p>}
              </div>
            </div>
            <div className="m1-dialog__foot">
              {editor.id && (
                <button
                  type="button"
                  className="m1-btn-danger"
                  onClick={() => {
                    const cat = categories.find((c) => c.id === editor.id);
                    if (cat) void deleteCategory(cat);
                  }}
                  disabled={busy === "save"}
                >
                  Delete category
                </button>
              )}
              <span className="flex-1" />
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditor(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-sm" onClick={() => void saveEditor()} disabled={busy === "save" || !editor.name.trim()}>
                {busy === "save" ? "Saving…" : editor.id ? "Save changes" : "Create category"}
              </button>
            </div>
          </div>
        </div>
      )}

      {exportSel && (
        <div className="m1-dialog__backdrop" onMouseDown={(e) => e.target === e.currentTarget && busy !== "export" && setExportSel(null)}>
          <div className="m1-dialog m1-dialog--narrow" role="dialog" aria-modal="true" aria-labelledby="m1-export-title">
            <div className="m1-dialog__head">
              <h2 id="m1-export-title">Export graphics</h2>
              <button type="button" className="m1-dialog__close" onClick={() => setExportSel(null)} aria-label="Close" disabled={busy === "export"}>
                ×
              </button>
            </div>
            <div className="m1-dialog__body">
              <p className="m1-dialog__lead">
                Choose the categories to export. Each category becomes its own PDF, and the PDFs are downloaded together in one ZIP. Every graphic is two pages: the original, then the same graphic with marking tags.
              </p>
              <div className="m1-pick__bar">
                <span>
                  <strong>{exportSel.size}</strong> of {exportOptions.length} selected
                </span>
                <div className="m1-pick__actions">
                  <button type="button" onClick={() => setExportSel(new Set(exportOptions.filter((o) => o.count).map((o) => o.id)))}>
                    Select all
                  </button>
                  <button type="button" onClick={() => setExportSel(new Set())}>
                    Clear
                  </button>
                </div>
              </div>
              <div className="m1-pick__list">
                {exportOptions.map((o) => (
                  <label key={o.id} className={`m1-pick__item${o.count ? "" : " is-disabled"}`}>
                    <input
                      type="checkbox"
                      disabled={!o.count}
                      checked={exportSel.has(o.id)}
                      onChange={(e) => {
                        const n = new Set(exportSel);
                        if (e.target.checked) n.add(o.id);
                        else n.delete(o.id);
                        setExportSel(n);
                      }}
                    />
                    <span className="m1-pick__name">{o.name}</span>
                    <span className="m1-pick__tag">{o.count ? `${o.count * 2} pages` : "empty"}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="m1-dialog__foot">
              <span className="flex-1" />
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setExportSel(null)} disabled={busy === "export"}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-pdf"
                onClick={() => void runExport(exportOptions.filter((o) => exportSel.has(o.id)).map((o) => o.id))}
                disabled={busy === "export" || !exportSel.size}
              >
                <PdfIcon />
                <span className="btn-pdf__divider" aria-hidden="true" />
                {busy === "export" ? "Exporting…" : `Export ${exportSel.size} PDF${exportSel.size === 1 ? "" : "s"} (ZIP)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
