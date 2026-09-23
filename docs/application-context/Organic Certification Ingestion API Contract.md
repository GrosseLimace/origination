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

**Question for you:** will the organic feed post from the same network as your existing Dev
integration? If not, tell us early — QA connectivity is a separate request that queues.

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

```jsonc
{
  "scoularId": "ABCFARM",              // CTRM CustID
  "operation": {
    "nopOperationId": "1234567890",    // required — the key everything is stored under
    "operationName": "Prairie Ridge Farms",
    "operationOtherNames": "Prairie Ridge",
    "clientOperationId": "PR-0042",
    "certifierName": "Example Certifiers LLC",
    "nopOperationStatus": "Certified",  // Certified | Surrendered | Suspended | Revoked
    "statusEffectiveDate": "2019-03-12",
    "nopAnniversaryDate": "2027-01-01",
    "lastUpdateDate": "2026-09-18",
    "hasCertificate": true,
    "certificateUrl": "https://organic.ams.usda.gov/integrity/...",
    "totalAcreage": 640.5
  },
  "scopes": [
    { "nopScope": "CROPS",    "scopeStatus": "Certified",   "statusEffectiveDate": "2019-03-12" },
    { "nopScope": "HANDLING", "scopeStatus": "Surrendered", "statusEffectiveDate": "2026-02-28" }
  ],
  "items": [
    {
      "itemId": "I-1", "nopScope": "CROPS", "certificateNumber": "C-99",
      "status": "Certified", "statusEffectiveDate": "2019-03-12",
      "itemName": "Corn", "categoryName": "Grains", "categoryId": "G",
      "itemVarieties": null, "otherItems": null,
      "organic": true, "organic100": false, "madeWithOrganic": false
    }
  ]
}
```

**Contact details are deliberately not accepted.** If `contactFirstName`, `contactLastName`, `phone`
or `email` appear in the payload they are ignored rather than rejected — nothing in the application
displays them, and storing contact PII we have no use for would put obligations on this data that
it does not otherwise carry. Send them or don't; it makes no difference to us.

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
{ "element": "item", "identifier": "I-1", "code": "DUPLICATE_ITEM_ID",
  "message": "Item id 'I-1' appeared more than once in this message." }
```

Branch on `code`, not on `message`. Current codes: `MISSING_NOP_OPERATION_ID`, `MISSING_SCOPE`,
`DUPLICATE_SCOPE`, `MISSING_ITEM_ID`, `DUPLICATE_ITEM_ID`.

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

1. **One real message, captured verbatim — the highest-value thing on this list.**

   The payload above was written from your description of the feed rather than from a captured
   message, so every field name in it is our best reading rather than something we have verified.

   That matters because of how the endpoint handles fields it does not recognise. Unknown fields
   are ignored, deliberately, so you can extend the payload without waiting on us — but the same
   rule means a field **we** have spelled wrong is also ignored. If `nopOperationStatus` turns out
   to be `operationStatus`, nothing errors: we store the certification with a blank status and
   return `"accepted": true`. Your logs show success, ours show success, and the gap only surfaces
   when someone opens a producer profile and finds it empty.

   Required fields do not have this problem — a mismatch there fails loudly with a 400 on your
   first call. It is the optional ones that fail quietly, and they are most of the payload.

   Send one message exactly as your pipeline would emit it, including any fields we have not listed.
   Sanitised values are fine; it is the **field names** we need. We run it against the contract and
   anything that does not line up shows up immediately.

2. **Your managed identity's name and object id** — once the pipeline exists.
3. **Which network the pipeline posts from**, per the connectivity section. This is the one that
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
