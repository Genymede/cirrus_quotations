# Quotations cutover & rollback runbook

Written during Phase 5 (pre-cutover verification); **updated in Phase 6 —
the cutover has been performed.** `quotations/frontend/.env` now has
`VITE_API_MODE=ems` configured (see §2); `quotations/backend` is retired
(not deleted — kept for rollback, see `quotations/backend/RETIRED.md`) and
must not be started alongside `inventory_sys/backend` (both default to port
4500). Sections below are updated to reflect this; §1-§9 describe the
mechanism and are otherwise unchanged from Phase 5.

**Phase 6 fixed the "unauthorized, no login screen" bug** reported after
the user's own ems-mode testing. Root cause: `quotations/frontend/.env` had
`VITE_API_URL` pointed at `ems-backend` (`http://localhost:3000/api/v1/ems/inventory`)
while `VITE_API_MODE` was left commented out -- so the app silently stayed
in **legacy** mode (no login gate, no bearer token: `App.tsx`'s
`loggedIn` state is hardcoded `true` whenever `api.mode !== 'ems'`), while
two legacy-shaped calls (`GET .../inventory/items`, `GET .../inventory/units`)
still happened to match real, auth-guarded `ems-backend` routes --
producing live `401`s with no login screen ever able to catch them (the
whole token/login/`unauthorizedHandler` system in `api.ts`/`App.tsx` only
activates when `API_MODE === 'ems'`). No defect was found in the gate logic
itself (`App.tsx:858` checks `!loggedIn` before any page renders;
`setUnauthorizedHandler` registers synchronously on mount, before any fetch
can resolve; the projects-load effect already skips while logged out, a
Phase 4 fix) -- scripted Playwright checks (fresh load / stale token /
successful login / logout, all against a real `ems-backend` instance) pass
cleanly once `VITE_API_MODE=ems` is actually in effect. The fix was
therefore the `.env` correction in §2, not a code change.

**Updates below (newest first)**: this section holds the running log of
dated "Phase N" updates to this runbook, most recent first -- when a new
one is added, it goes above this note, pushing the rest down; §1 onward
below is the stable reference material (env values, commands, known
limitations) and keeps its own original order.

## 16. Phase 11 — one-day date shift fixed; CTL view rows; VAT model confirmed

Driven by `claude_prompt.txt` (2026-10-12), three items from a "v155
review." Full numbers/matrix: `PROGRESS_LOG.md`, "Quotations dates, CTL
rows, VAT label."

**Dates.** The same UTC-serialization shift that `exchange_rate_date` was
fixed for (§13) also affected `sales.quotations.issue_date`/`valid_until`
and `projects.projects.start_date`/`due_date` (returned via a quotation's
`project` sub-object) — all four now cast `::text` in `ems-backend`'s list
and detail queries, in `quotations.service.ts`. **A second, more severe
date defect was found and fixed in the same investigation**: `create()`
and `replace()` both silently discarded the client's `quotationDate` on
every save and substituted the server's own current date instead
(`computeQuotationFields`'s `today`, now renamed `issueDate` and sourced
from `dto.quotationDate`) — meaning editing and resaving an existing
quotation on a later day silently moved its issue date forward to that
day, and typing a different issue date and saving never actually took
effect. `quotations/frontend` also had its own, independent display bug:
`validUntil`'s preview on the add/edit screen used `.toISOString()` to
read back a locally-constructed date, which shifts the shown day backward
for any positive-UTC-offset viewer (Bangkok included) — fixed to use local
getters instead. The stored `valid_until` was never affected by this one
(already server-derived), only the on-screen preview was wrong.

**CTL rows in the view.** `QuotationView`'s CTL table was reading each
row's stored `ctl_items[].total` directly — but `buildCtlItems` (inherited
unchanged from the original `quotations/backend` reference) has always
stored `total` as a raw copy of `price`, never actually applying the ×1.07
CTL markup to that field (only the independently-computed header
`ctl_total` is correctly marked up). The view now recomputes each row via
the same `computeCtlTotal()` the add/edit screen and PDF already use, from
the row's own (correct) stored `price` — the stored `ctl_items`/`ctl_total`
quirk itself is untouched, per the task's "display only" rule.

