# Elections app — agent notes

## Repo & workflow
- This repository (`zolo0548152101-afk/elections`) is the **only** home for the election-day Next.js app.
- Finished work is pushed to `main` (shared with a coworker). Prefer short-lived feature branches only when needed; merge/push completed work to `main`.

## Before every new task
1. `cd` to this repo root.
2. `git checkout main` (if not already).
3. `git pull origin main` and confirm you are on the latest remote `main` before editing.
4. Do not start implementation on a stale checkout — coworker may have pushed since the last session.

## Stack
- Next.js App Router, Neon Postgres, Vercel, Leaflet (cluster dashboard), MapLibre (street map).
- Streets: OSM Hebrew names only (Geofabrik / HOT roads). Vector tiles via `/api/tiles/{z}/{x}/{y}`.
- Roles: `super_admin`, `area_manager`, `coordinator`. Auth: email/password sessions.
- Filters: min % right, max turnout, min בז״ב. Right parties: ט + מחל + שס + ג.
- Cluster↔street link column `streets.ashkol` stays null until `npm run import:cluster-streets`.

## Cloud agents
- Work from this repository root. Install with `npm ci`. Dev server: `npm run dev -- --hostname 0.0.0.0 --port 3000`. Open `http://localhost:3000` (127.0.0.1 is allowed via `allowedDevOrigins`).
- `DATABASE_URL` is the Neon pooled connection for project `election-day-ops`, database `neondb`, with `sslmode=require`. `SESSION_SECRET` signs auth cookies.
- Do not run `npm run seed` unless asked. It truncates `settlements` and `clusters`.
- Vercel project `election-day-ops` (`prj_pwImjryRCzAcqSYYwU1o0E13qEeh`) tracks this repo with an empty root directory.
- After every push that changes the app, resolve the branch’s Vercel preview alias (deployment aliases for `election-day-ops`) and paste that HTTPS link in the reply for the user to test.
