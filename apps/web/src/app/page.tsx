"use client";

import Image from "next/image";
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { apiUrl } from "@/lib/api-base";

const CAPABILITIES = [
  {
    title: "ZIP ingest & classification",
    body: "Upload Bus/Module packages and automatically identify CAD, M1, REF, XRF, and related engineering files.",
    icon: "files" as const,
  },
  {
    title: "I/O to CAD mapping",
    body: "Correlate AI, AO, DI, and DO channels to CAD sheets, device tags, and destination references.",
    icon: "map" as const,
  },
  {
    title: "Interactive CAD review",
    body: "Browse reconstructed logic sheets with sheet details, OREF links, and function-block context.",
    icon: "view" as const,
  },
  {
    title: "M1 graphics navigation",
    body: "Inspect operator graphics and jump from displayed tags into related CAD and I/O records.",
    icon: "check" as const,
  },
  {
    title: "Validation & completeness",
    body: "Surface unresolved tags, missing cross-sheet links, and inventory gaps before you export.",
    icon: "session" as const,
  },
  {
    title: "Engineering exports",
    body: "Download I/O and logic workbooks plus CAD and graphics PDFs for offline engineering use.",
    icon: "export" as const,
  },
];

const WORKFLOW = [
  {
    title: "Upload ZIP",
    body: "Ingest Bailey Bus/Module backup packages to begin review",
    icon: "upload" as const,
  },
  {
    title: "Extract & Classify",
    body: "Unpack archives and identify CAD, M1, REF, and XRF files",
    icon: "extract" as const,
  },
  {
    title: "Parse CAD Sheets",
    body: "Extract sheet metadata, tags, function blocks, and references",
    icon: "cad" as const,
  },
  {
    title: "Parse M1 Graphics",
    body: "Capture graphic titles, object names, and displayed tags",
    icon: "view" as const,
  },
  {
    title: "Parse Cross-Refs",
    body: "Process REF, XRF, and ERR relationships across the module",
    icon: "link" as const,
  },
  {
    title: "Build Inventory",
    body: "Assemble a complete inventory of discovered engineering assets",
    icon: "list" as const,
  },
  {
    title: "Extract I/O",
    body: "Collect AI, AO, DI, and DO channel definitions and attributes",
    icon: "io" as const,
  },
  {
    title: "Map I/O Tags",
    body: "Correlate raw I/O points to devices, loops, and CAD",
    icon: "map" as const,
  },
  {
    title: "Correlate Logic",
    body: "Connect function codes, S1/S2 values, and logic formulas",
    icon: "logic" as const,
  },
  {
    title: "Reconstruct Views",
    body: "Generate navigable SVG reconstructions for CAD and M1",
    icon: "cad" as const,
  },
  {
    title: "Validate Results",
    body: "Flag unresolved tags, missing links, and inventory gaps",
    icon: "check" as const,
  },
  {
    title: "Export Deliverables",
    body: "Produce Excel workbooks and CAD/graphics PDF packages",
    icon: "export" as const,
  },
];

