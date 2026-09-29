# Organic Certification Ingestion API — Contract

For the integration team building the NOP certification pipeline. Companion to the OpenAPI
specification, which is normative — where this document and the spec disagree, the spec is right.

Status: **endpoint built, not yet deployed.** Dev deployment and app-role assignment follow.

## What this is

Origination needs NOP organic certification status on the producer profile. The integration that
resolves NOP id to certification data currently feeds CRM, and CRM is retiring that feature, so the
data needs a new destination before it disappears.

You POST one producer's certification here; we validate it and write it. You get no database access
of your own — that keeps this application the only writer to its own database, so the schema stays
ours to change without breaking you.

## Base URL

```
{app-base-url}/api/organic-certifications
```

Per-environment hosts to be filled in once the connectivity question below is settled.

## 🔻 Connectivity — settle this before you build

**The App Service has no public inbound access.** Traffic arrives over a private endpoint, plus a
host allowlist. A caller needs either:

- a VNet with a private endpoint to our App Service, or
- to route through APIM — and anything that rewrites the `Host` header must preserve an allowlisted
  hostname.

Dev is confirmed ready on our side: the private endpoint exists, DNS resolves to it, and the app
answers on that path. **What we have not confirmed is your side.** Our existing BarChart feed in Dev
runs on the older platform, so we cannot assume a newer pipeline routes the same way.

### What we need, precisely: the VNet — not the application name

DNS zone links and routing are configured **per network**, not per application or per identity. That
single fact decides how much work QA is:

- **Same VNet as the BarChart QA gateway** → you inherit the existing link and route. Nothing extra
  is needed, and we simply add this feed to a request already in flight.
- **A different VNet** → it needs its own DNS link and its own route, even though the destination
  App Service is identical. Same team, but genuinely additional work, and it queues.

So the question is not "which system is calling" but:

> **Which subscription, resource group and VNet will the pipeline run in?**

Tell us that and we can either fold it into the open request or raise the right one. Until we have
it we cannot ask the network team anything useful, because an application name does not tell them
what to configure.

## Authentication

Standard client-credentials (application-only) OAuth:

1. Your pipeline's **managed identity** requests a token for our API's resource:
   `api://{api-client-id}/.default` — the client id differs per environment.
2. Send it as `Authorization: Bearer <token>`.
3. No secret is stored anywhere on your side.

**What we need from you:** your managed identity's **name and object id**, so the existing
`Origination.Application` app role can be assigned on our API app registration. Enterprise
applications here are assignment-required, so until that assignment exists every call fails
regardless of a valid token. The assignment itself is quick — measured in minutes, not days.

There is nothing to request until your pipeline exists. Build it, tell us the identity, and we will
action the grant.

## 🔑 Diagnosing a 403 — read the headers, not just the status

Both failure modes return 403 and they have completely different owners:

| What you see | What it means | Who fixes it |
|---|---|---|
| `x-ms-forbidden-ip` header, HTML body | The request never reached us — blocked at the platform edge | **Infrastructure.** Network path. |
| Our headers — `X-Correlation-Id`, a CSP header | The request reached the application; the app role is missing | **Us.** Grant takes about half an hour once actioned. |

This one check will save a great deal of back-and-forth.

## Request rules

| Rule | Detail |
|---|---|
| Shape | **One producer per request.** There is no batch endpoint — the feed sends one message per producer, so batching would be an unused code path. |
| Unknown fields | **Safe to add.** Fields we do not model are ignored, not rejected. You can extend the payload without waiting on a deployment here. |
| Compression | Do not gzip the body. There is no request-decompression middleware. |
| Content type | `application/json` |
| Correlation | Send `X-Correlation-Id` with your run id if you have one. We echo it and stamp it on our logs. |

## The endpoint

```
POST /api/organic-certifications/ingest
```

Shape confirmed against the two messages you captured for us on 2026-09-29. Operation fields are
**flat**, alongside `scoularId`.

```jsonc
{
  "scoularId": "PRAI412",                 // CTRM CustID
  "nopOperationId": "8150000123",         // required — the key everything is stored under
  "operationName": "Hofmeyer Farms / Dale Hofmeyer",
  "operationOtherNames": null,
  "clientOperationId": null,
  "certifierName": "[MCIA] Minnesota Crop Improvement Association",
  "status": "Certified",                  // Certified | Surrendered | Suspended | Revoked
  "statusEffectiveDate": "2012-01-09",
  "anniversaryDate": "2026-04-01",
  "lastUpdatedDate": "2025-11-07",
  "totalAcreage": 1503.95,

  "contact":    { ... },                  // accepted and ignored — see below
  "activities": { ... },                  // accepted and ignored
  "addresses":  [ ... ],                  // accepted and ignored

  "scopes": [
    { "scope": "Crops",    "status": "Certified",   "statusEffectiveDate": "2012-01-09" },
    { "scope": "Handling", "status": "Surrendered", "statusEffectiveDate": "2026-02-28" }
  ],
  "items": [
    // Catalogued — numeric ids from the USDA catalogue
    { "scope": "Crops", "itemId": 377, "itemName": "Sugercane",
      "categoryId": 2, "categoryName": "Field/Forageable",
      "certificateNumber": "US11154/25", "status": "Certified",
      "statusEffectiveDate": null, "varieties": null, "otherItems": null,
      "organic100": true, "organic": null },

    // Free text — no ids or names at all; the crops are in otherItems
    { "scope": "Crops", "itemId": null, "itemName": null,
      "categoryId": null, "categoryName": null,
      "certificateNumber": null, "status": "Certified",
      "statusEffectiveDate": "2012-01-09", "varieties": null,
      "otherItems": "Alfalfa, Corn, CRP, Oats/Alfalfa, Pasture, Soybeans",
      "organic100": true, "organic": null }
  ]
}
```

