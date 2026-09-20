# ABB Bailey INFI 90 Migration Studio

Next.js monorepo that ingests Bailey INFI 90 Bus/Module ZIP backups, classifies engineering files, maps AI/AO/DI/DO to CAD logic, reconstructs CAD/M1 visuals to PDF/SVG, and provides an interactive engineering viewer.

## Quick start

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and upload `Input/M5.zip`.

## Workspace layout

- `apps/web` — Next.js viewer + migration API (same process)
- `packages/core` — domain types, correlation, validation
- `packages/parsers` — ZIP/OUT/REF/XRF/ERR/CAD/M1 parsers
- `packages/cad-engine` — SCAD binary decode + engineering model
- `packages/renderers` — SVG/PDF reconstruction
- `packages/exporters` — Excel I/O + Logic exports
- `Input/` / `Output/` — reference samples

## Architecture (production)

This product is a **single Next.js Node application**:

| Concern | Implementation |
|---------|----------------|
| Frontend UI | Next.js App Router |
| Migration API | Next.js Route Handlers under `/api/*` |
| Job processing | In-process (synchronous) during upload |
| Persistence | Filesystem session store (`STORAGE_ROOT`) |
| Database | Not required |
| Redis / workers | Not required |

### Deployment model

| Platform | Role | Account |
|----------|------|---------|
| **Vercel** | Production UI | `valmet.intern@gmail.com` |
| **Render** | Production API + storage + processing | `valmet.intern@gmail.com` |
| **GitHub** | Source of truth | `valmet-intern-official` |

Browser → Vercel UI → Render API (`NEXT_PUBLIC_API_BASE_URL`) → disk (`STORAGE_ROOT`).

Render must use a **persistent disk**. Do not use ephemeral filesystem/SQLite as the production store.

## Environment

See [`.env.example`](.env.example).

**Vercel (public):**

- `NEXT_PUBLIC_API_BASE_URL` = Render service origin (no trailing slash)

**Render (server):**

- `STORAGE_ROOT=/data`
- `CORS_ORIGINS` = Vercel production origin(s), comma-separated
- `SERVICE_NAME=infi90-migration-api`
- `MAX_UPLOAD_MB=100`

## Health

`GET /api/v1/health` → HTTP 200 when storage is writable:

```json
{
  "status": "healthy",
  "service": "infi90-migration-api"
}
```

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Local development |
| `npm run build` | Production build |
| `npm test` | Parser unit tests |
| `npm run smoke:m5` | Offline smoke against `Input/M5.zip` |

## Outputs per session

Stored under `$STORAGE_ROOT/sessions/<id>/artifacts/`:

- `IO_List.xlsx`
- `Logic_Specification.xlsx`
- `CAD_Logic.pdf`
- `M1_Graphics.pdf`
- `cad-svg/` / `m1-svg/`

## Security notes

- Uploaded ZIP archives are **parsed only** — never executed.
- ZIP extraction rejects path traversal and oversized entries.
- Production CORS allows only configured frontend origins (no `*`).
- Do not commit `.env` / secrets.
