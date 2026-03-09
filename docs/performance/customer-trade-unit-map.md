# Customer Trade Unit Map — Performance Optimization

**Status:** Pending DBA execution
**Created:** 2026-03-06
**Priority:** High — impacts every user load on the Customer screen
**Blocked by:** Requires CREATE TABLE / CREATE PROCEDURE permissions in ODS

---

## Problem

When a merchandiser selects a trade unit group in the Grain Originator Portal, the API queries `originations.vw_CustomerTradeUnits` — a view that dynamically joins approximately 2 million ticket records and hundreds of thousands of contract records against the customer table **on every single page load**.

This takes **12–14 seconds** every time a user selects a group.

### Root Cause

The view is built on a UNION of two branches:

- **Contracts branch** — fast, ~18K rows
- **Tickets branch** — slow, joins `base.Ticket` (2M rows); `OrganizationCode` column has no index → full table scan on every request

The API calls the view **3 times in parallel** (GetCustomers, GetContracts, GetTickets), so total load time = the slowest parallel query (~14s).

### Why It Can't Be Fixed with an Index

The `base.Ticket` table is in the ODS (Operational Data Store), which is managed externally. We can't add indexes to tables we don't own.

---

## Proposed Fix

Replace the on-demand view query with a **pre-computed relationship table** (`originations.CustomerTradeUnitMap`) that stores the trade unit → customer mappings as indexed rows. The table is refreshed on a schedule by a stored procedure, since trade unit–customer relationships only change when new contracts or tickets are created — which is infrequent.

### Expected Result

- Current: **12–14 seconds** per load (full table scan on 2M rows)
- After fix: **under 1 second** per load (indexed lookup on ~18K rows)

---

## Implementation Plan

### What Needs to Happen (DBA Required)

Steps 1–3 can be run by anyone with `CREATE TABLE` and `CREATE PROCEDURE` permissions on the ODS database. Step 4 requires SQL Server Agent access.

---

### Step 1 — Create the Table and Indexes

```sql
CREATE TABLE [originations].[CustomerTradeUnitMap] (
    CustomerId          bigint          NOT NULL,
    CustomerName        nvarchar(255)   NULL,
    SourceCustomerId    nvarchar(50)    NULL,
    CustomerCode        nvarchar(50)    NULL,
    State               nvarchar(100)   NULL,
    City                nvarchar(100)   NULL,
    TradeUnit           nvarchar(50)    NOT NULL,
    LastRefreshedAt     datetime2       NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT PK_CustomerTradeUnitMap PRIMARY KEY (CustomerId, TradeUnit)
);

CREATE INDEX IX_CustomerTradeUnitMap_TradeUnit
    ON [originations].[CustomerTradeUnitMap] (TradeUnit)
    INCLUDE (CustomerId, SourceCustomerId, CustomerName, CustomerCode, State, City);
```

---

### Step 2 — Create the Stored Procedure

```sql
CREATE OR ALTER PROCEDURE [originations].[usp_RefreshCustomerTradeUnitMap]
AS
BEGIN
    SET NOCOUNT ON;

    SELECT DISTINCT
        c.CustomerId,
        c.CustomerName,
        c.SourceCustomerId,
        c.CustomerCode,
        c.State,
        c.City,
        con.TradeUnit
    INTO #CustomerTradeUnitMap
    FROM base.Customer c
    INNER JOIN base.Contract con ON con.CtrmCustomerId = c.SourceCustomerId
    WHERE c.IsActive = 1
      AND c.IndustryCode1 = 'PR'
      AND con.IsActive = 1
      AND con.TradeUnit IS NOT NULL

    UNION

    SELECT DISTINCT
        c.CustomerId,
        c.CustomerName,
        c.SourceCustomerId,
        c.CustomerCode,
        c.State,
        c.City,
        t.OrganizationCode AS TradeUnit
    FROM base.Customer c
    INNER JOIN base.Ticket t ON t.CustomerId = c.CustomerId
    WHERE c.IsActive = 1
      AND c.IndustryCode1 = 'PR'
      AND t.IsActive = 1
      AND t.IsDeleted = 0
      AND t.OrganizationCode IS NOT NULL;

    TRUNCATE TABLE [originations].[CustomerTradeUnitMap];

    INSERT INTO [originations].[CustomerTradeUnitMap]
        (CustomerId, CustomerName, SourceCustomerId, CustomerCode, State, City, TradeUnit, LastRefreshedAt)
    SELECT CustomerId, CustomerName, SourceCustomerId, CustomerCode, State, City, TradeUnit, GETUTCDATE()
    FROM #CustomerTradeUnitMap;

    DROP TABLE #CustomerTradeUnitMap;
END;
```