**Both item shapes are fully supported.** `itemId` is optional and is not a key — we know whole
operations arrive with every item in the free-text shape. An item is only rejected if it carries
**none** of `itemId`, `itemName` or `otherItems`, because there is then no crop to store or show.

**Contact, activities and addresses are accepted and ignored.** Nothing in the application displays
them, and storing contact PII we have no use for would place obligations on this data it does not
otherwise carry. Send them or don't; it makes no difference to us.

### Response

```jsonc
{
  "batchId": "b1f0...",        // correlates with our audit row; quote it if you raise anything
  "nopid": "1234567890",
  "accepted": true,
  "customerMatched": true,     // false is NOT a failure — see below
  "scopesStored": 2,
  "itemsStored": 1,
  "rejections": []
}
```

`rejections` names anything dropped, so a partial success is actionable rather than mysterious:

```jsonc
{ "element": "item", "identifier": "Sugercane", "code": "DUPLICATE_ITEM",
  "message": "An identical item appeared more than once in this message." }
```

Branch on `code`, not on `message`. Current codes: `MISSING_NOP_OPERATION_ID`, `MISSING_SCOPE`,
`DUPLICATE_SCOPE`, `EMPTY_ITEM`, `DUPLICATE_ITEM`, `SCOPES_ABSENT`, `ITEMS_ABSENT`.

## Three behaviours worth knowing

**An unknown producer is accepted, not rejected.** If `scoularId` matches no producer we hold, the
certification is still stored and `customerMatched` comes back false. That is an onboarding gap on
our side, not a problem with your message, and the record surfaces automatically once the producer
exists. **Do not treat `customerMatched: false` as an error or retry it.**

**A malformed scope or item does not lose the certification.** The bad child is dropped and named in
`rejections`; everything else stores. The only failure that loses the whole message is a missing
`nopOperationId`, because there is then no key to store it under.

**Scopes and items are replaced as a set.** Whatever you send becomes the complete list. An item you
stop sending is removed. A surrendered operation with an empty `items` array is expected and fine.

## Retries

Safe to retry, always. The operation upserts on `nopOperationId` and its children are replaced, so
re-sending the same message converges rather than duplicating. A failed run can simply be run again.

## Errors

| Status | Meaning | Action |
|---|---|---|
| 200 | Stored. Check `rejections` — it may be a partial success. | Log `batchId`. |
| 400 | The body could not be read, or a required field was missing or too long. | Fix and resend; retrying unchanged will fail again. |
| 401 | Token missing, expired, or for the wrong resource. | Check the audience is `api://{api-client-id}`. |
| 403 | Either the network or the app role — **read the headers**, see above. | Route by which case it is. |
| 5xx | Our side. | Retry with backoff. |

## What we need from you

1. ✅ **A captured message — supplied 2026-09-29, thank you.** It was worth asking for: our first
   version had been built from the written description and was wrong in **seven** places, including
   an `operation` wrapper that does not exist. Only two of those would have failed loudly; the rest
   would have bound as null, stored blank and returned `"accepted": true` with clean logs on both
   sides.

   Both samples are now pinned in our test suite, so if the payload changes we will find out
   immediately rather than by someone noticing an empty profile. **If you do change it, send another
   capture** — a description of the change is not enough to catch this class of problem.

2. **Your managed identity's name and object id** — once the pipeline exists.
3. **The subscription, resource group and VNet the pipeline will run in** — see the connectivity
   section for why the VNet specifically, and not the application name. This is the one that
   determines the date.
4. **Can you send a run id on each message?** This matters more than it looks. Because you send one
   message per producer, there is no batch boundary, so we cannot tell "not sent tonight" from
   "unchanged" — which means we can never mark an operation inactive from absence alone. A run id
   on each message would let us group a night's set and detect what dropped out. Without it,
   deactivation can only come from an explicit Surrendered or Revoked status.
5. **Maximum lengths** for the string fields, so our columns are sized from fact rather than
   estimate. Current limits are in the OpenAPI spec; tell us if any are too tight.
6. **Does `certificateNumber` change on renewal?** There is no certificate issue date anywhere in
   the data, so if the number changes on reissue it is the closest proxy we have for "something was
   renewed" — which a business rule on our side currently needs and cannot otherwise compute.

## What you need from us

1. Per-environment base URLs and API client ids — pending the connectivity answer.
2. The app-role assignment, once you send the identity details.
3. The OpenAPI specification.
4. A Dev endpoint to test against.

## Related

- `docs/application-context/Barchart Ingestion API Contract.md` — the same pattern, different feed.
