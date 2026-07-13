# HAR Analysis — origination-dev.scoular.com

**Source file:** `/home/khague/ghe/origination-dev.scoular.com.har` (75 MB, 949 entries)
**Session window:** 2026-07-13 02:42:16.541Z → 02:48:47.200Z (~6m 31s wall clock)
**Entries:** 949 total — 427 under `/api/*`, 522 other (458 images, 43 scripts, 5 documents, 5 stylesheets, 4 fonts, misc.)
**Status codes:** 200×606, 0×274 (net errors/aborts — mostly cancelled map tiles), 202×49 (async click-event), 204×12, 500×8

Supporting scripts and raw output lived in the analysis session's scratchpad (not preserved);
re-derivable from the source HAR if needed.

> **ERRATA (added on review):** this report's claim that `/api/notes` is served **uncompressed**
> (`compression: 0`, §1 and §8.1) is **wrong**. Direct inspection of the HAR response headers shows
> `content-encoding: br` on every `/api/notes` response — the HAR records `bodySize: -1` under
> HTTP/2, which made the computed `compression` field read as zero. The 31,618,680-byte figure is
> the **decompressed** size; wire size is unrecorded but consistent with the ~11.3 MB previously
> observed for this endpoint. The timing conclusions stand unchanged (server wait < 930 ms; the
> 23–44 s is transfer/streaming of an oversized payload) — but the fix is payload elimination
> (pass `tradeUnits`, paginate), **not** enabling compression, which is already active.

---

## 1. Headline finding: `/api/notes` is the dominant cost center

`/api/notes` was called **5 times** in this session. Every single call returned the exact same
**31,618,680 bytes (30.2 MB) uncompressed**, and every call is on the "everything, every time" fetch
path (fired unconditionally as part of the initial customer/tradeUnit load, not a filtered query).

| idx | started | total time | wait (server) | receive (transfer) | size |
|---|---|---|---|---|---|
| 56  | 02:42:24.617Z | 26,873.9 ms | 926.5 ms | 25,916.0 ms | 31,618,680 B |
| 89  | 02:43:10.873Z | 29,965.3 ms | 804.7 ms  | 29,150.7 ms | 31,618,680 B |
| 356 | 02:45:30.364Z | 26,147.1 ms | 844.2 ms  | 25,221.1 ms | 31,618,680 B |
| 380 | 02:46:04.739Z | **43,675.6 ms** | 887.1 ms | **42,765.6 ms** | 31,618,680 B |
| 919 | 02:48:30.109Z | 23,544.9 ms | 653.2 ms  | 22,883.7 ms | 31,618,680 B |

Key point: **server "wait" time is always under ~930 ms** — the API itself responds fast. Nearly
all of the 23–44 seconds is **`receive` (client-side transfer of the response body)**, i.e. the
browser is stuck downloading an uncompressed 30 MB JSON blob with `compression: 0` (no gzip/br —
confirmed via `content.compression` being absent/0 on every occurrence in the HAR). This is the
single largest problem in the whole capture and fully explains user complaints about "notes is
slow" — it isn't a query performance problem, it's a **transfer-size problem**: this endpoint has no
server-side compression and (going by the constant byte count) no pagination/filtering by customer
or trade unit — the full notes table is shipped on every page load and every customer-context
switch.

**Secondary effect — thread/connection-pool contention:** every time `/api/notes` is in flight, a
cluster of unrelated endpoints that normally return in 100–300 ms instead show 5 different
occurrences with wait times of ~3,300–5,900 ms, on requests that individually carry near-zero
payload (`/api/tickets/customer/*`, `/api/storedgrain/customer/*`, `/api/contracts/pacing/*`,
`/api/customers/linked-to/*`, `/api/commodities`, `/api/producerdetails`, `/api/dashboardplanting
estimates*`, `/api/savedlists`). Example: notes call `idx=89` runs 02:43:10.873Z→02:43:40.838Z;
inside that window, at 02:43:23.5xxZ, eight otherwise-trivial GETs each jump to ~5.0–5.9 s of **server
wait** (see `payload_and_errors.py` output, "wait > 5000ms" section). The same pattern repeats
around notes calls `idx=380` (burst ending 46:04–46:48) and `idx=919` (burst 48:27–48:53), where
`/api/commodities`, `/api/producerdetails`, `/api/contracts?tradeUnits=1028`, `/api/userpreferences`
PUTs, etc. all spike to 2.4–5.5 s. This correlation (server-side wait, not client receive, spiking
in lockstep with the notes download) points at ASP.NET Core thread-pool or DB-connection-pool
exhaustion while the huge notes response is being serialized/streamed, not a client network
artifact.

