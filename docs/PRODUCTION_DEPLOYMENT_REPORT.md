# Production Deployment Report

**Date:** 2026-09-20  
**Project:** ABB Bailey INFI 90 Migration Studio  
**Result:** **PASS** — frontend, API, CORS, and upload verified live  
**Local validation:** **PASS**

---

## GITHUB

| Item | Status |
|------|--------|
| Repository URL | https://github.com/valmet-intern-official/ABB-Bailey-INFI-90-Migration-Studio.git |
| Branch | `main` |
| Latest commit | `a1d0bda` — `fix(web): default API base to Render when building on Vercel` |
| Push | **OK** (account `valmet-intern-official`) |

---

## VERCEL (Frontend)

| Item | Status |
|------|--------|
| Account | `valmet.intern@gmail.com` / team Valmet Technologies Private Limited |
| Project | `infi90-migration-studio` (`prj_azwIvFFzbJpFArmLHGTYnXQEc7BJ`) |
| Production URL | https://infi90-migration-studio.vercel.app |
| Deploy | **Ready** — commit `a1d0bda` |
| Env | `NEXT_PUBLIC_API_BASE_URL=https://infi90-migration-api.onrender.com` |
| Client bundle | Contains Render API origin (`page-*.js`) |

---

## RENDER (API + storage)

| Item | Status |
|------|--------|
| Account | Valmet Technologies Private Limited (`valmet.intern@gmail.com`) |
| Service | `infi90-migration-api` (`srv-danpds3tqb8s73cms910`) |
| Runtime | Docker (free tier) |
| Primary URL | https://infi90-migration-api.onrender.com |
| Health | **healthy** — storage writable, migration engine ok |
| Disk | Not attached (free plan; ephemeral `/data` in container) |
| CORS | Baked in image: `https://infi90-migration-studio.vercel.app` |
| Deploy | Live — commit `247c130` (CORS bake) |

**Note:** Free instances spin down after inactivity (~50s cold start). Paid plan + persistent disk (`/data`, 10GB) recommended for production durability.

---

## DATABASE

| Item | Detail |
|------|--------|
| Provider | None — filesystem session store |
| Path | `STORAGE_ROOT=/data` (container filesystem on free tier) |
| Migration | N/A |

---

## ENVIRONMENT MODEL

### Public frontend (Vercel)

- `NEXT_PUBLIC_API_BASE_URL` → `https://infi90-migration-api.onrender.com`
- Code fallback on Vercel builds if env unset (`apps/web/src/lib/api-base.ts`)

### Server (Render / Docker)

- `STORAGE_ROOT=/data`
- `CORS_ORIGINS=https://infi90-migration-studio.vercel.app`
- `FRONTEND_ORIGIN=https://infi90-migration-studio.vercel.app`
- `SERVICE_NAME=infi90-migration-api`
- `MAX_UPLOAD_MB=100`
- `NODE_ENV=production`

---

## CONNECTIVITY VERIFICATION

| Check | Result |
|-------|--------|
| `GET https://infi90-migration-api.onrender.com/api/v1/health` | `healthy`, storage ok |
| CORS preflight / response for Vercel origin | `access-control-allow-origin: https://infi90-migration-studio.vercel.app` |
| Frontend JS embeds Render API base | **PASS** |
| `POST /api/projects/upload` from Vercel origin | **200** — session created (`proj_*`, status `ready`) |
| Vercel same-origin `/api/v1/health` | `degraded` (expected — no writable FS on serverless; UI must use Render) |

---

## LIVE URLS

- **Frontend:** https://infi90-migration-studio.vercel.app
- **API:** https://infi90-migration-api.onrender.com
- **Health:** https://infi90-migration-api.onrender.com/api/v1/health

---

## REMAINING HARDENING (optional)

1. Add payment method on Render and attach 10GB disk at `/data` (Starter plan) for persistent sessions.
2. Link GitHub App to Render for auto-deploy (currently public-repo + manual deploy).
3. Disable duplicate Vercel project `abb-bailey-infi-90-migration-studio` if unused (build errors observed).
