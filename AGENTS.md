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
