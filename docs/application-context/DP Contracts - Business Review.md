# DP Contracts tab — business review

**Purpose of this doc:** explain where the DP Contracts numbers come from and how they're calculated,
and list what we need the business to confirm before we trust it in front of originators.

**Status:** built and working against production data on a developer machine. Not released. Nothing is
written back — every DP code path is read-only.

---

## What we built

A **DP Contracts** tab on the producer page, sitting next to **Storage** and deliberately looking the
same. For a given producer it shows each delayed-pricing position: the ticket it came in on, where the
grain is, how many bushels, how long it's been on DP, the rate, and the charges accumulated so far.

Previously a DP contract only appeared as a "Deferred" badge on the Contracts tab, with none of this
detail visible anywhere in the portal.

---

## How we pull the information

| | |
| --- | --- |
| **Source** | ODS view `ctrm.vw_GNTA70D1` — nothing else feeds the numbers |
| **Which rows** | Only the **most recent daily run**, and only rows still holding quantity (`Net_Quantity > 0`) |
| **How we find the latest run** | Highest `Report_Run_Stamp`. We verified there is exactly **one stamp per day**, and that it covers all **17 trade units** (~2,700 rows) — so we get a complete picture, not a partial batch |
| **Refresh cadence** | Whatever the nightly ODS load provides. We do not cache — each page load reads the current latest run |
| **Producer match** | The view's `Customer_Id` (e.g. `ABCFARM`) matched to our customer record's Scoular ID |
| **Location** | `Trade_Unit_Code` (e.g. `1340`) looked up in our location master (`MbpLocationSynonym`) to get a readable "City, ST". The view carries no elevator or facility code, so the trade unit is the only location signal available |
| **Who can see what** | The producer page is open to any authenticated originator. The trade-unit-wide list is filtered to the trade units the signed-in user is entitled to |

---

## How each number is calculated

Almost everything is shown exactly as the ODS reports it. Only two values are computed by us.

**Per row (one row per charge type on a delivery):**

| Column | Source | Notes |
| --- | --- | --- |
| Ticket # | `Ticket_Number` | As-is |
| Charged From – Thru | `Charged_From_Date` / `Charged_Thru_Date` | Shows `—` if CTRM reports no date |
| Location | `Trade_Unit_Code` → location master | `—` if the trade unit isn't in the master |
| Net Bu | `Net_Quantity` | As-is when the unit is `BU` (the normal case) |
| Storage Days | `Storage_Days` | As-is. Note this is days since the grain arrived, **not** the charged-from/thru span |
| Rate | `Storage_Rate` | As-is, up to 6 decimals |
| Storage Amount | `Receivable_Amount` | As-is |

**Per group (grouped by commodity, or by location, or both):**

| Value | How we calculate it |
| --- | --- |
| Ticket count | Number of **distinct deliveries** — not the number of rows |
| Bushels | Delivery bushels added up, **counting each delivery once** (see below). Rounded to whole bushels for display |
| Accumulated Cost | All `Receivable_Amount` values **added together** |
| Cents/Bu | Accumulated Cost ÷ Bushels × 100 — **the only derived figure** |

### The one non-obvious rule

A single delivery appears **more than once** in the view — one row per charge type. Real example:

| Ticket | Status | Description | Rate | Amount | Quantity |
| --- | --- | --- | --- | --- | --- |
| 370145 | `2` | INITIAL CHARGE 2 - CHARGE/BU/D | 0.300000 | $243.75 | 812.50 BU |
| 370145 | `S` | REGULAR STG RATE | 0.001667 | $170.66 | 812.50 BU |

Both rows repeat the **same 812.50 bushels** — it's one pile of grain being charged two ways. So:

- **Bushels are counted once** → 812.50 bu (not 1,625).
- **Charges are added together** → $414.41.
- Cents/Bu = 414.41 ÷ 812.50 × 100 = **51.00¢**.

We confirmed the second charge accrues daily: $0.001667 × 812.50 = **$1.35/day**, and the amount moved
from $169.30 to $170.66 across consecutive runs. **Item 1 below asks the business to confirm this
interpretation**, because if those amounts are running totals of each other rather than separate
charges, our Accumulated Cost is overstated.

---

## What we need the business to confirm

