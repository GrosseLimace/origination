# Field & Delivery-Point Mapping — Leadership Overview

*Audience: IT leadership and project managers. This is a plain-language summary of what was
built, why it matters, and what it would take to make it a real, supported feature. Engineers
should start with [`README.md`](README.md) (the as-built architecture) instead.*

## Table of Contents

- [The problem in business terms](#the-problem-in-business-terms)
- [What was built](#what-was-built)
- [Benefits](#benefits)
- [Current status: this is a proof of concept](#current-status-this-is-a-proof-of-concept)
- [What it would take to make this real](#what-it-would-take-to-make-this-real)
- [Where to read more](#where-to-read-more)

## The problem in business terms

Two separate gaps in the Grain Originator Portal prompted this work:

1. **No connection to real field boundaries.** When an originator recorded how much land a
   producer farms, the acreage was simply a number someone typed in by hand. There was no way to
   see, verify, or tie that number to the producer's actual fields on a map. The number was only
   as good as the person's memory or estimate, and nothing in the system could check it.

2. **A legal/licensing risk hidden in the Bid Sheet map.** The Bid Sheet screen (which plots
   grain delivery/elevator locations and their bid prices on a map) was drawing its map imagery
   from free public map services — an unauthenticated OpenStreetMap tile feed and an old Esri
   satellite endpoint. Neither is licensed for sustained internal business use at our volume. In
   plain terms: the app was quietly relying on map imagery it was not properly entitled to use.

## What was built

A shared mapping capability now addresses both gaps. In terms a non-engineer can follow:

- **Tag a producer's real fields (Customer Profile → new "Fields" tab).** An originator can open
  a producer's profile, see a satellite map centered on that producer's location, and click the
  actual outline of a field to attach it to the producer's record. The field outlines come from
  official USDA farm-field data. If the official boundary isn't quite right, the originator can
  instead pick a county tax-parcel boundary or hand-draw the field. Each tagged field
  automatically carries its calculated acreage and a snapshot of what crops are grown there.
  A single button can then set the producer's total acreage from the sum of their tagged fields,
  replacing the hand-typed guess with a real, verifiable number.

- **See what crops are actually grown in an area.** Both maps can turn on a translucent
  crop-type overlay (USDA Cropland Data Layer) that colors the landscape by what is grown where —
  useful context when talking to a producer about their operation.

- **A safer, better Bid Sheet map.** The Bid Sheet map was rebuilt on Microsoft's Azure Maps
  imagery (a service Scoular already pays for), retiring the improperly-licensed public map
  sources. The rebuild also added an optional, look-only overlay that lets an originator check a
  delivery location against the real field/parcel it sits on — including field acreage, county,
  top crop, and parcel-owner information — without saving anything.

- **Better address lookup everywhere.** Along the way, the app's address-to-location lookup was
  switched to Azure Maps, which correctly resolves many rural farm addresses the previous free
  service could not find.

## Benefits

- **Less manual data entry, fewer errors.** Acreage can be derived from real field boundaries
  instead of typed from memory.
- **Better producer conversations.** Originators can reference a producer's actual fields, crop
  history, and land ownership context on screen.
- **A real legal/licensing exposure was resolved.** The Bid Sheet map no longer depends on
  map imagery Scoular isn't licensed to use; it now uses Azure Maps, already under contract.
- **An informed technology decision before spending money.** For the Bid Sheet map, both the old
  map technology (Leaflet) and the new one (MapLibre) are kept side by side behind a toggle, so
  the team can compare them directly before committing to retiring one — rather than betting on a
  rewrite up front.

## Current status: this is a proof of concept

**This work is not yet in the shared development or production environment.** Being direct about
what "done" means here:

- It runs today **only on a single developer's local machine.** The tagged-field data is stored
  in a local file on that machine, not in the shared Scoular database.
- It uses a **free-tier, personal account** with the third-party field-data vendor
  (LandMapMagic), set up under an individual Scoular contact — not a purchased business license.
- It has **not** been through the org's formal security review or change-management process, and
  it has **no automated end-to-end test coverage** (the app requires real corporate login, which
  the current automated-testing setup can't exercise).

The proof of concept was, however, built with real engineering rigor: multiple rounds of
independent review against written design documents, with genuine bugs found and fixed along the
way. It demonstrably works. It is simply not yet wired into shared, supported infrastructure.

## What it would take to make this real

At a high level (the technical detail lives in [`PATH-TO-PRODUCTION.md`](PATH-TO-PRODUCTION.md)):

1. **Move the data into the real Scoular database** instead of the local file it uses today.
2. **Move the vendor/map keys into Azure Key Vault** and stop exposing the field-data vendor key
   to the browser (route those calls through our own server instead).
3. **Purchase a proper paid license** with the field-data vendor, and confirm our Azure Maps tier
   is sized for production traffic.
4. **Decide the Bid Sheet map technology** (keep MapLibre, retire Leaflet) and remove the
   comparison toggle once the decision is made.
5. **Add automated testing** and complete the org's standard **security review and ServiceNow
   change process** before any production rollout of the new external vendor integration.

None of these are research problems — they are known, scoped steps. This document's companion
[`PATH-TO-PRODUCTION.md`](PATH-TO-PRODUCTION.md) enumerates them in full.

## Where to read more

| Document | Audience | Contents |
|---|---|---|
| [`README.md`](README.md) | Engineers | The system as actually built — components, data flow, external systems |
| [`PATH-TO-PRODUCTION.md`](PATH-TO-PRODUCTION.md) | Engineers / tech leads | Everything required to move from POC to a supported feature |
| [`field-tagging/`](field-tagging/) | Engineers | Original design docs for the Customer Profile Fields feature |
| [`bid-sheet/`](bid-sheet/) | Engineers | Original design docs for the Bid Sheet map migration |