export default function HomePage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const onUpload = useCallback(
    async (selected?: File | null) => {
      const zip = selected ?? file;
      if (!zip) return;
      setBusy(true);
      setError(null);
      try {
        const fd = new FormData();
        fd.set("file", zip);
        const res = await fetch(apiUrl("/api/projects/upload"), {
          method: "POST",
          body: fd,
        });
        let data: { id?: string; error?: string } = {};
        try {
          data = (await res.json()) as { id?: string; error?: string };
        } catch {
          throw new Error(
            res.ok
              ? "Upload succeeded but returned an invalid response"
              : `Upload failed (HTTP ${res.status})`
          );
        }
        if (!res.ok) throw new Error(data.error || `Upload failed (HTTP ${res.status})`);
        if (!data.id) throw new Error("Upload succeeded but no session id was returned");
        router.push(`/workspace/${data.id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setBusy(false);
      }
    },
    [file, router]
  );

  const takeFile = (next: File | null) => {
    if (!next) return;
    if (!/\.zip$/i.test(next.name)) {
      setError("Please upload a .zip package.");
      return;
    }
    setError(null);
    setFile(next);
  };

  return (
    <>
      <SiteHeader />
      <main>
        <section className="mx-auto grid max-w-[1120px] items-center gap-10 px-5 pb-12 pt-12 md:grid-cols-[1.05fr_0.95fr] md:gap-12 md:pb-16 md:pt-16">
          <div className="anim-fade-up">
            <p className="section-label">Lead the way</p>
            <h1 className="mt-3 font-[family-name:var(--font-display)] text-4xl font-bold tracking-tight md:text-[2.75rem] md:leading-[1.12]">
              <span className="text-[var(--accent)]">ABB Bailey INFI 90</span>
              <br />
              <span className="text-[var(--ink)]">Migration Studio</span>
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-[var(--muted)] md:text-lg">
              An engineering workspace that transforms Bailey INFI 90 Bus/Module
              ZIP backups into structured I/O lists, correlated CAD logic, and
              reconstructed graphics — enabling teams to review, validate, and
              export migration-ready deliverables in a single session.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a href="#upload" className="btn">
                Get Started
              </a>
              <a href="#capabilities" className="btn btn-secondary">
                Explore Features
              </a>
              <a href="#contact" className="btn btn-ghost">
                Get in Touch
              </a>
            </div>
          </div>
          <div className="anim-fade-up anim-delay-1 hero-media">
            <Image
              src="/hero-engineering.png"
              alt="Industrial control migration and engineering data visualization"
              width={1040}
              height={780}
              priority
              className="h-full w-full object-cover"
            />
          </div>
        </section>

        <section id="upload" className="bg-[var(--bg-soft)] py-16">
          <div className="mx-auto max-w-[1120px] px-5">
            <div className="section-head">
              <p className="section-label">ABB Bailey INFI 90 Engineering Services</p>
              <h2 className="section-title">Engineering Data & Deliverables</h2>
              <p className="section-lead">
                Start a temporary review session from a Bus/Module ZIP. Working
                files exist only for this session — review, access, and export.
              </p>
            </div>

            <div className="upload-card">
              <div className="upload-card__body">
                <h3 className="upload-card__title">Upload & process package</h3>
                <p className="upload-card__desc">
                  Drop a Bailey INFI 90 Bus/Module ZIP to classify files, map
                  I/O to CAD logic, and open the interactive viewer.
                </p>

                <form
                  className="mt-5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void onUpload();
                  }}
                >
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".zip,application/zip"
                    className="sr-only"
                    onChange={(e) => takeFile(e.target.files?.[0] ?? null)}
                  />
                  <div
                    role="button"
                    tabIndex={0}
                    className={`dropzone ${dragOver ? "dropzone--active" : ""}`}
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
                      takeFile(e.dataTransfer.files?.[0] ?? null);
                    }}
                  >
                    <div className="dropzone__icon">
                      <UploadGlyph />
                    </div>
                    <p className="font-semibold text-[var(--ink)]">
                      {file ? file.name : "Drag and drop your module ZIP"}
                    </p>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {file
                        ? `${(file.size / (1024 * 1024)).toFixed(1)} MB selected — click to replace`
                        : "or click to browse · Bailey Bus/Module backup packages"}
                    </p>
                  </div>

                  <div className="upload-actions">
                    <button
                      className="btn"
                      disabled={busy || !file}
                      type="submit"
                    >
                      {busy ? "Processing…" : "Analyze & Open Viewer"}
                    </button>
                  </div>

                  {error && (
                    <p className="mt-4 text-center text-sm text-red-700" role="alert">
                      {error}
                    </p>
                  )}
                </form>
              </div>
            </div>
          </div>
        </section>

        <section id="capabilities" className="bg-white py-16">
          <div className="mx-auto max-w-[1120px] px-5">
            <div className="section-head">
              <p className="section-label">Capabilities</p>
              <h2 className="section-title">Key Features</h2>
              <p className="section-lead">
                Focused tools for engineering review — from package ingest to
                exportable deliverables.
              </p>
            </div>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {CAPABILITIES.map((item) => (
                <article key={item.title} className="panel p-5">
                  <div className="feature-icon">
                    <CapabilityIcon name={item.icon} />
                  </div>
                  <h3 className="text-base font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
                    {item.body}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="workflow" className="bg-[var(--bg-soft)] py-16">
          <div className="mx-auto max-w-[1120px] px-5">
            <div className="section-head">
              <p className="section-label">Step-by-step automation pipeline</p>
              <h2 className="section-title">Platform Workflow</h2>
              <span className="section-rule" aria-hidden />
              <p className="section-lead">
                Twelve automated stages from upload through export — no saved
                project catalog required.
              </p>
            </div>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {WORKFLOW.map((item) => (
                <article key={item.title} className="workflow-card">
                  <span className="workflow-card__icon">
                    <WorkflowIcon name={item.icon} />
                  </span>
                  <h3 className="workflow-card__title">{item.title}</h3>
                  <p className="workflow-card__body">{item.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="contact" className="bg-white py-16">
          <div className="mx-auto max-w-[1120px] px-5">
            <div className="section-head">
              <p className="section-label">Communication</p>
              <h2 className="section-title">Get In Touch</h2>
              <p className="section-lead">
                Whether you&apos;re migrating a single control system or managing
                a large industrial modernization project, ABB Bailey INFI 90
                Migration Studio helps engineering teams streamline the entire
                migration process with accuracy, speed, and confidence.
              </p>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-2">
              <article className="panel p-6">
                <div className="feature-icon">
                  <MailGlyph />
                </div>
                <h3 className="text-lg font-semibold">Business Enquiries</h3>
                <dl className="mt-4 space-y-3 text-sm">
                  <div>
                    <dt className="font-medium text-[var(--muted)]">Email</dt>
                    <dd>
                      <a
                        className="text-[var(--accent)] hover:underline"
                        href="mailto:valmet.intern@gmail.com"
                      >
                        valmet.intern@gmail.com
                      </a>
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-[var(--muted)]">Website</dt>
                    <dd>
                      <a
                        className="text-[var(--accent)] hover:underline"
                        href="https://www.valmet.com"
                        target="_blank"
                        rel="noreferrer"
                      >
                        www.valmet.com
                      </a>
                    </dd>
                  </div>
                </dl>
              </article>

              <article className="panel p-6">
                <div className="feature-icon">
                  <PinGlyph />
                </div>
                <h3 className="text-lg font-semibold">Headquarters</h3>
                <p className="mt-4 text-sm leading-relaxed text-[var(--muted)]">
                  Valmet Technologies Private Limited
                  <br />
                  301, Global Port,
                  <br />
                  Mumbai–Bangalore Highway, Baner,
                  <br />
                  Pune – 411045
                </p>
              </article>
            </div>
          </div>
        </section>

        <footer className="site-footer">
          <div className="site-footer__inner">
            <p>© {new Date().getFullYear()} Valmet · ABB Bailey INFI 90 Migration Studio</p>
            <p>Session-based engineering review · No project library stored</p>
          </div>
        </footer>
      </main>
    </>
  );
}

function UploadGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 16V4m0 0 4 4m-4-4-4 4M4 16.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MailGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="m4 7 8 6 8-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function PinGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <circle cx="12" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function CapabilityIcon({
  name,
}: {
  name: "files" | "map" | "view" | "check" | "export" | "session";
}) {
  return <WorkflowIcon name={name} />;
}

function WorkflowIcon({
  name,
}: {
  name:
    | "files"
    | "map"
    | "view"
    | "check"
    | "export"
    | "session"
    | "upload"
    | "extract"
    | "cad"
    | "link"
    | "list"
    | "io"
    | "logic";
}) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    "aria-hidden": true as const,
  };

  switch (name) {
    case "upload":
      return (
        <svg {...common}>
          <path
            d="M12 16V4m0 0 3.5 3.5M12 4 8.5 7.5M5 18h14"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      );
    case "extract":
      return (
        <svg {...common}>
          <path
            d="M7 8V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2M5 8h14v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8Z"
            stroke="currentColor"
            strokeWidth="1.8"
          />
        </svg>
      );
    case "files":
      return (
        <svg {...common}>
          <path
            d="M8 4h6l4 4v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path d="M14 4v4h4" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case "cad":
      return (
        <svg {...common}>
          <rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
          <path d="M8 15V9h3.2a2 2 0 0 1 0 4H8M14.5 15V9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "view":
      return (
        <svg {...common}>
          <path
            d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case "link":
      return (
        <svg {...common}>
          <path
            d="M9.5 14.5 14.5 9.5M8 12H6.5A3.5 3.5 0 1 1 10 8.5M16 12h1.5A3.5 3.5 0 1 0 14 15.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      );
    case "list":
      return (
        <svg {...common}>
          <path
            d="M8 7h11M8 12h11M8 17h11M5 7h.01M5 12h.01M5 17h.01"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      );
    case "io":
      return (
        <svg {...common}>
          <path
            d="M7 8h10M7 16h10M10 8v8M14 8v8"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      );
    case "map":
      return (
        <svg {...common}>
          <path
            d="M4 7l5-2 6 2 5-2v12l-5 2-6-2-5 2V7Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path d="M9 5v12M15 7v12" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case "logic":
      return (
        <svg {...common}>
          <path
            d="M7 7h4v4H7V7Zm6 6h4v4h-4v-4ZM9 11v2h6"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="m8.5 12.5 2.2 2.2 4.8-5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "export":
      return (
        <svg {...common}>
          <path
            d="M12 4v10m0 0 3.5-3.5M12 14l-3.5-3.5M5 18h14"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "session":
      return (
        <svg {...common}>
          <path
            d="M7 8h10M7 12h10M7 16h6"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
  }
}
