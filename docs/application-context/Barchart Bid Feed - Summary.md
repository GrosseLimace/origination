# BarChart Bid Feed — Plan Summary

**Date:** 2026-07-23 · **Owner:** Caden Egr · Full detail: `docs/application-context/Barchart Bid Feed - Database Plan.md`

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
- Once added, that location's bids **appear and update automatically** every day — those bids are read-only
- **Manual locations/bids work exactly like today**, and the feed can never overwrite a manual entry
- Removing a feed location just unhooks it from that trade unit — the history stays, and it can be re-added anytime

## Safety

- Existing data and behavior untouched — everything today keeps working identically
- Vendor test entries are filtered out; the API key is never stored in the database
- Symbol structure confirmed with BarChart (the middle number is the location ID we group on)

## Still open (doesn't block the DB build)

- BarChart confirming whether test entries appear in the live feed
- Commodity mappings from Travis (BarChart names → our codes)
