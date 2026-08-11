# BarChart Ingestion API — Contract

**Audience:** whoever builds the BarChart data pipeline (Azure Data Factory)
**Status:** endpoints implemented; awaiting the app-role assignment below
**Owner:** Origination engineering · **Updated:** 2026-08-11

## What this is

Your pipeline fetches from BarChart on a schedule and forwards each response to these endpoints. We
parse, store, and publish the data onto the Bid Sheet. **Your pipeline needs no database access** —
this API is the only integration point, which keeps the Origination application the sole writer to
its own database.

You never need to know our table structure. Send the vendor's JSON as-is and we handle the rest.

## Base URL

```
{app-base-url}/api/barchart-ingest
```

The host depends on a decision that is still open — **please confirm**: does your pipeline reach the
app directly through its private endpoint, or via APIM? If APIM, we owe you a published OpenAPI
specification and that adds a step on our side. Once settled we'll fill in the per-environment hosts
here (dev → QA → prod).

## Authentication

Standard client-credentials (application-only) OAuth:

1. Your pipeline's **managed identity** requests a token for our API's resource:
   `api://{api-client-id}/.default` — the client id differs per environment.
2. Send it as `Authorization: Bearer <token>`.
3. No secret is stored anywhere on your side.

**One prerequisite we need from you:** your managed identity's **name and object id**, so infra can
assign it the existing `Origination.Application` app role on our API app registration. Enterprise
applications here are assignment-required, so **until that assignment exists every call returns 401**
regardless of a valid token.

## Request rules

| Rule | Detail |
|---|---|
| Body | The vendor's response body, **forwarded unmodified**. Don't reshape, rename, or filter — we select the fields we need on our side. |
| Compression | **Do not gzip the body.** There is no request-decompression middleware; a compressed body fails to parse. |
| Size | 10 MB maximum per request. A 100-symbol quote batch is roughly 50 KB, so page or batch rather than sending one large payload. |
| Content type | `application/json` |
| Correlation | Send `X-Correlation-Id` if you have a run id. We echo it and stamp it on our logs, which makes tracing a single run across both systems straightforward. |

## Endpoints

| Verb | Path | Purpose |
|---|---|---|
| `GET` | `/quote-batches?batchSize=100` | Ask us which symbols to quote. Returns them pre-grouped into batches. |
| `POST` | `/quotes?snapshotDate=YYYY-MM-DD` | Send a vendor quote response. `snapshotDate` optional — defaults to today, Central time. |
| `POST` | `/instruments` | Send a vendor instrument (catalog) response. |
| `POST` | `/apply-bids?instrumentType=bidCash` | Publish current prices onto the Bid Sheet. Call after a quote load. |
| `POST` | `/deactivate-instruments?lastSeenBefore=<utc>` | Retire catalog entries the vendor stopped publishing. **Only after a complete catalog sweep.** |
| `GET` | `/budget?monthlyCap=250000` | Month-to-date call usage on our side, as a cross-check against your own monitoring. |

### Response shapes

```jsonc
// GET /quote-batches
[ { "batchNumber": 1, "symbolCount": 100, "symbolsCsv": "ZCPQ26-27300-6916.CM,ZCPQ26F-82259-15194.CM,..." } ]

// POST /quotes
{ "quotesUpserted": 100, "unknownSymbolCount": 0, "snapshotDate": "2026-08-11" }

// POST /instruments
{ "rowsLoaded": 387 }

// POST /apply-bids
{ "rowsAffected": 42 }

// POST /deactivate-instruments
{ "rowsDeactivated": 12 }

// GET /budget
{ "monthToDateCalls": 4820, "remainingCalls": 245180, "abortRecommended": false }
```

Worth logging on your side: `rowsLoaded` / `quotesUpserted` of zero means a run landed nothing, and a
persistently non-zero `unknownSymbolCount` means the catalog is behind the quote feed and a
`/instruments` load is due.

## The daily sequence

```
1. GET  /quote-batches                      -> we tell you every symbol to price, in batches of 100
2. for each batch:
     call BarChart getQuote                 -> your side
     POST /quotes  (body = that response)   -> we store the price + the day's history
3. POST /apply-bids                         -> bid cells refresh for every linked location
```

Occasionally (weekly is plenty), refresh the catalog so new locations and delivery months appear:

```
1. for each page: call BarChart getGrainInstruments, then POST /instruments
2. after a COMPLETE sweep only: POST /deactivate-instruments?lastSeenBefore=<when the sweep began>
```

Skipping step 2 is harmless — nothing breaks, the catalog just keeps entries the vendor has dropped.
Running it after a *partial* sweep is not harmless: it would retire instruments that still exist.

## Retries

**Every endpoint is safe to retry.** Loads update rather than duplicate, and the day's history row is
replaced per business date, so re-running a failed step (or a whole run) needs no cleanup and no
idempotency key. Retry on `429`, `500`, `502`, `503`, `504`; don't retry `400` or `401`.

## Errors

| Status | Meaning | Retry? |
|---|---|---|
| `400` | Payload empty, over 10 MB, or not JSON | No — it'll fail again |
| `401` | Token missing/invalid, or the app role isn't assigned | No — fix auth |
| `403` | Authenticated but lacking the required role | No — fix the role assignment |
| `429` | Rate limited; honor the `Retry-After` header | Yes, after the given delay |
| `5xx` | Our side failed | Yes, with backoff |

Error bodies use the application's standard envelope:

```jsonc
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "traceId": "...", "timestamp": "..." } }
```

Quote that `traceId` when reporting a problem — it ties directly to our logs.

## Notes on timing and volume

- **Business date:** loads late in the day Central can already be tomorrow in UTC, so we derive the
  business date in Central time. Pass `snapshotDate` explicitly when back-filling.
- **Vendor cap:** the contract allows 250,000 calls/month on a key shared by *all* environments, so
  dev and QA testing consumes production allowance. Keep non-production runs small in scope.
- **Freshness:** the vendor returns bids elevators updated days ago. That's expected — we store the
  vendor's timestamp and the Bid Sheet shows it as an "as of" time rather than implying it's current.

## What we need from you

1. Your pipeline's managed identity **name + object id** (for the app-role assignment).
2. Confirmation you're calling **this API**, not the database.
3. Whether you reach us **directly or through APIM** (APIM means we publish an OpenAPI spec).
4. Your **schedule and scope** — run time, and which states/commodities you pull.
5. Acknowledgement of the **no-gzip** rule.
6. A **heads-up before your first test run**, so we watch the data together. That first real load is
   also when we validate our location-grouping logic against a full feed rather than a sample.

## What you need from us

1. Per-environment base URLs and API client ids (once the direct-vs-APIM question is settled).
2. Confirmation that the app-role assignment has been made.
3. The commodity mapping seeded on our side — until it is, loads succeed but bids won't appear on the
   Bid Sheet. That's a business data task on our end, not a blocker for your pipeline.

## Related

- `docs/application-context/Barchart Bid Feed - Database Plan.md` — what happens to the data after it
  arrives, and the Bid Sheet ownership rules.
- `docs/application-context/Bid Sheet.md` — the screen this feeds.