---

## 2. Full `/api/*` request table

427 `/api/*` requests span 172 distinct URL+querystring combinations. **45 requests exceeded 1
second**, of which **19 exceeded 5 seconds**. Full sorted table (all 427, descending by total time,
with blocked/dns/connect/send/wait/receive breakdown and flags) is in `api_table_output.txt`. Top of
that list, beyond the `/api/notes` rows above:

| idx | time | method/status | size | URL | wait | receive |
|---|---|---|---|---|---|---|
| 386 | 9,427.6 ms | POST 202 | 0 | `/api/usage-dashboard/click-event` | 9,418.7 | 1.8 |
| 107 | 5,884.3 ms | GET 200 | 2 | `/api/storedgrain/customer/159878` | 5,866.0 | 2.2 |
| 106 | 5,884.2 ms | GET 200 | 2 | `/api/tickets/customer/159878?scoularId=AMENAST` | 5,865.9 | 2.0 |
| 936 | 5,540.5 ms | GET 200 | 733,808 | `/api/commodities` | 3,540.9 | 1,951.5 |
| 929 | 5,375.0 ms | GET 200 | 733,808 | `/api/commodities` | 3,289.8 | 2,057.0 |
| 111 | 5,139.6 ms | GET 200 | 5,613 | `/api/notes/mention-catalog` | 5,121.5 | 10.7 |
| 924 | 5,123.3 ms | GET 200 | 397,874 | `/api/contracts?tradeUnits=1028` | 3,584.0 | 1,525.2 |
| 105/109/104/108/112 | ~5,090–5,100 ms | GET 200 | ~2 B | `/api/contracts/customer/159878`, `/api/plantingintentions/customer/159878`, `/api/contracts/pricing-lines/by-customer`, `/api/customers/linked-to/AMENAST`, `/api/contracts/pacing/159878` | ~5,075 each | ~5 each |
| 937 | 4,579.0 ms | GET 200 | 162,242 | `/api/customers?tradeUnits=1028` | 3,722.8 | 801.9 |
| 931 | 4,024.7 ms | GET 200 | 23,875 | `/api/producerdetails` | 3,734.5 | 241.8 |

All of these >1s outliers cluster tightly around the five `/api/notes` calls' active windows —
reinforcing the contention theory above — **except** `idx=386` (a lone `usage-dashboard/click-event`
POST with 9.4 s of server wait, isolated, no concurrent notes fetch nearby) and `idx=359`
(`/api/tickets?tradeUnits=1028`, 1,590 ms, wait 1,427 ms — a standalone slow tickets fetch,
523,547 B payload, not associated with a notes overlap).

**`/api/tradeUnits`-scoped requests** (query param `tradeUnits=1028` / `tradeUnits=1066`) confirm two
distinct trade units were exercised in this session — 1066 early, 1028 for the remainder — each
triggering a full refetch of `/api/contracts`, `/api/customers`, `/api/plantingintentions`,
`/api/storedgrain`, `/api/tickets`, `/api/dashboardplantingestimates` scoped to that unit.

---

## 3. Duplicate-fetch analysis

219 distinct API URL+method combinations were seen; **84 were requested more than once** in the
session (full list in `dup_output.txt`). Two distinct duplicate patterns emerge, matching the ask:

### 3a. Near-simultaneous duplicates (dual-preload-pipeline bug)

71 request pairs fired **<1.5 s apart** for the identical URL+querystring (`near_sim_out.txt`).
The clearest, most damning example is the **initial page load** itself (burst 0, see §4): at
`02:42:24.612–24.629Z` fourteen `/api/*` GETs fire for `tradeUnits=1066` context (contracts,
plantingintentions, commodities, savedlists, customers, dashboardplantingestimates, etc.), and then
**~0.5 s later, at `02:42:25.123–25.339Z`, six of those exact same URLs fire again**:
`/api/contracts?tradeUnits=1066`, `/api/plantingintentions?tradeUnits=1066`, `/api/commodities`,
`/api/savedlists`, `/api/customers?tradeUnits=1066`, plus two new `/api/dashboardplantingestimates`
calls. Both waves' `_initiator` stack traces point to the same `XHR.send` call site inside the same
app chunk (`chunk-5I...`), confirming this is the app firing **two separate load pipelines** for the
same data, not two different user actions. This exact pattern (`~0.5s` gap, same six endpoints)
repeats at every trade-unit context switch in the capture (e.g. around `02:43:11.39Z`, `02:45:04.31–
04.74Z`, `02:48:35.00–35.01Z` — the last one hit while notes was also in flight, compounding into
the 4–5.5 s waits already listed in §2).

