# Remediation of the Phase 1 calibration audit — 2026-09-21

Companion to `AUDIT-TRACKING.json`. The tracker holds the per-finding state; this explains how it
got there, so a reader isn't left inferring the reasoning from status labels.

The audit (PR #613) landed with all 127 findings `open`. Origination engineering verified every one
against the code, then fixed what was worth fixing on branch `fix_AuditPhase1Findings`, **merged to
`main` 2026-09-21 via PR #615**.

| Status | Count | Meaning here |
| --- | ---: | --- |
| `resolved` | 74 | Fixed in code and merged |
| `accepted` | 18 | Deliberate; reason recorded, see below |
| `wont_fix` | 3 | Not applicable — the thing described no longer exists |
| `wont_fix` | 2 | **Rejected as incorrect** — see below |
| `open` | 30 | Real and outstanding; each carries a note saying why |

Verification after the merge: **766/766** API tests (535 before), **746/746** client tests (601
before), Release and production builds clean.

## Where the reasoning lives

- **`accepted` (18)** — written up in [`docs/application-context/STYLE-DEVIATIONS.md`](../../docs/application-context/STYLE-DEVIATIONS.md),
  each with the reason and what would make it worth revisiting. The security-relevant one (the
  caller's UPN in every request's log scope) became **AR-09** in
  [`SECURITY-REVIEWS/ACCEPTED-RISKS.md`](../../SECURITY-REVIEWS/ACCEPTED-RISKS.md). The
  authorization-model deviations are described in
  [`docs/application-context/SECURITY-MODEL.md`](../../docs/application-context/SECURITY-MODEL.md).
- **`open` (30)** — five need a decision rather than code (client telemetry, the
  `CustomerTradeUnit` cascade, the `B4_migrate_createdby.sql` run status, the AR-01/02/08
  countersignature, and the NOCHECK foreign keys). The rest are deferred with a stated reason: the
  OnPush sweep, god-component and repository-layer coverage, and the `IEntitlementsCatalogService`
  extraction.

## Two findings rejected as incorrect

Recorded here because "we disagreed" is more useful to a future reader than a bare `wont_fix`.

**`dotnet.redundant-refetch-producer-details`** and its `performance.*` twin claim
`ProducerDetailsRepository.UpsertAsync` re-reads values already held in memory. It does not, and
applying the suggested fix would introduce a bug:

- A null `contacts` list means "not provided" and deliberately **preserves** the existing rows. On
  that path the request carries nothing, so the database is the only source.
- `GetContactsAsync` returns contacts primary-first; the normalized request list does not guarantee
  that order, so the response order would change depending on which path produced it.

The reason is also recorded in the method itself, so the next audit doesn't re-file it.

## One finding whose premise is still unverified

`code-review.bulk-bid-location-insert-race` is marked `resolved` — a guard was added — but its
premise has not been confirmed. The finding asserts a unique index on
`BidSheetLocations (Name, TradeUnitCode)`. **That index is not in the EF model:** no live migration
creates `UQ_BidSheetLocations_Name_TradeUnit`, only historical `.Designer.cs` snapshots mention it,
and the current model snapshot has just the non-unique `IX_BidSheetLocations_TradeUnitCode`.

It may exist in deployed databases, because the hand-rolled `migrate-bid-sheet.sql` created the
table with it outside EF — the same model-versus-database drift that
`sql.handrolled-ddl-faked-migration-history` describes. So two findings in this run interact and
neither says so.

Settling it is one query per environment:

```sql
SELECT i.name, i.is_unique, i.type_desc
FROM   sys.indexes i
WHERE  i.object_id = OBJECT_ID('dbo.BidSheetLocations') AND i.name IS NOT NULL;
```

If a unique index exists, the guard is real and nothing changes. If it does not, the guard is a
catch that can never fire and two comments in `BidSheetRepository.cs` are stale. Note that *adding*
a global unique index is not the easy fix it looks like: the table predates any naming rule, so it
would need a duplicate-name sweep of QA and PROD first, or the deploy fails on existing duplicates.

## For the dashboard's scoring model

Detail is on PR #613; the short version:

1. **A finding can be true while its `suggested_fix` is wrong.** Two instances in this run — the
   one above, and the unverified index premise. That failure mode isn't modelled: the tracker
   presents finding and fix with equal confidence, and the fix is the field people act on.
2. **Findings can understate.** `code-review.nlq-pacing-open-vs-all-contracts-mismatch` was filed
   as an inconsistency; it was a broken feature — the free-text path scoped to open contracts, and
   last year's contracts are all closed, so it zeroed its own baseline and returned almost nobody.
3. **Fix cost doesn't follow domain.** Eleven findings across `sql` and `clean-slop` were one root
   cause (pre-CI DDL scripts never deleted) and took one commit. Ten client race findings were the
   same missing-request-id shape and took one more. Finding count inverts the real signal.
4. **15 of the 127 are cross-domain re-filings** of each other, three disagreeing on their own
   numbers and several on severity. Anything summing by severity double-counts them.
5. **Re-measure the baseline after remediation.** Deleting the `clean-slop` dead code cleared a
   bundle-budget warning that Phase 1.3 had recorded as pre-existing and therefore unattributable.
6. **`code-review` was the strongest domain** — all 19 findings real, nine of them latent bugs
   nobody here had written down. `test-gaps` counts were exact to the digit.
