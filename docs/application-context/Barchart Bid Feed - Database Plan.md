# BarChart Bid Feed — Database Plan

**Status:** BUILT end to end — landing tables, ingestion API, catalog API, and the "Add from BarChart" picker UI; schema applied to Dev 2026-08-11. The picker and fed-bid display are gated by `environment.barchartBidsEnabled` (on for local + dev only). See [Bid Sheet](./Bid%20Sheet.md#add-from-barchart-fed-bids) for the UI behaviour.
**Date:** 2026-07-23 (built 2026-08-11) · **Owner:** Caden Egr

> **As-built notes.** Three things changed between approval and implementation:
> 1. **Tables live in `dbo` with a `Barchart` prefix** (e.g. `dbo.BarchartInstrument`), not a separate
>    schema — it matches every other app table and avoided a schema-ownership permission step.
> 2. **No stored procedures.** The App Service identity holds read/write on this database but not
>    EXECUTE, so the same SQL ships as parameterized statements inside `BarchartIngestRepository`.
>    (The nightly producer sync works the same way: raw SQL reads plus Entity Framework writes.)
> 3. **The vendor data arrives through an authenticated API**, not a direct database connection — see
>    [BarChart Ingestion API Contract](./Barchart%20Ingestion%20API%20Contract.md). The pipeline has no
>    database access at all.
>
> Everything below still describes the design accurately; substitute `dbo.Barchart*` for the table
> names and "load SQL in the repository" for "stored procedures".

## What this is

BarChart (our signed vendor) provides two API calls: one lists grain-buying locations and their posted bids, the other returns each bid's current price. That data will flow into our database on a recurring schedule (owned by the integration side — likely daily) so competitor bids show up on the Bid Sheet automatically — no more re-keying them by hand.

**Our piece is where the data lands and how it reaches the Bid Sheet.** The API calls themselves (when/how often BarChart is called) are owned by the integration side — they just hand each API response to our stored procedures.

Footprint: **5 new tables** in a new `barchart` schema in the Origination database, and **4 new columns** on the two Bid Sheet tables we already have. Everything ships through the normal migration pipeline.

## The flow

```
BarChart API responses (integration side)
        │
        ▼
  ① Instrument ──────── the catalog: every location + bid that exists
  ② CurrentQuote ────── today's price for each one
  ③ QuoteSnapshot ───── a daily copy, kept as history
  ④ CommodityMap ────── translates BarChart names → our commodity codes
  ⑤ ApiCallAudit ────── one row per API call (contract cap = 250k/month)
        │
        ▼  bridge procedure (ours, automatic)
  Bid Sheet tables — bids appear in cells, tagged "from BarChart"
        │
        ▼
  Bid Sheet screen — unchanged, just shows the values with a badge + "as of" time
```

**The ownership rule (both directions):**
- **Feed bids update on their own.** Once a location is added from BarChart, its fed bids show and refresh nightly, and hovering one says when the elevator last updated it. With `Barchart:HideStaleBids` on (off everywhere as of 2026-10-21), one the elevator has not updated in `StaleAfterDays` (10; `Barchart:StaleAfterDays`) shows as "--" with its date instead. The row is kept, stamp and all, for up to `MaxQuoteAgeDays` (90), which is what lets the date be shown. Two windows on purpose: publish is generous, trust is tight.
- **Newest wins.** A user may type over a fed bid; the cell becomes Manual and the vendor stamps are dropped. The feed takes it back only with a quote that is both current and stamped after the edit (the older of the cash and basis stamps, when both sides are published). Manual bids for crops/months the feed does not cover are never touched.

---

## The 5 new tables

### ① `barchart.Instrument` — the catalog

One row per bid that exists in the market: a specific **elevator × commodity × delivery window**. "GPC Muscatine, corn, Aug 2026" is one row; the same elevator's September corn is another. This is what the "Add from BarChart" picker searches.

| Column | What it is |
|---|---|
| `Symbol` (PK) | BarChart's unique ID, e.g. `ZCPQ26-82259-15194.CM` |
| `LocationKey` | The middle number (`82259`) — ties all of one elevator's rows together. Bid Sheet locations link to this. |
| `Elevator`, `LocationName`, `FacilityType` | Who/what the location is |
| `Commodity`, `InstrumentType`, `UnderlyingFuture` | What's being bid ("Corn (#2 Yellow)", cash bid, vs `ZCU26` futures) |
| `DeliveryStart`, `DeliveryEnd`, `DeliveryWindowFlag` | The delivery window (flag marks first-half / last-half split months) |
| `Address`, `City`, `State`, `ZipCode`, `Latitude`, `Longitude`, `County`, FIPS codes | Where it is (map pins, future geographic filtering) |
| `Phone`, `Website` | Contact info (already shown on printouts today) |
| `IsTest` | Filters vendor test junk (e.g. "AgVance Bid Sync Test") out of the app |
| `IsActive` | Bids that vanish from the feed get switched off, not deleted |
| `FirstSeenUtc`, `LastSeenUtc` | When the catalog first/last saw this row |

### ② `barchart.CurrentQuote` — today's price

Exactly **one row per Symbol**: the latest price. Each load overwrites it in place. This is what gets copied onto the Bid Sheet.

| Column | What it is |
|---|---|
| `Symbol` (PK → Instrument) | Which bid |
| `LastPrice` | The posted cash bid, e.g. **4.41** $/bu |
| `NetChange`, `PercentChange` | Change vs the prior day |
| `OpenPrice`, `HighPrice`, `LowPrice`, `ClosePrice` | Day's range as BarChart reports it |
| `TradeTimestamp` | When the **elevator** last updated its bid — the "as of" time in the UI |
| `ServerTimestamp`, `UpdatedAtUtc` | BarChart's timestamp / when the row was loaded |

### ③ `barchart.QuoteSnapshot` — the history

Same idea, but one row per Symbol **per day**, never overwritten across days. Lets us answer "what was this elevator bidding each day last month?" — this is the one table we can't recreate later if we skip it now. Re-running a load on the same day safely replaces that day's rows.

| Column | What it is |
|---|---|
| `SnapshotDate` + `Symbol` (PK) | The day + the bid |
| `LastPrice`, `NetChange` | That day's value |
| `TradeTimestamp`, `CreatedAtUtc` | How fresh it was / when we captured it |

### ④ `barchart.CommodityMap` — the name translator

BarChart says "Corn (#2 Yellow)"; our bid grid runs on Scoular commodity codes. This table (a handful of rows, values from Travis) translates one to the other. Unmapped commodities still get stored — they just don't reach the Bid Sheet until a row is added. New commodity = one INSERT, no deploy.

| Column | What it is |
|---|---|
| `BarchartCommodity` (PK) | BarChart's name: "Corn (#2 Yellow)" |
| `CommodityCode`, `CommodityName`, `CommodityCategory` | Our code / name / category |
| `IsActive` | Turn a mapping off without deleting it |

**Seeded by `scripts/Seed-BarchartCommodityMap.sql`** — 19 mappings, confirmed by Travis 2026-08-18. Dry-run by default; run once per environment after the BarChart migrations.
Idempotent (a `MERGE` that only writes when something differs), so it is safe to re-run, and it prints a
coverage report of every vendor commodity in the catalog with whether it will reach the Bid Sheet. Run it
in each environment after the migration; **without it the feed loads normally and no bids ever appear**,
which reads as a broken feed rather than a missing row.

Grade and protein variants collapse into their parent code ("Wheat (Hard Red Winter, Kansas City, 11.5)"
→ HRWW). Verified safe against the live catalog first: a location publishes either the standard grade or
a protein spec in a given month, never both, so two mappings can't compete for one cell.

Two commodities are deliberately left unmapped and were raised with the vendor rather than guessed: the
25 blank-commodity listings (all CHS United Plains Ag — the mapping key *is* the commodity string, so a
rule for empty would misfile any future blank from any publisher), and Soybean Meal on 11 locations
(our codes are protein-specific, the vendor states no protein, and it's a product Scoular sells rather
than a crop bought from farmers).

### ⑤ `barchart.ApiCallAudit` — the meter

One row per API call (the load side logs it with a one-line procedure call). Exists because the contract caps us at **250,000 calls/month** on our shared key — a view sums this table so usage is always one query away, and loads can check it before running. Failed calls count against the cap, so they're logged too.

| Column | What it is |
|---|---|
| `ApiCallId` (PK), `CalledAtUtc` | Row ID, when |
| `Endpoint`, `QueryParams` | What was called and asked for — **never contains the API key** |
| `HttpStatus`, `Success`, `RowCount`, `DurationMs`, `ErrorMessage` | How it went |

---

## Changes to the existing Bid Sheet tables

Four new columns, no restructuring. Every existing bid automatically backfills as `Source = 'Manual'` — zero impact on current data or behavior.

**`dbo.BidSheetLocations`**

| New column | What it is |
|---|---|
| `BarchartLocationKey` | Set when an originator adds a location "from BarChart" — points at the catalog's `LocationKey`. NULL = a normal manual location. |

**Adding locations (the biggest user-facing change):** a search screen lets originators find any BarChart location (by name, city/state, or near the map) and add it. A location can be added to **multiple trade units and groups** — each add creates its own Bid Sheet row carrying that trade unit and group, all pointing at the same `BarchartLocationKey`, which is how we track everywhere the location was added. The search results show where a location already lives ("already added in: TU 2040 · West Group") so nobody double-adds by accident.

**Removing them ("unadd"):** a feed location can be removed from a trade unit at any time. That only removes the *placement* — it's no longer tied to that trade unit/group — while the location keeps living in the BarChart catalog with its full price history, so it can be re-added later and the bids fill right back in. Removing it from one trade unit doesn't affect its placement in another. Manual locations and bids keep today's normal delete.

**`dbo.BidSheetLocationBids`**

| New column | What it is |
|---|---|
| `Source` | `'Manual'` or `'Barchart'` — who last wrote the cell. A `'Barchart'` cell may be typed over (it becomes `'Manual'`); the feed reclaims it only with a newer, current quote. |
| `BarchartSymbol` | Which instrument fed the cell |
| `QuoteAsOf` | Freshness shown in the UI ("as of 7/22 12:13 PM") |

---

## One bid, end to end

1. **Catalog load** → "Little Sioux Corn Processors, Marcus IA, corn, Aug 2026" lands in `Instrument` (LocationKey `27300`).
2. **Originator** searches "Little Sioux" in the picker, adds it to their trade unit → their location row stores `BarchartLocationKey = '27300'`.
3. **Price load** (each run) → `CurrentQuote` updates (**4.41**, as of 12:13 PM), today's `QuoteSnapshot` row is kept, calls logged in `ApiCallAudit`.
4. **Bridge** → translates the commodity via `CommodityMap`, works out CropYear 2026 / Month 8 from the delivery window, writes the cell: `4.41`, `Source='Barchart'`, as-of 12:13 PM. Cells the originator typed are skipped.
5. **Bid Sheet screen** → same tables as today; the value just appears, badged with its freshness.

---

## The plumbing: 3 stored procedures + 2 views

The tables are the *nouns*; these are the *verbs* — the only write and read paths into the schema. The load process (Logic App or whatever the integration side runs) is just the courier: it calls the BarChart API and hands each response to a procedure. All the logic about our tables lives in the procedures, next to the data — so if the load technology ever changes, nothing here changes.

### Procedure 1 — Receive instruments

**Runs:** whenever the load side pulls the catalog — daily, weekly, or on demand; the procedure has no schedule of its own and is safe at any frequency (filing is keyed by symbol, so reruns just re-update the same rows).
**Does:** unpacks the JSON → safe-converts every value → parses each symbol for the **location ID** and split-window flag → flags test entries → files into `Instrument`: new rows inserted, existing rows updated, rows missing from a complete pull switched to inactive — **never deleted**, so a linked location can't vanish because the vendor hiccuped.
**Why:** all the parsing and filing rules live in one place; the load side needs zero knowledge of our tables.

### Procedure 2 — Receive quotes

**Runs:** whenever prices are pulled, once per batch of ~100 symbols — any cadence works. Pulling multiple times a day just means fresher numbers; the history still keeps one row per bid per day.
**Does:** unpacks and safe-converts → overwrites each symbol's row in `CurrentQuote` (latest price is always exactly one row) → writes the same values into `QuoteSnapshot` under today's date. A rerun of the same day **replaces** that day's rows — retries can never duplicate history.
**Why:** keeps "latest" and "history" in lockstep from a single call, and makes failed-run retries completely safe.

### Procedure 3 — The bridge (the only thing that writes to the Bid Sheet)

**Runs:** three ways — automatically at the end of every price load, whatever its cadence; **instantly when an originator adds a location** from the search screen (so their bids appear on click, not at the next load); and on demand by an admin.
**Does:** finds every Bid Sheet location linked to BarChart → joins to its current prices → translates the commodity through `CommodityMap` (unmapped = skipped, never guessed) → reads the crop-year/month cell from the contract month encoded in the symbol, falling back to the delivery window if a symbol will not parse (whole-month bids preferred over split-window ones) → writes the cells, touching **only** rows tagged `Source='Barchart'` and never anything a user typed. Cleans up its own rows when a delivery month rolls off.
**Why:** the feed-owns-its-cells / users-own-theirs rule is enforced in exactly one place, and both triggers (nightly run, Add click) produce identical results because they run the same code.

### View 1 — Grouped locations (what the picker searches)

`Instrument` is one row per *bid* — a single elevator is many rows (each commodity, each delivery window). This view collapses the catalog by location ID into one row per *elevator* (name, city/state, coordinates, commodities offered, quote freshness), giving the search screen a clean list to query.

### View 2 — Monthly API usage

Counts `ApiCallAudit` rows per month. The contract caps us at 250,000 calls/month on one shared key — this makes "where are we against the cap?" a one-line query, and the load process can check it before running.

### Safe conversion (why one bad value can't sink a load)

The vendor's data contains typos, mangled phone numbers, blank fields, and addresses with line breaks (all seen in the real samples). When the procedures convert raw values into proper types, they use SQL's safe conversion: a value that won't parse becomes an empty (NULL) field *in that one spot* instead of throwing an error. Without this, one garbage coordinate in row 1,500 of a 4,000-row load would kill the entire night's update; with it, 3,999 rows land perfectly and one location just has a blank field.

## What this deliberately does NOT do

- No change to manual locations/bids — everything today keeps working identically.
- The feed never overwrites a manually entered bid with an older or stale quote (newest wins), and never touches manual bids for periods it does not publish.
- Feed locations default to competitor, but if Scoular's own elevators come through the feed, a linked location can be flagged as a Scoular facility — nothing precludes it.
- No API key is ever stored or logged in the database (Key Vault only).
- Vendor test data (`IsTest`) never reaches the app.

## The catalog API (what the picker calls)

The ingestion API above is machine-to-machine. The picker needs the other direction — reading the
catalog as a signed-in originator — so those endpoints live on their own controller at `/api/barchart`
under the normal user `[Authorize]`, backed by `BarchartCatalogService` and
`BarchartCatalogRepository`.

| Endpoint | What it answers |
|---|---|
| `GET /barchart/locations` | "Which BarChart locations match this text / state / crop, or sit near this point on the map?" |
| `GET /barchart/locations/{locationKey}` | "What would actually land on my Bid Sheet if I add this one?" |
| `GET /barchart/coverage` | "How many locations do we hold, in which states, as of when?" |
| `POST /barchart/locations/{locationId}/refresh-bids` | "Fill this location's bids in now, without waiting for the next run." |

Three things about these reads are deliberate:

- **Catalog reads are not trade-unit scoped.** The catalog is global vendor data with no Scoular
  customer information in it. Trade units matter for the *write* that creates a placement, and for
  reporting where a location is already placed — which every search result carries, so the picker can
  show "already added" instead of letting the user hit a duplicate error.
- **Radius search filters in two steps.** SQL narrows to a latitude/longitude box (index-friendly),
  then the service computes exact great-circle distance and sorts nearest-first. The box over-selects
  at its corners, so the service asks for extra rows and trims back to the requested page size.
- **The preview mirrors the bridge exactly.** A location can publish several instruments that overlap
  one Bid Sheet cell (a whole month plus first/last-half splits), and the bridge writes only one. The
  preview applies the same ranking and the same expired-window rule, so the rows a user sees before
  adding are the rows they get. Bids whose commodity has no mapping are shown and counted rather than
  hidden — an unmapped crop is the usual reason a location looks live in the vendor's data but lands
  nothing here.

**Linking a location** happens through the existing `POST /bidsheet/locations` with a
`barchartLocationKey`. That path validates the key against the catalog, refuses a second link to the
same location within one trade unit, fills blank address and coordinate fields from the vendor record,
and runs the bridge immediately so the new row isn't blank. **Unlinking** needs no new endpoint:
deleting the Bid Sheet location removes that trade unit's placement and its fed bids, while the
catalog and price history are untouched — so re-adding it refills instantly.

## Symbol anatomy (confirmed 2026-07-23)

```
ZC   P    Q26  - 27300 - 6916 .CM
│    │    │      │       └── internal location/commodity mapping (not used by us)
│    │    │      └── LOCATION ID  ← what our LocationKey stores
│    │    └── delivery period (Q26 = Aug 2026; F/L after it = split window)
│    └── instrument type (P = price/cash, B = basis)
└── commodity root (ZC = corn)
```

Note: the root alone can't distinguish "Corn (#2 Yellow)" from "Corn (NonGMO)" — that's why `CommodityMap` keys off the full commodity name from the feed, not the symbol.

## Open items

1. ~~Confirm the middle symbol number is a stable location ID~~ — **CONFIRMED 2026-07-23** (see anatomy above).
2. **BarChart:** are "Bid Sync Test" entries in the live feed? (forwarded to the vendor — drives the `IsTest` filter).
3. **Travis:** commodity mappings for `CommodityMap`. (His pull-time answer goes to whoever owns the load schedule.)