A second near-simultaneous pattern appears in the **customer-list/grid rendering** flow: for many
individual customers (`KOLLPAS`, `SCHIL`, `BROWNWR`, `BRASBR`, `ADLEWRB`, and ~25 others),
`/api/customers/linked-to/{scoularId}`, `/api/contracts/pacing/{customerId}`, and `PUT
/api/producerdetails/customer/{id}` each fire in a tight double burst (2–3 calls, 0.1–0.5 s apart) —
consistent with a grid row (or its edit-in-place control) re-rendering/re-fetching per row rather
than batching.

### 3b. Later re-fetches (legitimate trade-unit / customer-context changes)

The remaining duplicate groups are re-fetches separated by tens of seconds to minutes — these track
genuine navigation, not a bug:
- `/api/commodities` — 13 total occurrences across the whole session, spaced by the burst gaps (46s,
  113s, 58s, 86s, 18s, 21s, 19s, 7s) — refetched on every screen/tab navigation even though this is
  largely static reference data (733,808 B, unchanged size every time — a caching opportunity).
- `/api/producerdetails`, `/api/notes/mention-catalog`, `/api/dashboardplantingestimates*`,
  `/api/savedlists`, `/api/commodities/planting` show the same "re-fetched every navigation, byte-
  identical payload every time" signature — again pointing at missing client-side caching for
  reference/lookup data rather than a duplicate-fire bug.

---

## 4. Waterfall / burst analysis

Grouping by `startedDateTime` gaps >2 s yields **28 bursts** (full detail in `bursts_out.txt`).

**Burst 0 — login + initial page load** (`burst0_detail.py` has the full 91-row breakdown):
- `02:42:16.541Z` — nav starts, first `document` request to `/` immediately fails
  (`net::ERR_CONNECTION_CLOSED`, likely dev-server cold start / redirect race).
- `02:42:18.229–18.362Z` — app shell (JS/CSS) loads for the **first** time, unauthenticated.
- `02:42:19.352–22.207Z` — Microsoft Entra ID (AAD) interactive login redirect chain: `/oauth2/v2.0/
  authorize`, converged-login CSS/JS/branding assets, `OneCollector` telemetry ping, `/reprocess`.
- `02:42:23.031–23.268Z` — app shell **reloads a second time** post-redirect (identical chunk set to
  the first load — expected MSAL redirect-flow behavior, not a bug, but it does mean the JS/CSS
  payload is paid for twice per fresh login).
- `02:42:23.914Z` — `/oauth2/v2.0/token` token exchange (531 ms).
- `02:42:24.604Z` — route-specific chunk `chunk-ZAPHMM5E.js` (1,143,023 B) loads.
- `02:42:24.612Z` — **first `/api/*` call fires**, 8.07 s after nav start (dominated by the AAD
  round-trip, not app-side slowness).
- `02:42:24.612–26.197Z` — the full initial-load API burst: 14 calls fire in the first ~17 ms window,
  then the duplicate second wave described in §3a fires ~0.5 s later, then `/api/usertradeunits`,
  `/api/query-library`, and two `/api/userpreferences` PUTs close it out at `02:42:26.99Z`.
  **Every one of those completes in under ~800 ms** except `/api/notes` (`idx=56`), which keeps
  running until `02:42:51.49Z`.
- **Burst 0 doesn't end (by the >2s-gap rule) until `/api/notes` finishes** — total burst wall clock
  **34.95 s**, entirely gated by the notes call. Strip `/api/notes` out and the rest of the initial
  load (from first API call to last non-notes API call, the two `/api/userpreferences` PUTs) finishes
  in **~2.4 s** (`02:42:24.612Z→02:42:26.985Z`).
- **Time-to-last-API-response for the login/initial-load burst: 34.95 s** (nav start to notes
  completion) — or **~10.4 s if `/api/notes` is excluded**.

**Other bursts of note:**
- Burst 1 (`02:43:10.873Z`, 29.97 s, 25 API calls, 0 static) — a pure API-only burst gated again by
  `/api/notes` (`idx=89`), overlapping with the thread-pool-contention spike described in §1/§2.
- Burst 16 (`02:46:03.172Z`, **45.24 s**, 24 API calls) — the longest burst in the capture, gated by
  `/api/notes` `idx=380` at 43,675.6 ms — the single slowest notes fetch in the session.
- Burst 26 (`02:48:14.940Z`, 1.95 s, **405 non-API requests, 0 API**) — this is the map-tile burst,
  see §6.
