# Production readiness audit (Phase 1)

Date: 2026-09-20  
Workspace: ABB Bailey INFI 90 Migration Studio

## Verdict

Local engineering tool is functionally complete as a **single Next.js monorepo**.  
Naive “Vercel frontend + separate Render API service” does not match the original code shape (UI and API share one Next.js process + disk).  

Production model adopted without inventing a new stack:

1. Keep the Next.js app and in-process migration pipeline.
2. Host the **API + storage + processing** on **Render** with a **persistent disk**.
3. Host the **UI** on **Vercel**, calling Render via `NEXT_PUBLIC_API_BASE_URL`.
4. Restrict CORS on Render to the Vercel origin(s).

## Stack

| Area | Finding |
|------|---------|
| Package manager | npm workspaces |
| Frontend | Next.js 15.5 / React 19 / Tailwind 4 |
| Backend | Same Next.js Route Handlers |
| DB | None (JSON session files) |
| Queue / worker | None (sync in upload request) |
| Storage | `STORAGE_ROOT` (default `./data`) |

## Gaps closed in this release

- Configurable `STORAGE_ROOT`
- Health endpoints `/api/v1/health` and `/api/health`
- CORS middleware (allow-list only in production)
- Frontend API base URL (`NEXT_PUBLIC_API_BASE_URL`)
- Safe ZIP extraction (path traversal + size caps)
- Upload validation (extension, empty, size)
- Structured migration logs
- `.env.example`, `render.yaml`, `Dockerfile`, `vercel.json`, CI
- Hardened `.gitignore`

## Remaining platform constraints

- Long ZIP jobs run in-request (`maxDuration=300`); Render free/sleeping tiers may time out large modules — use a paid web service with sufficient timeout.
- No auth layer; session IDs act as capability tokens.
- No Redis/Postgres unless architecture is later extended.