**VAT model**: confirmed numerically, no formula or stored-value change.
Every line's final price is VAT-inclusive by construction (ticked stock
lines add 7% once; unticked lines are already VAT-inclusive at the master
price) — the screen/PDF `totalExcVat`/`vat` back-calculation from the
grand total remains valid. Import tax is the one component stored
VAT-free; see the report for the exact overstatement this causes in the
displayed VAT on a quotation that includes it.

Files changed: `ems-backend/.../quotations/quotation-build.util.ts`,
`quotations.service.ts`; `quotations/frontend/src/App.tsx`,
`pages/QuotationView.tsx`, `pages/QuotationList.tsx`. No schema change, no
`ems-frontend`/`inventory_sys`/`quotations/backend` file touched.


## 15. Phase 10 — lot-level columns on external groups (backend only)

`sales.quotation_external_groups` gained three nullable columns the user
added directly (`shipping_cost_fc`, `import_tax_percent`, `transfer_fee` —
see `PROGRESS_LOG.md`'s "Quotations lot columns (backend)" for the full
schema/field detail). `ems-backend`'s `sales/quotations` module now
accepts, stores, and returns all three (DTO + `create()`/`replace()` only —
no calculation); `quotations/frontend` does not send them yet (a later
task).


## 14. Phase 9 — VAT tick removed (ems mode), currency buffer, round-up-to-10 (Excel parity)

Driven by `claude_prompt.txt` (2026-10-12): three Excel-`QT_Maker`-parity
fixes, **frontend-only** (`quotations/frontend`; `ems-backend`,
`quotations/backend` not touched — the survey found no backend gap, see
below). Legacy mode (`VITE_API_MODE=legacy`) is untouched throughout.

