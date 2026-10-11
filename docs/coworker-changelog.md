# Election Day Ops — change report for teammates

**Branch:** `cursor/osm-streets-roles-9c05`  
**PR:** https://github.com/zolo0548152101-afk/elections/pull/1 (draft — not merged)  
**Base / production:** `main` → https://election-day-ops.vercel.app  
**Preview (this branch):** https://election-day-ops-git-cursor-osm-stre-cae00c-zolo0548152101-8975.vercel.app  

This document compares **what was on `main` before the street-map work** with **what exists on the feature branch now**. English for the engineering notes; Hebrew UI labels match the product.

---

## 1. What the first version had (`main`)

- Next.js app focused on **cluster / voter data** (בז״ב, turnout, % right, ballots).
- Dashboard filters: min % right, max turnout, min בז״ב. Right parties: ט + מחל + שס + ג.
- Leaflet cluster map + table + CSV export.
- Neon tables for settlements and clusters; seed scripts for that data.
- No OSM street layer, no login/roles UI for coordinators, no street assignment.

---

## 2. What exists now (feature branch)

### Map and streets

| Area | Now |
|------|-----|
| Map engine | **MapLibre GL** + OSM raster + own vector tiles `/api/tiles/{z}/{x}/{y}` |
| Street data | ~30k Israel roads from OSM/Geofabrik (Hebrew `name_he`). Loaded with `npm run seed:streets` (upsert; truncate only if `REPLACE_STREETS=1`) |
| Home page | Unified: filters + street map + cluster dots + voter card + table + CSV |
| Street color | Blue by default; **green** when marked done. **Not** filtered by voter criteria until cluster↔street import fills `streets.ashkol` |
| Click street | Toggle done **and** open popup (name; ashkol only when set) + side card to **assign to coordinator** |
| Search | Interactive autocomplete: cities and streets as you type; supports **city + street** in one box (e.g. `בית שאן הרמב"ם`); quote variants normalized |
| Cluster dots | Same voter figures as before (בז״ב, מצביעים, כשרים, הצבעה, ימין, קלפיות) on click + side card |
| `/map` | Redirects to `/` |

### Auth and roles

| Role | Can do |
|------|--------|
| `super_admin` | Everything: users, institutions catalog, assign any street, link any cluster to any institution |
| `area_manager` | Manage own coordinators; see their institutions; assign streets (city + institution rules); link clusters to those institutions |
| `coordinator` | Own **institution** (nav «המוסד שלי»); mark streets; assign to **self** in institution city; map/table = only ashkols linked to their institution |

Sessions: email/password cookie `edo_session`. Admin via `ADMIN_EMAIL` / `ADMIN_PASSWORD` only (no code defaults). `npm run seed:admin` never resets an existing password unless `FORCE_ADMIN_PASSWORD=1`. Do not share secrets in chat.

Pages: `/login`, `/` (map), `/users`, `/institutions`. **No groups** — only institutions from חוברת2, linked to coordinators via `users.institution_id`. `/groups` redirects to `/institutions`.

Users page: admins can **edit** / **delete** users and set a **new** password (min 8 chars). Passwords are bcrypt-only — never stored or returned in plaintext. Assign each coordinator an institution here.

### New data model (additive — streets/clusters not truncated)

- `street_coordinators` — many-to-many street ↔ coordinator (`assigned_by`, `assigned_at`).
- `street_marks` — per-user done state `(street_id, user_id)`.
- `institutions` from חוברת2 (`kind`, `settlement_name`, `district`, `lat`/`lng`, `key_people_raw`) + `institution_contacts`.
- `institution_clusters` — institution ↔ ashkol. Coordinators only see those ashkols on the map/table.
- Legacy `groups` / `group_coordinators` tables are dropped (`npm run db:schema`).

### Scripts coworkers may need

```bash
npm ci
npm run db:schema          # idempotent schema apply
npm run seed:streets       # load/upsert OSM streets (safe by default)
npm run import:cluster-streets   # later: cluster↔street file
npm run seed:admin         # ensure admin user (env required)
npm run import:institutions  # upsert חוברת2 → institutions + contacts
npm run dev -- --hostname 0.0.0.0 --port 3000
```

Do **not** run `npm run seed` unless you intend to wipe settlements/clusters.

---

## 3. Assignment rules (product)

1. A street can belong to **more than one** coordinator.
2. **Coordinator** may add a street only to themselves, and only if the street’s nearest city matches their institution (or user) settlement.
3. **Area manager** may add a street to a coordinator under them who has an `institution_id`, in that coordinator’s institution city.
4. **Admin** may add any street to any coordinator.
5. Street↔cluster id is **absolute data** (like the street name). No manual street→cluster editor. Import will fill `streets.ashkol`. Until then the popup simply omits the ashkol line.
6. Coordinators **link clusters to their institution** (“קשר למוסד”). Those ashkols are what appear on their map.

---

## 4. What is intentionally not done yet

- Importing the real cluster↔street file (command exists; data not loaded).
- Coloring / filtering street lines by voter filters.
- Merging this PR into `main` / shipping to production.
- Replacing the old Leaflet `ClusterMap` file (unused by home; kept in repo).

---

## 5. How to review

1. Open the **preview** URL above (or run locally on this branch).
2. Log in as admin.
3. Search an city (e.g. תל אביב) and a street (e.g. דיזנגוף).
4. Click a street → green done + popup + “הוספה לרכז” card.
5. Click a cluster → voter card + “קשר למוסד”.
6. Create a group with a **יישוב** select; create coordinator + institution; verify assignment scopes.

**Neon project:** `election-day-ops` (`blue-flower-79416935`).  
**Vercel project:** `election-day-ops` (`prj_pwImjryRCzAcqSYYwU1o0E13qEeh`), repo root.

---

## 6. Sync tip before you edit

```bash
git checkout main && git pull origin main
git checkout cursor/osm-streets-roles-9c05
git merge origin/main   # or rebase if you prefer; do not force-push shared history
```

Prefer short-lived work on this branch until the PR is ready to merge.