### 1. Are the charge rows additive? *(highest priority — affects whether the money is right)*
A delivery shows one row per charge type (`INITIAL CHARGE 2`, `REGULAR STG RATE`). We are **adding
them together** to get what the producer owes. Is that correct — is each row its own separate charge?
Or is one of them a running total that already includes the other, in which case adding them
double-counts? If a producer's real balance on ticket 370145 is **$414.41**, we're right. If it's
**$243.75** or **$170.66**, we're wrong.

### 2. Should each charge type be its own row on screen?
Right now ticket 370145 shows as **two rows** with the same bushels and different rates. It's accurate
but reads like a duplicate. Options:
- **(a)** Add a "Charge Type" column so the two rows explain themselves.
- **(b)** Collapse to one row per ticket with the charges combined — cleaner, but there's no single
  "Rate" to show and the breakdown is lost.

Which is more useful to an originator on a producer call?

### 3. Is "days on DP" the right number?
We show `Storage_Days` (259 in the example) — days since the grain arrived, as of the last report run.
That's a different span from the Charged From–Thru window (~134 days). Is `Storage_Days` the figure an
originator expects to see, and should we label it something clearer than "Storage Days"?

### 4. Should any DP positions be hidden?
We currently show everything in the latest run with quantity remaining. We are **not** filtering on
`Status`. Are there statuses that shouldn't be shown to originators — closed, errored, or
administrative rows? (There's also a `Storage_Error_Flag` we're ignoring; should an errored row be
hidden, or flagged?)

### 5. Are these deliveries also showing as unapplied tickets?
The DP rows we're seeing have `Ticket_Status = "U/L"` (unload). Storage has a rule that stops a
priced-out storage ticket from counting as "unapplied". DP may need the same treatment — otherwise one
delivery could appear both in **Unapplied Tickets** and in **DP Contracts**, which would look like
double-counting. Should DP deliveries be excluded from the unapplied-ticket count?

### 6. What should the tab count show?
The tab badge currently shows the number of **distinct commodities** on DP (matching how the Storage
tab behaves). Would a count of tickets, or total bushels, be more useful at a glance?

### 7. Is the data current?
The sample row we were given had a report stamp of 2026-05-06. The latest run we found is
2026-08-04. We always read the newest run available, so if the ODS load ever stalls we would show
stale positions without any warning. Should we surface the report date on screen so an originator can
see how fresh it is?

---

## Known limitations while we test

1. **Only production has DP data.** Every environment reads its own ODS — Dev reads Dev, QA reads QA,
   production reads production — exactly like every other part of the application. The view exists in
   Dev and QA but is **empty** (0 rows), so the tab shows "no DP contracts" there until ODS loads it.
   That is a data gap, not a build gap: when the data lands, the tab fills in with no change from us.
   The practical consequence is that **the numbers can only be validated against production today**,
   which is done through a read-only connection that is switched off by default.
2. **While that read-only production connection is in use, not every producer shows DP.** Positions
   come from production while producer records come from the local environment, so producers that
   don't exist locally are skipped. This under-reports rather than mis-attributes — it will never show
   a position against the wrong producer. This does not apply once Dev/QA have their own data.
3. **Bushels only when we can prove them.** If the ODS reports a quantity in a unit we can't convert to
   bushels, we show a dash rather than a number, and say how many rows were left out of the total. We
   deliberately never guess — showing pounds as if they were bushels would be wrong by roughly 56×.
   Every row seen so far is already in bushels, so this is a safeguard, not a common case.
4. **Bushels show two decimals** everywhere on the tab (812.50, not 813), so displayed totals tie back
   to the source exactly. Note this differs from the Storage tab, which still rounds to whole bushels.
5. **DP appears on the producer tab and in Build-A-List.** The producer summary card and the dashboard
   are planned but not built, so those screens' numbers have not changed.

---

## Not a question for the business, but worth knowing

We found and fixed two calculation bugs while validating against the real row above:

- Bushels were being **doubled** for any delivery with more than one charge row (the 812.50 → 1,625
  case). Fixed, with a test pinning the real ticket.
- The contract number was being built as `PC PL84649` — double-prefixed, because `Contract_Number`
  already contains its own letters. Now shows `PL84649-A`.