1. **Stock-line VAT tick removed (ems mode only).** The team confirmed
   every stock item's master selling price already includes VAT. In ems
   mode, `handleStockSelect` (`App.tsx`) now picks the line at the master
   price exactly (no ×1.07), the "Incl. VAT 7%" column disappears from the
   table, and new lines record `priceIncludesVat: false`. Legacy mode is
   byte-for-byte unchanged: checkbox, column, and the ×1.07-at-pick-time
   default all still there. **Survey finding (reported, not a defect to
   fix here):** `ems-backend`'s `quotation-build.util.ts`/
   `quotations.service.ts` already thread `priceIncludesVat` through to
   `quotation_lines.price_includes_vat` correctly on both `create()` and
   `replace()` (confirmed by reading; matches §9's existing "Ems-backend-
   created quotations round-trip correctly" note) — so no backend change
   was needed for "preserve the stored value on an unmodified line."
   Nothing anywhere computes `unitPrice`/totals server-side (pure
   pass-through in both `create`/`replace`), so the edit-load safety
   property (stored prices never recomputed on open) holds by
   construction, confirmed by reading both paths in full, not assumed.
2. **5.5% currency buffer, magnitude-aware rounding**
   (`services/exchangeRate.ts`): `applyCurrencyBuffer` now rounds the
   buffered rate to 1 decimal when it's ≥ 1, or 4 decimals when it's < 1
   (a sub-1 rate, e.g. a JPY/KRW-size one, would be destroyed by 1-decimal
   rounding — today's 6-currency dropdown (THB/EUR/USD/SGD/AUD/GBP) never
   actually hits the <1 branch, but the helper is correct/general per the
   task's own JPY vector). The bank-rate UI line now reads "Bank `<raw>` +
   5.5% buffer = `<effective>` · rate of `<date>`" instead of just the
   date/source. `ResolvedRate` gained a `rawRate` field for this label.
3. **Round-up-to-10 made decimal-safe**: `calculateSellingPrice` moved
   from `ExternalPartForm.tsx` into `utils/externalPartsAllocation.ts`
   (exported, matching that file's own "framework-independent, unit-
   testable" charter) and now rounds via integer THB-cents
   (`Math.round(priceWithVat * 100)` before the ceil-divide) instead of
   raw float division, so a value that's an exact multiple of 10 can no
   longer jump to the next 10 from float noise.

New test files: `utils/calculateSellingPrice.test.ts` (6 tests, including
the task's own USD/THB vectors and an explicit float-noise exact-multiple
case) and 2 new cases added to `services/exchangeRate.test.ts` (the JPY
sub-1 vector, the `rawRate` field) — 8 tests there total. Full numbers and
verification status: `PROGRESS_LOG.md`, "Quotations: VAT tick removed,
buffer, round-up 10".

## 1. What "cutover" means here

`quotations/frontend` already runs against either backend, selected entirely
by one env var (`VITE_API_MODE`), no code change required to switch:

| | `legacy` (today, default) | `ems` (the target) |
|---|---|---|
| Backend | `quotations/backend` (Express, :4500, no auth) | `ems-backend` (`apps/ems-api`, :3000, JWT auth) |
| Frontend base URL | `VITE_API_URL` (default `http://localhost:4500/api/inventory`) | `VITE_EMS_API_URL` (default `http://localhost:3000`) + `/api/v1/ems` prefix, added automatically |
| Auth | none | login screen, `Authorization: Bearer <token>` on every call |
| Permissions | none enforced | `sales.read`/`create`/`update`/`delete` via RBAC |

## 2. Exact env values

**`quotations/frontend/.env`** (both modes read the Firebase keys already present; only these two lines change) -- **current (post-cutover) state**:

```
VITE_API_MODE=ems
VITE_EMS_API_URL=http://localhost:3000

VITE_API_URL=http://localhost:4500/api/inventory
```

`VITE_API_URL` is legacy-mode-only and ignored while `VITE_API_MODE=ems` is
in effect; it is kept pointed at the correct legacy address (not at
`ems-backend`) specifically so an accidental or deliberate rollback to
`VITE_API_MODE=legacy` works immediately without also having to fix this
line -- see the Phase 6 root-cause note above for what goes wrong when
these two are set inconsistently.

To roll back to legacy:

```
# VITE_API_MODE=ems          <- comment out or delete
# VITE_EMS_API_URL=http://localhost:3000

VITE_API_URL=http://localhost:4500/api/inventory
```

**`ems-backend/.env`** (already configured for live use, unchanged by cutover):

```
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=1234
DB_DATABASE=cirrus_db
PORT=3000
```

**`quotations/backend/.env`** (unchanged, kept running through and after cutover for rollback):

```
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=1234
DB_DATABASE=cirrus_db
DEFAULT_USER_ID=28197f0c-d664-4b62-a340-65ea74d9a384
```

## 3. Start commands and ports

| App | Directory | Command | Port |
|---|---|---|---|
| `ems-backend` | `ems-backend/` | `npm run start` (or `start:dev` for file-watch) | `3000` |
| `quotations/frontend` | `quotations/frontend/` | `npm run dev` (Vite) | `5000` (`vite.config.ts` sets this explicitly -- not the Vite default of 5173) |
| `quotations/backend` (kept running for rollback) | `quotations/backend/` | `node index.js` | `4500` |

All three can run simultaneously on the user's machine today (confirmed —
`:3000`/`:4500` were both observed live and independently running across
Phases 0–4). No port conflicts between them.

## 4. How to log in (ems mode only)

Legacy mode has no login — the app loads straight to the quotation list.
Ems mode shows a login screen first; use a real `core.users` account that
holds `sales.read` (at minimum) via its role — today that's **Admin**
(`admin@cirrus.local`), either **Manager** (`manager@cirrus.local`,
`nattapong.w@cirrus.local`), or **Accountant** (`kanokwan.t@cirrus.local`).
None of the 8 live **Staff** accounts can do anything useful post-cutover
until/unless the grant in §6.1 below is applied. The token is kept in
`sessionStorage` (survives a reload, cleared on logout or a `401`).

## 5. Cutover steps (in order) -- COMPLETED Phase 6

Steps 1-7 below are now done (`.env` flipped, login-bug fixed and verified,
smoke-tested against a scratch DB in lieu of writing to live `cirrus_db` --
see PROGRESS_LOG.md's Phase 6 report for why). Steps 2-3 (Staff access
grant, DELETE/lines guards) remain **not applied** -- still the user's call,
SQL/diffs are written and waiting (§10). Kept here as the historical
procedure / for any future re-cutover:

1. **Backup the live DB** — `pg_dump cirrus_db` (or the user's existing
   backup routine, used throughout this project under `database/backups/`)
   to a timestamped file, before touching anything.
2. **Decide and apply Staff access** (optional, §6.1) — only if the user
   wants Staff users to use the quotations screen post-cutover. Review the
   exact SQL there first; it is not applied by this document.
3. **Decide on the DELETE / quotation-lines guard** (optional, §6.2) — only
   if the user wants the existing gaps closed before go-live. Also not
   applied here.
4. Set `VITE_API_MODE=ems` and `VITE_EMS_API_URL=http://localhost:3000` in
   `quotations/frontend/.env`.
5. Rebuild the frontend: `npm run build` (or just restart `npm run dev` for
   a dev-server cutover — Vite picks up `.env` changes on restart only, not
   hot-reload).
6. **Smoke test**, in this order, as a real user with `sales.read/create`:
   - List loads (`GET /sales/quotations`, confirms auth + list route).
   - Create a quotation with at least one stock line (confirms the create
     path, numbering, and totals).
   - Change its status to `sent` (confirms the status route).
   - Open it again and re-save (confirms idempotence — Phase 5 §1 already
     proved this holds for every line type at the API level).
   - Export its PDF (confirms the PDF path still works unchanged — it reads
     the same in-memory state regardless of which backend supplied it).
7. Tell users to hard-refresh / re-open the app (picks up the new build).

## 6. Rollback

Flip `VITE_API_MODE` back to `legacy` (or delete the line) in
`quotations/frontend/.env`, rebuild/restart. `quotations/backend` on `:4500`
was never stopped, so this is a same-second revert — no data migration needed
either way, since both backends have been reading/writing the **same**
`cirrus_db` tables (`sales.quotations` etc.) all along; nothing needs to be
copied back. Any quotation created in `ems` mode remains visible in `legacy`
mode after rollback (and vice versa) because both backends share one schema.

## 7. What to watch in the first few days

- **`sales.quotations` row count and `max(updated_at)`** — should only grow,
  never jump backward. (Watched this way throughout Phases 0–4 already.)
- **403s in ems-backend's own logs** — a spike means a role is missing a
  permission that was expected to be there; cross-check against §6.1.
- **The VAT-compounding checkbox state on reload** (Phase 4 finding) — ems
  mode round-trips `price_includes_vat` correctly; legacy mode does not
  (documented limitation below) — if a user reports a stock line's VAT
  checkbox "resetting," that's expected only in legacy mode, not ems mode.
- **PDF exports with Thai text** — known-broken in both modes (§6.3), not a
  regression from cutover.

## 8. Retirement of `quotations/backend` -- DONE (Phase 6)

The user explicitly ordered the cutover and retirement. `quotations/backend`
is **not deleted** (no git history of its own -- it's the only copy) and
**not modified**; see `quotations/backend/RETIRED.md` for the full
rollback procedure. It was not running at the time of retirement (confirmed:
no process bound to `:4500`), so nothing needed to be stopped.

Grep across `ems-frontend`, `inventory_sys` (backend + frontend),
`quotations/frontend`, and package scripts for `:4500` /
`/api/inventory/quotations` / `quotations/backend` (Phase 6, read-only,
`ems-frontend`/`inventory_sys` not edited):

- **`ems-frontend`**: zero hits -- never referenced `quotations/backend` or
  port 4500 at all.
- **`inventory_sys/backend/src/main.ts:27`**: `await app.listen(process.env.PORT ?? 4500)`
  -- `inventory_sys/backend` defaults to the **same port**, 4500. This is
  the port clash `RETIRED.md` warns about; not a quotations reference, but
  the reason the two must never both run on their default ports.
- **`inventory_sys/frontend/src/api/client.ts:17`**: hardcoded
  `http://localhost:4500/api/inventory` -- but that file's own comment
  (line 4) already states it has "ZERO real callers left"; dead code, not
  touched (per the task's instruction not to edit `inventory_sys`).
- **`inventory_sys/inventory_System.md`**: several historical mentions of
  `:4500` -- all describing `inventory_sys`'s own backend (which also
  happens to default to 4500), not `quotations/backend`; no action needed.
- **`quotations/frontend/.env.example`**, **`services/api.ts` comments**:
  intentional -- document the legacy rollback path, per this task's own
  instruction to keep the legacy code path reversible. Not changed.
- **`quotations/frontend/src/AppTemp.tsx`**: three hardcoded `:4500` fetch
  calls -- this file is dead/unused scratch code, not imported by
  `main.tsx`/`App.tsx` (confirmed: the app's only entry point is `App.tsx`).
  It already fails `tsc -b` with unrelated pre-existing type errors (see
  PROGRESS_LOG.md's Phase 6 report) and was out of this task's scope to
  fix; left as-is.

No reference to `quotations/backend` or its API shape exists anywhere in
`ems-frontend`, `inventory_sys`, or any build/start script outside
`quotations/frontend` itself.

## 9. Known limitations (carried into cutover)

**Phase 7 update**: "Edit always creates a new row" is fixed — ems mode now
`PUT`s in place (same id/number/status/sent_at/accepted_at/created_by/
created_at) when editing a saved quotation; a brand-new quotation still
`POST`s. Legacy mode is untouched (still always `POST`s; `quotations/backend`
is retired, not extended). `DELETE`-in-any-status is **not** guarded, per the
user's own explicit decision this phase (they delete rows at DB level, so no
app-level guard was added) — kept in the list below as a deliberate choice,
not an oversight.

- **Old unticked-VAT lines read as ticked**: any quotation saved before the
  Phase 4 VAT fix, when reloaded, shows every stock-line VAT checkbox as
  checked regardless of what was actually saved (legacy backend never
  persisted the flag). Ems-backend-created quotations round-trip correctly
  going forward; this only affects historical legacy-mode data.
- **Thai text in PDF exports renders as missing glyphs** — `generateQuotationPDF.ts`
  uses only jsPDF's built-in `helvetica` font, which cannot encode Thai
  Unicode at all. Same in both modes. See §6.3 for the fix proposal (not
  implemented).
- **`DELETE` is allowed on quotations in any status**, including `sent` and
  `accepted` — reconfirmed live in Phase 5 (§2 below, and the error-table in
  the main report). See §6.2 for the smallest fix if the user wants it
  before cutover.
- **Direct `/sales/quotation-lines` writes bypass header totals** — adding
  or removing a line through that route directly does not recompute
  `sales.quotations.subtotal`/`parts_subtotal`. The real frontend never
  calls this route (confirmed again this phase), so it's a latent risk, not
  an active bug, unless something else starts calling it.

## 10. The three Phase-5 decision proposals, in full

### 10.1 Staff access grant -- SQL written, NOT applied (Phase 6 refines this)

**Phase 6 traced the actual guard behavior** (this is the task's own
"office-staff access" requirement, since the user has now ordered that
office-role staff must be able to use quotations):
`PermissionGuard.canActivate` (`ems-backend/apps/ems-api/src/modules/auth/guards/permission.guard.ts:40-53`)
runs a second, additive check after the role/permission check: for any
permission whose `core.permissions.domain` is not `'shared'`, it loads the
caller's `hr.team_members.access_scope` and throws 403 unless that scope is
`'hybrid'` or exactly `'<domain>_only'`. Confirmed live (read-only query):
**every `sales.*` permission has `domain = 'office'`**. So **the guard
already gates `sales.*` by access_scope** -- a `field_only` user granted
`sales.read/create/update` via a role is still blocked by this second check.
Branch chosen (per the task's own decision tree): grant the three
permissions to the `Staff` role directly; no new role or user reassignment
needed, since the guard itself keeps field-only Staff out. SQL:
`scripts/grant_office_sales_access.sql` (idempotent, `BEGIN...ROLLBACK`
default, verification SELECTs, one-line rollback) -- **not executed**, per
this task's rule that permission/role changes are SQL-for-the-user-to-run,
not applied directly.

Live, read-only query re-run in Phase 6 (2026-10-09, current `cirrus_db`
state -- supersedes Phase 5's count): **11** active Staff-role accounts
today, not 8 -- 3 new active Staff-role test accounts ("Test Visibility
A/B/C") exist now that didn't in Phase 5. The **Staff** role
(`id = ad8c119e-b5cc-425e-b688-9dab3e1079ca`) still holds none of the three
sales permissions.

- **Gains REAL sales access** (`access_scope = 'office_only'`, 4 users):
  `kittipong.s@cirrus.local`, `suchada.m@cirrus.local` (Suchada Meesuk),
  `waraporn.s@cirrus.local` (Waraporn Srisuk), "Test Visibility C (Office,
  non-technician)".
- **Stays BLOCKED by the guard's access_scope check** (`access_scope =
  'field_only'`, 7 users): `anong.p@cirrus.local`, `decha.r@cirrus.local`,
  `malee.b@cirrus.local`, `prasert.c@cirrus.local`, `somchai.j@cirrus.local`
  (Somchai Jaidee), "Test Visibility A", "Test Visibility B" -- gains the
  `role_permissions` row but the guard's second check still 403s them.

The original 8 users named in Phase 5 keep the same field/office split
Phase 5 found; the 3 "Test Visibility" accounts are new and were not part
of that count.

**Grant** (idempotent — safe to re-run):

```sql
INSERT INTO core.role_permissions (role_id, permission_id)
SELECT 'ad8c119e-b5cc-425e-b688-9dab3e1079ca', p.id
FROM core.permissions p
WHERE p.code IN ('sales.read', 'sales.create', 'sales.update')
ON CONFLICT DO NOTHING;
```

(No `sales.delete`/`sales.export`/`sales.approve` — matches the task's own
scope: "grant sales.read, sales.create, sales.update (no delete/export/approve)".)

**Rollback** (one line):

```sql
DELETE FROM core.role_permissions
WHERE role_id = 'ad8c119e-b5cc-425e-b688-9dab3e1079ca'
  AND permission_id IN (
    SELECT id FROM core.permissions WHERE code IN ('sales.read','sales.create','sales.update')
  );
```

### 10.2 DELETE and quotation-lines write guards (NOT applied — code diff proposal only)

Both findings reconfirmed live this phase (Phase 5 §2): deleting a `sent`
quotation still succeeds (`204`, fully gone); a direct
`POST`/`DELETE /sales/quotation-lines` still bypasses the parent's totals.
Smallest fix for each, as a diff (not written to the real files):

**a) Block DELETE unless `draft`** — `quotations.controller.ts`:

```diff
   @UseGuards(JwtAuthGuard, PermissionGuard)
   @RequirePermission('sales.delete')
   @Delete(UUID_PARAM)
   @HttpCode(204)
   async remove(@Param('id') id: string) {
     const existing = await this.service.findOne(id);
     if (!existing) throw new NotFoundException(`Quotation ${id} not found`);
+    if (existing.status !== 'draft') {
+      throw new BadRequestException({ error: 'Only draft quotations can be deleted' });
+    }
     await this.service.remove(id);
   }
```

**b) Block quotation-line writes unless the parent is `draft`** —
`quotation-lines.controller.ts`'s `create`/`update`/`remove`, each needs the
parent quotation's status checked before proceeding. Smallest shared shape
(illustrative, one of the three shown — same pattern for all three):

```diff
   @UseGuards(JwtAuthGuard, PermissionGuard)
   @RequirePermission('sales.create')
   @Post()
-  create(@Body() dto: CreateQuotationLineDto) {
-    return this.service.create(dto);
+  async create(@Body() dto: CreateQuotationLineDto) {
+    const parent = await this.quotationService.findOne(dto.quotationId);
+    if (!parent) throw new NotFoundException(`Quotation ${dto.quotationId} not found`);
+    if (parent.status !== 'draft') {
+      throw new BadRequestException({ error: 'Lines can only be changed while the quotation is draft' });
+    }
+    return this.service.create(dto);
   }
```

(Needs `QuotationLineController` to take a `QuotationService` dependency it
doesn't have today — a small, same-module wiring change, not shown in full.)

Neither diff is applied. This is a business-rule decision (should a sent
quotation ever be un-sendable by deleting it; should the unused direct
line-write routes be locked down or left as dead code) that the user should
make, not infer from a test phase.

### 10.3 Thai text in PDF exports (NOT implemented — proposal only)

Confirmed again this phase (same as Phase 4): `quotations/frontend/src/utils/generateQuotationPDF.ts`
uses only jsPDF's built-in `helvetica` font everywhere; jsPDF's standard
fonts have no Thai glyphs at all, so any Thai text anywhere in a quotation
(customer name, notes, part names, supplier names — all exercised live in
Phase 5's scenario (f)) renders as missing/blank glyphs in the exported PDF,
in both legacy and ems mode identically — this is not a cutover regression.

**Proposed fix**: embed a Thai-capable OFL-licensed TTF (Noto Sans Thai or
Sarabun are the two commonly used free options) via jsPDF's `addFont()` API,
and switch every `doc.setFont('helvetica', ...)` call in that file to the
new font name instead. Files involved: `generateQuotationPDF.ts` only (the
font-loading + every `setFont` call site); the font file itself would need
to ship as a base64-embedded `.ts` module (jsPDF's documented pattern for
custom fonts) or be fetched at runtime — the former is simpler but adds
roughly 200–400KB to the bundle (a Thai TTF subset is not small); the latter
avoids the bundle cost but adds a network dependency to PDF generation that
doesn't exist today. Layout widths would also need re-checking: Thai text
measured with a Latin font's metrics (today's `helvetica`) does not reflect
the real glyph widths of a Thai font, so column widths/wrapping in the PDF
template may need adjustment once real Thai glyphs render. Not implemented
here, per the task's explicit instruction.

## 11. ems-frontend entry point + single sign-on (Phase 8)

Ordered by the user: the Quotations nav entry in `ems-frontend` (previously
`functional: false`, did nothing) now opens `quotations/frontend` with a
token handoff so logging in once, in `ems-frontend`, is enough.

**How it works**: `ems-frontend`'s session (`ems.authToken` in
`localStorage`, no refresh token, 24h JWT expiry — same `ems-backend`
`/auth/login`) is unaffected. Clicking **Quotations**
(`ems-frontend/src/components/layout/nav-config.ts`, now
`functional: true, external: true`) does a same-tab, full-page navigation
(`AppLayout.tsx`'s `item.external` branch — a plain `<a>`, not a
react-router `<Link>`, since `<Link to>` can't cross origins) to
`VITE_QUOTATIONS_URL` (default `http://localhost:5000`) with the current
access token appended as `#sso=<token>` — a URL **fragment**, never a query
string, so it's never sent to any server or logged. `quotations/frontend`
(`src/services/api.ts`, ems mode only) reads that fragment once at module
load, stores the token exactly as a normal login would (memory +
`sessionStorage`), and strips the fragment immediately via
`history.replaceState` — before React's first render. No fragment (opening
`:5000` directly) falls through unchanged to today's own login screen. An
invalid/expired token needs no new handling: the existing 401 →
`setToken(null)` + `unauthorizedHandler()` machinery (Phase 4) already bounces
back to the login screen with no loop. A "Back to Cirrus" link and the
existing "Log out" button (both in `App.tsx`'s header, the only place logout
already lived) now also navigate to `VITE_EMS_FRONTEND_URL` (default
`http://localhost:5174`).

**New env vars**: `ems-frontend/.env`/`.env.example` — `VITE_QUOTATIONS_URL`
(default `http://localhost:5000`); `quotations/frontend/.env`/`.env.example`
— `VITE_EMS_FRONTEND_URL` (default `http://localhost:5174`). Both dev servers
need a restart to pick these up (Vite only reads `.env` at startup).

**ems-backend**: no change needed or made — `app.enableCors()` (`main.ts:12`)
has no origin restriction, so a `fetch` from `:5000` carrying
`Authorization: Bearer <token>` already works exactly as it does from
`ems-frontend`'s own origin; confirmed live, not just read.

**Permission behavior**: `ems-frontend` has never gated nav-item visibility
by permission (confirmed in `nav-config.ts`'s own existing comment — it's a
stated, deliberate design choice, not an oversight) — so per the task's own
fallback instruction, the Quotations entry stays visible to everyone,
unconditionally. A user without `sales.read` sees the existing friendly
"Missing permission: sales.read" message in `quotations/frontend` (on the
List page specifically — the create page's own initial load only fetches
projects, whose failure is silently console-only by design since Phase 4),
never a login loop.

**Residual risk** (stated per the task's own instruction, not fixed): once
handed off, the token is readable by any script running on the
`quotations/frontend` page for the rest of that session — identical exposure
to a normal direct login there, not a new risk introduced by this handoff.

**Files changed**: `ems-frontend/src/components/layout/nav-config.ts` (added
`external?: boolean` to `NavItem`, Quotations entry now
`functional: true, external: true`), `ems-frontend/src/components/layout/AppLayout.tsx`
(renders `item.external` entries as a token-carrying same-tab navigation
instead of a `<Link>`), `ems-frontend/.env`/`.env.example`;
`quotations/frontend/src/services/api.ts` (SSO fragment consumption,
`EMS_FRONTEND_URL` export), `quotations/frontend/src/App.tsx` ("Back to
Cirrus" link, logout redirect), `quotations/frontend/.env`/`.env.example`.
`inventory_sys`, `quotations/backend`, `ems-backend` untouched. Developed in
scratchpad copies of both frontends, type-checked and e2e-verified there
first, copied over in one step once clean.

**Verified** (scratch DB `cirrus_phase8`, scratch `ems-backend` on `:3001`,
scratch copies of both frontends on `:5174`/`:5098`, Playwright — DOM text +
network assertions only):

| # | Check | Result |
|---|---|---|
| 1 | both apps `tsc -b`, `npm run dev` | ems-frontend: 1 pre-existing, unrelated error (`TechnicianReportForm.tsx`, a `workType` enum drift from `schema_dump_20`'s new `operations.work_nature` values — present before this phase too, confirmed on the untouched real repo; zero new errors). quotations/frontend: the same 25 pre-existing dead-file errors documented since Phase 4, zero new. Both `npm run dev` boot clean. |
| 2 | login once in ems-frontend → click Quotations → lands on :5098 authenticated | list loads, no login screen, no `#sso` fragment left in the address bar, `sessionStorage` has the token, network confirms the token only as an `Authorization` header to the backend, never in a URL. Reload → still logged in. 11/11 passed. |
| 3 | open the quotations app directly, no fragment | its own login screen, as before. Passed. |
| 4 | invalid/expired token in the fragment | falls back to the login screen, confirmed no loop (stays there, no bounce). Passed. |
| 5 | unprivileged (no `sales.read`) user via the fragment | "Missing permission: sales.read" on the List page, no loop. Passed. |
| 6 | "Back to Cirrus" + logout | both navigate to `VITE_EMS_FRONTEND_URL`; logout's `sessionStorage.removeItem` is the same `setToken(null)` call path every prior phase's logout already exercises (verified by code read — a same-tab cross-origin navigation destroys the page's JS realm essentially the instant it starts, so it can't be asserted as a live DOM/network check without the assertion itself becoming the flaky part). |
| 7 | network audit of the full handoff | token never appeared in any request URL; appeared as `Authorization: Bearer <token>` on every authenticated backend call. Passed. |

33/33 scripted checks passed overall (17 quotations/frontend-only SSO checks + 11 full ems-frontend→quotations flow checks + 5 network-audit checks). Live `cirrus_db` confirmed untouched throughout (`sales.quotations` count still 22). The user's real `:3000`/`:5000` processes were never stopped or restarted; the real `ems-frontend` dev server was not running at any point this phase.

**User must do by hand**: restart both `ems-frontend`'s and `quotations/frontend`'s dev servers to pick up the new `.env` entries (`VITE_QUOTATIONS_URL`, `VITE_EMS_FRONTEND_URL`) — the `quotations/frontend` source changes themselves already hot-reloaded into the live `:5000` instance via Vite HMR, but the new env var won't take effect until that restart; for any non-local deployment, set `VITE_QUOTATIONS_URL`/`VITE_EMS_FRONTEND_URL` to the real hostnames instead of the `localhost` defaults.

**Not verified**: on-screen visual polish of the new "Back to Cirrus" link/button styling (no screenshot tool, per the task's own rule); the real `ems-frontend` production bundle (`vite build`) beyond `tsc -b` — `tsc -b` passing with only the one pre-existing unrelated error is a strong signal but `vite build` itself wasn't separately run this phase.

## 12. Where clients come from (quotations client picker)

In ems mode, the customer field lists real `crm.clients` directly (`GET /sales/quotations/clients`, `sales.read`-gated — no `crm.read` needed) rather than only the clients of already-loaded projects, so a client with no project yet can still be quoted; clients themselves are still only ever **created** in `ems-frontend`'s Clients page (v151) — there is no "new client" UI in `quotations/frontend`.

## 13. Exchange-rate dependency (external parts, ems mode)

The external-part form's currency/exchange-rate fields auto-fill from `ems-backend`'s `GET /exchange-rate` (ems mode only, `quotations/frontend/src/services/exchangeRate.ts`) — an unauthenticated, unguarded route today that itself calls the real SCB bank site live on every request (no caching server-side); if that upstream is ever slow/down, the UI falls back to a readable error and an empty, still-editable, manually-typeable rate field, never blocking the rest of the form.

The reference date picked (or the bank's actual `effectiveDate`, when fetched) is now persisted on save, in `sales.quotation_external_groups.exchange_rate_date` — a plain nullable `date` column that existed since `schema_dump_17.sql` but was unwired until this phase; view/edit show "Rate: `<value>` (as of `<date>`)" from the stored value only, never re-fetching. No column exists yet for the rate *type* or *source* ("Notes sell" / "SCB") — those still only show on a fresh fetch, not after reload; see `PROGRESS_LOG.md`'s "Quotations rate date and view VAT" entry for the exact gap if that's ever wanted.
