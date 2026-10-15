# quotations/backend — RETIRED

As of the Phase 6 cutover, this backend is **superseded by `ems-backend`**
(`apps/ems-api`, port `3000`, `/api/v1/ems/sales/quotations`). The user has
explicitly ordered the cutover and retirement. `quotations/frontend` now
defaults to `VITE_API_MODE=ems` (see `quotations/frontend/.env` and
`quotations/CUTOVER.md`) and no longer points at this backend by default.

**This code is not deleted.** It is the only copy (no git history of its
own) and is kept exactly as-is for rollback. Nothing in this directory was
modified by the cutover.

## Do not start this alongside `inventory_sys`

`inventory_sys/backend` also listens on port **4500** by default
(`inventory_sys/backend/src/main.ts:27`,
`await app.listen(process.env.PORT ?? 4500)`). Starting `quotations/backend`
(`node index.js`, also port 4500 by default) while `inventory_sys/backend`
is already running on 4500 will fail to bind (or vice versa, whichever
starts second). They are mutually exclusive on the default port — only
start one of the two on 4500 at a time, or override one's port via `PORT`.

## How to roll back to this backend

1. Start it: `cd quotations/backend && node index.js` (reads its own
   `.env` — `DB_HOST`/`DB_PORT`/`DB_USERNAME`/`DB_PASSWORD`/`DB_DATABASE`/
   `DEFAULT_USER_ID`, unchanged by the cutover). Confirm port 4500 is free
   first (see above).
2. In `quotations/frontend/.env`, set `VITE_API_MODE=legacy` (or delete/
   comment out the line) and confirm `VITE_API_URL=http://localhost:4500/api/inventory`.
3. Restart the frontend dev server (`npm run dev` -- Vite only re-reads
   `.env` on startup, not hot-reload) or rebuild (`npm run build`).
4. The app goes back to legacy mode immediately: no login screen, same
   `:4500` API it always used. No data migration is needed in either
   direction -- both backends read/write the same `cirrus_db` tables
   (`sales.quotations` etc.), confirmed throughout Phases 0-6.

See `quotations/CUTOVER.md` for the full rollback runbook and the known
limitations that carry over regardless of which backend is active.
