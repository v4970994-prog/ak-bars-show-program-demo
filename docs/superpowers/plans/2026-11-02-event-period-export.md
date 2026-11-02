# Event export by period

**Goal:** SKP coordinators can download an Excel list of events for an inclusive date range, filtered to all events, matches, or other events, with an optional match team.

**Architecture:** Add a read-only authenticated endpoint in the existing Worker and a calendar export dialog using the existing ExcelJS loader and file-saving helper. Use stored events from the active season, including past events. Do not depend on the visible calendar list or its search. No schema change.

**Spec:** User request of 2026-11-02: add event export for SKP coordinators, with period selection and match/event filtering.

## Global constraints

- Active customer users with roles `owner` or `coordinator` only; enforce on the server and in the UI, including linked identities.
- Moscow calendar dates, both boundaries inclusive. Ignore deleted events and other seasons. Show the season and filters in the dialog and workbook.
- Existing approvals, notifications, imports, permissions and mobile layout remain intact. No real messages or production-data mutation during verification.
- Excel contains dates/time, event type, team, title, venue, address, contact, telephone, contractor responsible and comment. User strings stay text, not formulas.

## Review focus

Check active-season scope is visible; no fallback to embedded historical matches; export uses fresh data; form busy/error states recover; role revocation is enforced even if the dialog was already open. Check sorting, inclusive end date, Excel date types and long text.

## Task 1: Endpoint

Files: `worker/src/worker.js`, `worker/test/events-export-fixture.cjs`, `worker/test/events-export.cjs`.

Produces `POST /api/events/export` with `{from,to,type,team}` and response `{ok,season,filters,events}`. `type`: `all|matches|other`; `team`: `all|ak-bars|bars|irbis`, specific team only with matches.

- [x] Add real Worker/SQLite tests for authorization, date validation, filtering, sorting, deletion and season isolation. Run and observe failure for the absent endpoint.
- [x] Add validation and bounded parameterized query; return only export fields. Run the endpoint tests and existing backend suite.

## Task 2: Calendar dialog and Excel

Files: `worker/src/worker.js`, `worker/test/events-export-ui.cjs`, `worker/package.json`, `worker/README.md`.

Consumes Task 1 response. Reuses `ensureExcelLibrary('exceljs')` and `saveExcelFile`.

- [x] Add browser test for coordinator entry point and actual XLSX download; observe missing UI fail.
- [x] Add accessible dialog: current Moscow month default, inclusive date inputs, type/team filters, no-results/error feedback, loading state. Fetch before building the workbook; preserve filters between openings.
- [x] Build sortable, filtered workbook with typed dates/time, phone text, wrapped headers and frozen row. Validate the downloaded workbook, not an imitation of the writer.
- [x] Verify desktop/mobile, non-coordinator visibility, stale-role denial, keyboard dismissal/focus restoration, and existing UI tests. Inspect screenshot.
- [x] Update build/version and documentation.
- [ ] Review diff, commit, publish through the existing repository workflow, and verify the production Cloudflare build.

## Verification record

- Endpoint test first failed with 404 for the absent route, then passed against the real Worker and SQLite.
- Browser test first failed for the absent export button, then passed with a real downloaded XLSX.
- Full `npm test` and all seven `npm run test:ui` scripts passed with Chromium. The workbook reader interprets formatted time serials as Date objects; assertions check their time values.
