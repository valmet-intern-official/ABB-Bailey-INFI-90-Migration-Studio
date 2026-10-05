"use client";

import { useCallback, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { setPendingJob } from "@/lib/pending-job";
import { BusyDots, DecodeAnimation } from "./DecodeAnimation";

const PROCESSING_ROUTE = "/studio/processing";

export function StudioUpload() {
  return (
    <div className="lp-tools">
      <CadPackageTool />
      <M1GraphicsTool />
    </div>
  );
}

function CadPackageTool() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onUpload = useCallback(() => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setPendingJob({ kind: "cad", file });
    router.push(PROCESSING_ROUTE);
  }, [file, router]);

  const take = (next: File | null) => {
    if (!next) return;
    if (!/\.zip$/i.test(next.name)) {
      setError("Please upload a .zip package.");
      return;
    }
    setError(null);
    setFile(next);
  };

  return (
    <form
      className="lp-tool"
      onSubmit={(e) => {
        e.preventDefault();
        void onUpload();
      }}
    >
      <div className="lp-tool__head">
        <span className="lp-tool__index">A</span>
        <div>
          <h3 className="lp-tool__title">CAD Engineering Intelligence Engine</h3>
          <p className="lp-tool__desc">Bus/Module ZIP backup → I/O list, loop list, CAD logic and specifications.</p>
        </div>
      </div>
      {busy ? (
        <DecodeAnimation variant="cad" />
      ) : (
        <Dropzone
          accept=".zip,application/zip"
          files={file ? [file] : []}
          emptyTitle="Drop a module ZIP"
          emptyHint="or browse · Bailey Bus/Module backup"
          onFiles={(files) => take(files[0] ?? null)}
        />
      )}
      <button className="lp-btn lp-btn--primary lp-tool__submit" disabled={busy || !file} type="submit" aria-busy={busy} aria-label={busy ? "Processing" : undefined}>
        {busy ? <BusyDots /> : "Analyze & open workspace"}
      </button>
      <p className="sr-only" role="status" aria-live="polite">
        {busy ? "Opening the decoder." : ""}
      </p>
      {error && (
        <p className="lp-tool__error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function M1GraphicsTool() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onUpload = () => {
    if (!files.length) return;
    setBusy(true);
    setError(null);
    setPendingJob({ kind: "m1", files });
    router.push(PROCESSING_ROUTE);
  };

  const take = (next: File[]) => {
    if (next.length === 0) return;
    const invalid = next.find((f) => !/\.(m1|zip)$/i.test(f.name));
    if (invalid) {
      setError(`${invalid.name} is not an .M1 file or ZIP.`);
      return;
    }
    setError(null);
    setFiles(next);
  };

  return (
    <div id="m1-upload" className="lp-tool">
      <div className="lp-tool__head">
        <span className="lp-tool__index">B</span>
        <div>
          <h3 className="lp-tool__title">M1 HMI Reconstruction Engine</h3>
          <p className="lp-tool__desc">Operator displays as .M1 files or a ZIP → decoded graphics and category PDFs.</p>
        </div>
      </div>
      {busy ? (
        <DecodeAnimation variant="m1" />
      ) : (
        <Dropzone
          accept=".m1,.M1,.zip,application/zip"
          multiple
          files={files}
          emptyTitle="Drop M1 graphics"
          emptyHint="or browse · .M1 files or a ZIP of them"
          onFiles={take}
        />
      )}
      <button
        className="lp-btn lp-btn--primary lp-tool__submit"
        disabled={busy || files.length === 0}
        type="button"
        aria-busy={busy}
        aria-label={busy ? "Decoding" : undefined}
        onClick={() => void onUpload()}
      >
        {busy ? <BusyDots /> : "Decode & preview"}
      </button>
      <p className="sr-only" role="status" aria-live="polite">
        {busy ? "Opening the decoder." : ""}
      </p>
      {error && (
        <p className="lp-tool__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function Dropzone({
  accept,
  multiple = false,
  files,
  emptyTitle,
  emptyHint,
  onFiles,
}: {
  accept: string;
  multiple?: boolean;
  files: File[];
  emptyTitle: string;
  emptyHint: string;
  onFiles: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [dragOver, setDragOver] = useState(false);
  const totalMb = files.reduce((sum, f) => sum + f.size, 0) / (1024 * 1024);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => onFiles(Array.from(e.target.files ?? []))}
      />
      <div
        role="button"
        tabIndex={0}
        aria-describedby={hintId}
        className={`lp-drop${dragOver ? " lp-drop--active" : ""}${files.length ? " lp-drop--filled" : ""}`}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const dropped = Array.from(e.dataTransfer.files ?? []);
          onFiles(multiple ? dropped : dropped.slice(0, 1));
        }}
      >
        <svg className="lp-drop__icon" width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path d="M10 13V3.5m0 0L6.5 7M10 3.5 13.5 7M3.5 13v2.5h13V13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square" />
        </svg>
        <span className="lp-drop__title">
          {files.length === 0 ? emptyTitle : files.length === 1 ? files[0].name : `${files.length} files selected`}
        </span>
        <span id={hintId} className="lp-drop__hint">
          {files.length > 0 ? `${totalMb.toFixed(1)} MB · click to replace` : emptyHint}
        </span>
      </div>
    </>
  );
}
