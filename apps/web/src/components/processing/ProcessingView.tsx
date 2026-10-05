"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { apiUrl } from "@/lib/api-base";
import { clearPendingJob, getPendingJob, type PendingJob } from "@/lib/pending-job";
import { primeResult, resultKey } from "@/lib/result-cache";
import { ParticleField, type ParticleFieldHandle } from "./ParticleField";
import { ProcessingScene, type Phase } from "./ProcessingScene";

type Kind = PendingJob["kind"];

/** Share of the overall bar given to the upload; the rest belongs to server-side decoding. */
const UPLOAD_SHARE = 0.25;
const DONE_HOLD_MS = 1500;
const LEAVE_MS = 520;

type Posted = { status: number; body: { id?: string; error?: string } };

function postForm(url: string, form: FormData, onUpload: (ratio: number) => void): Promise<Posted> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onUpload(e.loaded / e.total);
    };
    xhr.upload.onload = () => onUpload(1);
    xhr.onload = () => {
      let body: Posted["body"] = {};
      try {
        body = JSON.parse(xhr.responseText) as Posted["body"];
      } catch {
        // Non-JSON bodies are reported through the status code below.
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => reject(new Error("Network error while uploading"));
    xhr.send(form);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(apiUrl(path));
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

async function getText(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

/** Loads what the workspace shows first, so it opens without a loading state. */
async function preloadCad(id: string) {
  const session = await getJson<{ cadSheets: Array<{ filename: string }> }>(`/api/projects/${id}`);
  primeResult(resultKey.cadSession(id), session);
  const first = session.cadSheets[0]?.filename;
  if (!first) return;
  const sheet = encodeURIComponent(first);
  await Promise.allSettled([
    getText(apiUrl(`/api/projects/${id}/cad-svg/${sheet}`)).then((t) => primeResult(resultKey.cadSvg(id, first), t)),
    getJson<{ blocks: unknown[] }>(`/api/projects/${id}/cad-logic/${sheet}`).then((d) =>
      primeResult(resultKey.cadBlocks(id, first), d.blocks)
    ),
  ]);
}

/** Loads what the M1 viewer shows first, so it opens without a loading state. */
async function preloadM1(id: string) {
  const [index, cats] = await Promise.all([
    getJson<{ index: { files: Array<{ name: string }> } }>(`/api/m1/${id}`),
    getJson<{ categories: unknown[] }>(`/api/m1/${id}/categories`),
  ]);
  primeResult(resultKey.m1Index(id), index);
  primeResult(resultKey.m1Categories(id), cats);
  const first = index.index.files[0]?.name;
  if (!first) return;
  const url = apiUrl(`/api/m1/${id}/asset/${encodeURIComponent(first)}/graphics/original.svg`);
  await getText(url)
    .then((t) => primeResult(resultKey.m1Svg(url), t))
    .catch(() => undefined);
}

const PHASE_LABEL: Record<Phase, string> = {
  upload: "Uploading the package",
  decode: "Decoding source files",
  build: "Reconstructing engineering outputs",
  done: "Conversion complete, opening results",
  error: "Conversion failed",
};

export function ProcessingView() {
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const field = useRef<ParticleFieldHandle>(null);
  const started = useRef(false);
  const [kind, setKind] = useState<Kind | null>(null);
  const [phase, setPhase] = useState<Phase>("upload");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [ripples, setRipples] = useState<Array<{ id: number; x: number; y: number }>>([]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const job = getPendingJob();
    if (!job) {
      router.replace("/#studio");
      return;
    }
    clearPendingJob();
    setKind(job.kind);

    const finish = async (href: string, preload: Promise<void>) => {
      router.prefetch(href);
      // Dev builds skip prefetching, so request the page once to compile it before navigating.
      const warm =
        process.env.NODE_ENV === "development" ? fetch(href).then(() => undefined, () => undefined) : Promise.resolve();
      setProgress(1);
      setPhase("done");
      // A failed preload only means the result page fetches for itself.
      await Promise.all([sleep(DONE_HOLD_MS), preload.catch(() => undefined), warm]);
      setLeaving(true);
      await sleep(LEAVE_MS);
      router.replace(href);
    };

    const fail = (err: unknown, fallback: string) => {
      setError(err instanceof Error ? err.message : fallback);
      setPhase("error");
    };

    const runCad = async (file: File) => {
      const form = new FormData();
      form.set("file", file);
      let simulate: ReturnType<typeof setInterval> | undefined;
      try {
        const res = await postForm(apiUrl("/api/projects/upload"), form, (u) => {
          setProgress(u * UPLOAD_SHARE);
          if (u >= 1 && !simulate) {
            setPhase("decode");
            const t0 = performance.now();
            // The server decodes inside this one request and reports no progress, so the bar eases towards 95%.
            simulate = setInterval(() => {
              const s = 1 - Math.exp(-(performance.now() - t0) / 45000);
              setProgress(UPLOAD_SHARE + (0.95 - UPLOAD_SHARE) * s);
              if (s > 0.4) setPhase((p) => (p === "decode" ? "build" : p));
            }, 400);
          }
        });
        clearInterval(simulate);
        if (res.status < 200 || res.status >= 300) throw new Error(res.body.error || `Upload failed (HTTP ${res.status})`);
        if (!res.body.id) throw new Error("Upload succeeded but no session id was returned");
        await finish(`/workspace/${res.body.id}`, preloadCad(res.body.id));
      } catch (err) {
        clearInterval(simulate);
        fail(err, "Upload failed");
      }
    };

    const runM1 = async (files: File[]) => {
      const form = new FormData();
      for (const f of files) form.append("files", f);
      try {
        const res = await postForm(apiUrl("/api/m1/upload"), form, (u) => setProgress(u * UPLOAD_SHARE));
        if (res.status < 200 || res.status >= 300) throw new Error(res.body.error || `Upload failed (HTTP ${res.status})`);
        const id = res.body.id;
        if (!id) throw new Error("Upload succeeded but no session id was returned");
        setPhase("decode");

        let misses = 0;
        for (;;) {
          await sleep(1200);
          let s: { state?: string; total?: number | null; done?: number; error?: string };
          try {
            const sr = await fetch(apiUrl(`/api/m1/${id}/status`), { cache: "no-store" });
            s = (await sr.json()) as typeof s;
            if (!sr.ok) throw new Error(s.error || `HTTP ${sr.status}`);
            misses = 0;
          } catch (err) {
            // Tolerate brief network hiccups while the server is busy rendering.
            if (++misses >= 10) throw new Error(`Lost contact with the server while decoding (${err instanceof Error ? err.message : "network error"})`);
            continue;
          }
          if (s.state === "failed") throw new Error(s.error || "Decoding failed");
          if (s.state === "done") break;
          if (s.total) {
            setPhase("build");
            setProgress(0.3 + 0.65 * ((s.done ?? 0) / s.total));
          } else {
            setProgress((p) => Math.min(0.3, Math.max(p, UPLOAD_SHARE) + 0.005));
          }
        }
        await finish(`/m1/${id}`, preloadM1(id));
      } catch (err) {
        fail(err, "Decoding failed");
      }
    };

    void (job.kind === "cad" ? runCad(job.file) : runM1(job.files));
  }, [router]);

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const el = root.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
    el.style.setProperty("--px", ((e.clientX - r.left) / r.width - 0.5).toFixed(3));
    el.style.setProperty("--py", ((e.clientY - r.top) / r.height - 0.5).toFixed(3));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("a, button")) return;
    const r = root.current?.getBoundingClientRect();
    if (!r) return;
    const id = performance.now();
    setRipples((list) => [...list.slice(-4), { id, x: e.clientX - r.left, y: e.clientY - r.top }]);
    field.current?.burst(e.clientX, e.clientY);
  };

  const stageIndex = phase === "upload" ? 0 : phase === "decode" ? 1 : phase === "build" ? 2 : phase === "done" ? 3 : -1;

  return (
    <div
      ref={root}
      className="pr"
      data-phase={phase}
      data-leaving={leaving || undefined}
      onPointerMove={onPointerMove}
      onPointerDown={onPointerDown}
    >
      <ParticleField ref={field} />
      <div className="pr__spot" aria-hidden />
      {ripples.map((r) => (
        <span
          key={r.id}
          className="pr__ripple"
          style={{ left: r.x, top: r.y }}
          aria-hidden
          onAnimationEnd={() => setRipples((list) => list.filter((x) => x.id !== r.id))}
        />
      ))}

      <header className="pr__header">
        <Link href="/" className="pr__brand" aria-label="ABB Bailey INFI 90 Migration Studio — home">
          <span className="pr__logo">
            <Image src="/valmet-logo.webp" alt="Valmet" width={98} height={28} priority />
          </span>
        </Link>
      </header>

      <main className="pr__stage">
        <div className="pr__scene">{kind && <ProcessingScene kind={kind} phase={phase} progress={progress} />}</div>

        <ol className="pr__track" aria-hidden style={{ ["--p" as string]: progress }}>
          {(["upload", "decode", "build", "done"] as const).map((s, i) => (
            <li key={s} className="pr__node" data-state={i < stageIndex ? "done" : i === stageIndex ? "active" : "todo"}>
              <StageIcon stage={s} />
            </li>
          ))}
        </ol>

        <p className="sr-only" role="status" aria-live="polite">
          {PHASE_LABEL[phase]}
        </p>

        {phase === "error" && (
          <div className="pr__error" role="alert">
            <h1 className="pr__error-title">Conversion failed</h1>
            <p className="pr__error-text">{error}</p>
            <Link href="/#studio" className="lp-btn lp-btn--primary">
              Back to the studio
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}

function StageIcon({ stage }: { stage: "upload" | "decode" | "build" | "done" }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
      {stage === "upload" && <path {...common} d="M10 14V4m0 0-4 4m4-4 4 4M4 16h12" />}
      {stage === "decode" && (
        <g {...common}>
          <rect x="5" y="5" width="10" height="10" rx="2" />
          <path d="M8 2v3m4-3v3M8 15v3m4-3v3M2 8h3m-3 4h3m10-4h3m-3 4h3" />
        </g>
      )}
      {stage === "build" && <path {...common} d="m10 3 7 4-7 4-7-4 7-4Zm-7 7 7 4 7-4M3 13l7 4 7-4" />}
      {stage === "done" && <path {...common} d="m4.5 10.5 3.5 3.5 7.5-8" />}
    </svg>
  );
}