- Burst 25 (`02:48:08.518Z`, 3.87 s, 58 total / 10 API / 48 other) — a lazy-loaded route chunk set
  (e.g. `chunk-W3MHGTNO.js`, 553,281 B) plus its data calls, consistent with navigating into the Fields
  tab / map feature for the first time in-session.

---

## 5. Payload ranking (top responses by decompressed size)

Excluding the five `/api/notes` entries already covered in §1 (all tied at 31,618,680 B — by far the
largest payloads in the capture, 27× larger than the next biggest):

| Rank | idx | Size | Total time | wait | receive | Path |
|---|---|---|---|---|---|---|
| 6 | 11 | 1,182,517 B | 777.9 ms | 356.5 | 209.0 | `/chunk-5IGUONCH.js` (static, largest JS chunk) |
| 7 | 42 | 1,182,517 B | 528.6 ms | 196.3 | 71.3 | same chunk, 2nd load (post-auth reload) |
| 8 | 51 | 1,143,023 B | 202.6 ms | 95.0 | 97.6 | `/chunk-ZAPHMM5E.js` (route chunk) |
| 9–20 | multiple | 733,808 B ×13 | 152.8–5,540.5 ms | 94.3–3,540.9 | 12.1–2,057.0 | `/api/commodities` (identical size every call — good caching candidate) |
| — | 7/38 | 576,539 B | 744.7/440.7 ms | — | — | `/chunk-5HFQXA2W.js`, loaded twice |
| — | 442 | 553,281 B | 196.2 ms | 116.5 | 68.7 | `/chunk-W3MHGTNO.js` (lazy route chunk) |
| — | 359 | 523,547 B | **1,590.4 ms** | **1,427.0** | 85.7 | `/api/tickets?tradeUnits=1028` — standalone slow tickets fetch, real server wait, not overlap-driven |
| — | 383 | 523,547 B | 728.0 ms | 653.5 | 13.0 | `/api/tickets?tradeUnits=1028`, re-fetch, byte-identical |
| — | 924 | 397,874 B | 5,123.3 ms | 3,584.0 | 1,525.2 | `/api/contracts?tradeUnits=1028` (during notes-contention window) |
| — | 354 | 397,874 B | 705.4 ms | 187.7 | 443.9 | `/api/contracts?tradeUnits=1028`, normal-window fetch — note **receive (443.9 ms) exceeds wait (187.7 ms)** here even outside the notes window, suggesting `/api/contracts` is also uncompressed/large enough that pure transfer time matters |
| — | 937 | 162,242 B | 4,579.0 ms | 3,722.8 | 801.9 | `/api/customers?tradeUnits=1028` (notes-contention window) |
| — | 65 | 335,998 B | 209.1 ms | — | — | `/api/commodities/conversions` |

`/api/commodities` (733,808 B, static reference data, fetched 13× total) and `/api/contracts`/`
/api/customers`/`/api/tickets` (hundreds of KB each, fetched on every trade-unit switch) are the
next tier of oversized, frequently-repeated payloads below notes — all compounding the app's
"refetch everything every navigation" pattern flagged in §3b.

---

## 6. Static assets — initial page load

Initial-load static assets from the app origin (before the first `/api/*` call, i.e. `idx` 0–51,
including both pre- and post-AAD-redirect app-shell loads):

- **32 requests, 6,595,901 B decompressed / 1,939,616 B over-the-wire (transfer)** — roughly 3.4×
  compression ratio on the JS/CSS bundle (gzip/br is working here, unlike `/api/notes`).
- App shell (JS+CSS) is loaded **twice** — once unauthenticated (`idx 3–14`), once again after the
  AAD redirect completes (`idx 34–45`, byte-identical sizes) — an unavoidable cost of the
  redirect-based MSAL login flow, not an app bug, but worth knowing it roughly doubles first-load JS
  transfer for a fresh, unauthenticated session (~2×166KB+350KB+... ≈ 780KB extra transfer).
- **Leaflet/MapLibre did NOT load on first page** — zero requests matching `leaflet` or `maplibre` in
  the entire capture until the map feature is actually navigated to (burst 25/26, `chunk-W3MHGTNO.js`
  and the OpenStreetMap tile burst). This confirms the mapping POC is correctly lazy-loaded/dormant
  on initial load, consistent with `docs/maps/README.md`.

---

## 7. Errors and anomalies

**500 errors (8 total, all `PUT /api/producerdetails/customer/{id}`):**

