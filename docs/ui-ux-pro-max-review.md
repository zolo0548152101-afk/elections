# UI/UX Pro Max review — Election Day Ops

**Date:** 2026-10-11  
**Skill:** [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) v2.x (installed under `.cursor/skills/ui-ux-pro-max`)  
**Design system draft:** `design-system/election-day-ops/MASTER.md`  
**Surfaces reviewed:** Login (desktop/mobile), Users (desktop), Dashboard/Map (code + partial runtime; headless WebGL limited)

---

## What was installed

```bash
npx ui-ux-pro-max-cli init --ai cursor          # project: .cursor/skills/
npx ui-ux-pro-max-cli init --ai cursor --global # ~/.cursor/skills/
```

Design-system generation (ops dashboard, dense, subtle motion):

```bash
python3 .cursor/skills/ui-ux-pro-max/scripts/search.py \
  "election day operations dashboard field ops hebrew rtl admin coordinator" \
  --design-system --density 8 --motion 3 --variance 4 \
  -p "Election Day Ops" --persist --output-dir .
```

---

## Pre-delivery checklist (skill)

| Check | Status | Notes |
|-------|--------|-------|
| No emojis as icons | Pass | Text/buttons; map uses MapLibre |
| `cursor: pointer` on clickables | Mostly pass | Buttons use `cursor: pointer` in `globals.css` |
| Hover transitions 150–300ms | Partial | Hover exists on picks/hits; many buttons lack explicit transition timing |
| Contrast ≥ 4.5:1 (light surfaces) | Pass (spot) | Sand card on navy; ink on sand; orange CTA on sand |
| Visible focus rings | Fail / weak | No global `:focus-visible` ring; keyboard focus easy to lose |
| `prefers-reduced-motion` | Fail | No media query in `globals.css` |
| Responsive 375 / 768 / 1024 / 1440 | Partial | Login OK on ~390px; tables rely on horizontal scroll; nav can crowd on small widths |

---

## Strengths

1. **Clear RTL Hebrew ops identity** — `lang="he" dir="rtl"`, Assistant/Heebo, navy + sand + terracotta (not generic purple AI look).
2. **Login is simple and task-focused** — mobile + password, forgot-password path, visible labels (not placeholder-only).
3. **Users form feedback path exists** — green `form-msg-ok` / red `form-msg-err`, WhatsApp send shows `✓` + button `נשלח ✓`.
4. **Map search comboboxes** — `role="combobox"`, `listbox`/`option`, `aria-live` on side panels (`StreetMap`, `SettlementPicker`).
5. **Destructive actions confirm** — delete user uses `window.confirm` (skill: confirm before irreversible).

---

## Priority findings

### P1 — Accessibility / keyboard

- **Missing focus styles.** Add a global `:focus-visible` ring using `--accent-2` / white on dark nav.
- **Errors not always announced.** Login/users errors are visual `<p>`; prefer `role="alert"` / `aria-live="assertive"` for failures (skill: Error Messages).
- **Nav density on mobile.** Many text links in one row; consider wrap, overflow menu, or sticky bottom actions for field use.

### P2 — Feedback & forms

- **Toast auto-dismiss.** Success banners stay until next action; skill recommends 3–5s auto-dismiss for non-critical toasts (keep errors sticky).
- **Users form empty space.** Auto-fit grid leaves a large blank region on wide screens; tighten max column count or use a denser 3-column ops layout (`--density` 8 guidance).
- **Password “הצג”** is good; ensure the control has an accessible name that toggles (`aria-pressed` / `aria-label`).

### P3 — Layout & data density

- **Tables on mobile.** `.table-wrap` scroll is fine; consider card rows for coordinators on phones (skill: Table Handling).
- **Action clusters.** Row with עריכה / שלח בוואטסאפ / מחיקה can be tight; ensure ≥8px gap and ~44px touch targets on mobile.
- **Loading states.** Auth shell “טוען…” is minimal; prefer skeleton for map/table regions so layout doesn’t jump (CLS).

### P4 — Design-system alignment (optional, not a rewrite)

Generated MASTER.md suggested glassmorphism + Fira + dark status-green. **Do not blindly adopt** — it matched a generic “IoT dashboard” profile. Keep the current election-ops visual language; use MASTER only for:

- denser spacing tokens
- clearer status colors (success green already used in `form-msg-ok`)
- checklist enforcement

Override note for Hebrew field ops: prefer Assistant/Heebo, sand cards, terracotta destructive/secondary, blue primary actions.

### P5 — Map resilience

- Headless/dev environments without WebGL2 crash the home dashboard (`StreetMap` / MapLibre). Catch GPU init failure and show a static fallback (table-only / message) so the rest of the shell remains usable.

---

## Recommended next improvements (ordered)

1. Global `:focus-visible` + `prefers-reduced-motion` in `globals.css`.
2. `role="alert"` on auth/users error messages; optional toast auto-dismiss for success.
3. Mobile nav: wrap or collapse secondary links; enlarge action buttons in tables.
4. Map WebGL failure fallback (no full-page error overlay).
5. Optional: denser users form grid + sticky success banner near the table actions.

---

## Artifacts

- Login desktop: `/opt/cursor/artifacts/uupm-login-desktop.png`
- Login mobile: `/opt/cursor/artifacts/uupm-login-mobile.png`
- Users desktop: `/opt/cursor/artifacts/uupm-users-desktop.png`
- Design system search dump: `/opt/cursor/artifacts/uupm-design-system.txt`
