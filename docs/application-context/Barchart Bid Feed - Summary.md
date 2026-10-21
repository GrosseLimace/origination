# BarChart Bid Feed — Plan Summary

**Status:** BUILT and applied to Dev (2026-08-11) · **Date:** 2026-07-23 · **Owner:** Caden Egr
Full detail: `Barchart Bid Feed - Database Plan.md` · Pipeline contract: `Barchart Ingestion API Contract.md`

> As built: the five tables live in `dbo` with a `Barchart` prefix, the load logic is parameterized SQL
> in the repository rather than stored procedures, and the data pipeline sends payloads to an
> authenticated API instead of connecting to the database.

We're building the database side of the BarChart bid feed — **where the data lands and how it gets onto the Bid Sheet**. The API calls/loads themselves are handled on the integration side; each response just gets handed to our stored procedures.

## What we're adding

A new `barchart` schema with **5 tables**:

- **Instrument** — the catalog: every location + bid BarChart offers (one row per elevator / commodity / delivery window)
- **CurrentQuote** — today's price for each bid
- **QuoteSnapshot** — a copy of every day's prices, kept as history we can trend later
- **CommodityMap** — translates BarChart commodity names ("Corn (#2 Yellow)") to our commodity codes
- **ApiCallAudit** — logs every API call so we can watch the 250k/month contract cap

Plus **4 new columns** on the existing Bid Sheet tables — to link locations to BarChart and tag which bids came from the feed (with an "as of" timestamp).

## How it works for users

- A new **search screen** to find BarChart locations and add them to the bid sheet — a location can be added to **multiple trade units/groups**, and we track where each one was added
- Once added, that location's bids **appear and update automatically** every day, and hovering a bid says when the elevator last updated it. (An environment can also be set to show a bid the elevator has not updated in 10 days as "--" with the date instead of a number; off everywhere for now)
- **Manual locations/bids work exactly like today.** A user may also type over a fed bid; the feed takes it back only with a newer, current quote (newest wins)
- Removing a feed location just unhooks it from that trade unit — the history stays, and it can be re-added anytime

## Safety

- Existing data and behavior untouched — everything today keeps working identically
- Vendor test entries are filtered out; the API key is never stored in the database
- Symbol structure confirmed with BarChart (the middle number is the location ID we group on)

## Still open (doesn't block the DB build)

- BarChart confirming whether test entries appear in the live feed
- Commodity mappings from Travis (BarChart names → our codes)
