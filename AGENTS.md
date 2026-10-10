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
- Next.js App Router, Neon Postgres, Vercel, Leaflet/OSM.
- Filters: min % right, max turnout, min בז״ב. Right parties: ט + מחל + שס + ג.

## Cloud agents
- Work from this repository root. Install with `npm ci`. Dev server: `npm run dev -- --hostname 0.0.0.0 --port 3000`. Open `http://localhost:3000` (127.0.0.1 is allowed via `allowedDevOrigins`).
- `DATABASE_URL` is the Neon pooled connection for project `election-day-ops`, database `neondb`, with `sslmode=require`. `SESSION_SECRET` signs auth cookies.
- Do not run `npm run seed` unless asked. It truncates `settlements` and `clusters`.
- Vercel project `election-day-ops` (`prj_pwImjryRCzAcqSYYwU1o0E13qEeh`) tracks this repo with an empty root directory.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