| idx | started | time | customer id |
|---|---|---|---|
| 150 | 02:43:52.968Z | 337.3 ms | 162725 |
| 176 | 02:43:56.420Z | 126.9 ms | 169439 |
| 189 | 02:43:58.160Z | 122.7 ms | 169728 |
| 212 | 02:44:03.747Z | 226.1 ms | 169875 |
| 236 | 02:44:06.740Z | 207.3 ms | 170179 |
| 249 | 02:44:08.320Z | 223.4 ms | 170185 |
| 288 | 02:44:15.558Z | 183.7 ms | 174030 |
| 412 | 02:47:29.645Z | 160.0 ms | 187160 |

All eight hit the same endpoint pattern during what looks like bulk/grid-row editing of producer
details across many customers in a single burst (burst 3/4 region, `02:43:50–04:03Z`) — response
bodies weren't captured per instructions, but this is a **100% failure rate on every PUT to that
endpoint observed in this capture** and should be investigated server-side (likely a validation or
concurrency exception thrown consistently for a certain field/condition present across these
records, or a null-reference on a subset of customer records — 8/8 failures, not 8/N, is the concerning
signal).

**274 status-0 entries:** 273 are `image` (OpenStreetMap map tiles, see below) with
`net::ERR_ABORTED` — expected client-side cancellation from rapid pan/zoom, not server errors. One is
the very first `document` request (`idx=0`, `/`, `net::ERR_CONNECTION_CLOSED`) — likely a dev-server
cold-start/redirect race at the very start of capture, harmless since it's immediately retried
successfully at `idx=1`.

**Requests with wait > 5000 ms:** 11 total, all already covered in §1/§2 (the notes-adjacent
contention cluster plus the standalone `usage-dashboard/click-event` at 9.4 s).

**Third-party / unexpected calls:**
- **`a/b/c.tile.openstreetmap.org` — 450 requests** (151+151+148), decompressed total only
  ~1.06 MB but **273/405 (67%) came back `net::ERR_ABORTED`** (status 0) in a 1.95 s window at
  `02:48:14.940Z` (burst 26). Public OpenStreetMap tile servers are being hit directly from the
  browser — this is a genuine third-party dependency distinct from the documented Azure Maps /
  LandMapMagic stack, and the very high abort rate (two-thirds of tile requests cancelled) suggests
  the map is re-rendering/re-requesting its tile grid faster than tiles can load — worth checking
  whether this is the map's zoom/pan debounce or a double-init of the tile layer.
- Standard MSAL/AAD infrastructure calls (`aadcdn.msauth.net`, `login.microsoftonline.com`,
  `graph.microsoft.com`, `login.live.com`, `browser.events.data.microsoft.com`) and Google Fonts
  (`fonts.gstatic.com`, `fonts.googleapis.com`) — all expected/benign.

**Sequential dependency chains:** No clear client-driven waterfall chaining was observed among
`/api/*` calls themselves (the vast majority fire in tight <20 ms clusters per burst, i.e. fired in
parallel by the app, not chained). The only genuine sequential dependency in the capture is the
expected auth flow: static shell → AAD authorize redirect → token exchange → second shell load →
first API burst.

---

## 8. Summary of recommendations implied by this data

1. **Fix `/api/notes`:** enable response compression (currently `compression: 0`/uncompressed on a
   30 MB payload) and add server-side filtering/pagination (by customer, trade unit, or date range)
   so the endpoint doesn't ship the entire notes table on every load. This single fix would cut
   23–44 s off of every page load and navigation in this session.
2. **Investigate thread/connection-pool contention** during `/api/notes` — unrelated small endpoints
   spike to 3–9 s of *server* wait time while notes is in flight; this smells like the API host is
   resource-starved during the notes serialization, not purely a network-transfer issue.
3. **Fix the dual-preload-pipeline bug** confirmed at initial load and every trade-unit switch: six
   endpoints (`contracts`, `plantingintentions`, `commodities`, `savedlists`, `customers`,
   `dashboardplantingestimates`) each fire twice, ~0.5 s apart, from the same code path.
4. **Add client-side caching for static/reference data** — `/api/commodities` (733,808 B, byte-
   identical across all 13 fetches), `/api/producerdetails`, `/api/notes/mention-catalog`,
   `/api/commodities/planting`, `/api/dashboardplantingestimates*` are all re-fetched, unchanged,
   on every navigation.
5. **Investigate the 8/8 failure rate on `PUT /api/producerdetails/customer/{id}`** — a systematic
   server error, not a transient blip.
6. **Review the OpenStreetMap tile-loading behavior** — 67% of tile requests are aborted in-flight;
   check for redundant/duplicate tile-grid requests on map init or pan/zoom debounce.