---

### Step 3 — Seed Initial Data and Verify

```sql
-- Run the procedure to populate the table for the first time
EXEC [originations].[usp_RefreshCustomerTradeUnitMap];

-- Verify row count and spot check data
SELECT COUNT(*) AS TotalRows FROM [originations].[CustomerTradeUnitMap];
SELECT TOP 10 * FROM [originations].[CustomerTradeUnitMap] ORDER BY TradeUnit;

-- Verify a specific trade unit (e.g. 2040)
SELECT COUNT(*) FROM [originations].[CustomerTradeUnitMap] WHERE TradeUnit = '2040';
```

Expected row count: approximately **18,000–25,000 rows** (matches `originations.vw_CustomerTradeUnits`).

---

### Step 4 — SQL Agent Nightly Job

Create a SQL Server Agent job to keep the table current:

| Setting | Value |
|---------|-------|
| **Job name** | `Origination - Refresh CustomerTradeUnitMap` |
| **Step command** | `EXEC [originations].[usp_RefreshCustomerTradeUnitMap]` |
| **Schedule** | Daily at 2:00 AM |
| **On failure** | Notify DBA via email/alert |

> Trade unit–customer relationships change only when new contracts or tickets are entered in the source systems, so a nightly refresh is sufficient. If same-day accuracy becomes a requirement, the procedure can also be triggered via the application when new contracts or tickets are created.

---

### Step 5 — Update the API (Developer Task — No DB Permissions Needed)

Once the table exists and is seeded, update `OriginationDbContext.cs` to point the `CustomerTradeUnits` DbSet at the new table instead of the view:

**File:** `api/GrainOriginatorPortal.Api/Data/OriginationDbContext.cs`

Change:
```csharp
entity.HasNoKey().ToView("vw_CustomerTradeUnits", schema: "originations");
```

To:
```csharp
entity.ToTable("CustomerTradeUnitMap", schema: "originations");
```

No other code changes are needed — `SqlDataService.cs` already queries `_context.CustomerTradeUnits` and will automatically use the new table.

---

## Current Workaround

The application currently uses `originations.vw_CustomerTradeUnits` directly. The view was already optimized to query base tables (`base.Contract`, `base.Ticket`) instead of encrypted views, which reduced load time from 42 seconds to 12–14 seconds. This is the current state until the table is created.

---

## Files Involved

| File | Role |
|------|------|
| `api/GrainOriginatorPortal.Api/Data/OriginationDbContext.cs` | Maps `CustomerTradeUnits` DbSet — needs 1-line update after table is created |
| `api/GrainOriginatorPortal.Api/Models/CustomerTradeUnit.cs` | Entity model — no changes needed |
| `api/GrainOriginatorPortal.Api/Services/SqlDataService.cs` | Queries `_context.CustomerTradeUnits` — no changes needed |

---

## Who to Contact

Bring the SQL scripts in Steps 1–3 to whoever manages the ODS database (DBA or IT data team) and request:
1. Table and index creation
2. Stored procedure creation
3. Initial data seed (`EXEC usp_RefreshCustomerTradeUnitMap`)
4. SQL Agent nightly job setup
