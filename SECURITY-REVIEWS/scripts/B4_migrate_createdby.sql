-- =============================================================================
-- B4 — Identity collision migration (Security finding M-002)
-- =============================================================================
-- Historically, SqlDataService.GetCurrentUser() returned the Azure AD display
-- name ("Caden Egr") as the caller identity. That value was persisted in the
-- CreatedBy / ModifiedBy fields of every app-owned table. Display names are
-- not unique, so two users with identical display names collide on ownership
-- checks (saved-list CRUD is the concrete example).
--
-- The fix in SqlDataService.cs switches GetCurrentUser() to return the UPN
-- (preferred_username), e.g. "cegr@scoular.com". After deploy, NEW rows will
-- have UPN in CreatedBy/ModifiedBy but OLD rows keep the display name. That
-- split breaks ownership-scoped queries for a user's historical rows.
--
-- 2026-10-13: every join below now excludes display names shared by more than one login, so
-- an ambiguous name can never be remapped to the wrong person. Production was checked that day
-- and had no shared names, so the original run could not have misattributed anyone; the guard
-- is for any future run against data that differs.
--
-- This script is a ONE-TIME remap that UPDATEs display-name values to their
-- UPN by joining dbo.UserTradeUnitSnapshot (which has both DisplayName and
-- UserId columns — UserId is the UPN).
--
-- SAFETY:
--   * Idempotent. The WHERE clause `NOT LIKE '%@%'` means rows already in UPN
--     form are skipped, so re-running the script is a no-op.
--   * Additive. Never nulls a column or overwrites a non-matching value — if
--     a user's display name doesn't have a UserTradeUnitSnapshot row, their
--     rows are simply left alone (no worse than before).
--   * Transaction-scoped per table so a failure mid-way doesn't leave a
--     partial update.
-- =============================================================================

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRANSACTION;

-- Notes -----------------------------------------------------------------------
UPDATE n SET n.CreatedBy = u.UserId + '@scoular.com'
FROM dbo.Notes n
JOIN (SELECT UserId, DisplayName
      FROM (SELECT DISTINCT UserId, DisplayName FROM dbo.UserTradeUnitSnapshot) d
      -- Only display names that map to exactly ONE login. A shared name would match an arbitrary
      -- login and silently misattribute the row; those are left as-is for a human to resolve.
      WHERE DisplayName IN (SELECT DisplayName FROM (SELECT DISTINCT UserId, DisplayName FROM dbo.UserTradeUnitSnapshot) x
                            GROUP BY DisplayName HAVING COUNT(DISTINCT UserId) = 1)) u ON n.CreatedBy = u.DisplayName
WHERE n.CreatedBy NOT LIKE '%@%';
PRINT CONCAT('Notes.CreatedBy:      ', @@ROWCOUNT, ' rows remapped');

UPDATE n SET n.ModifiedBy = u.UserId + '@scoular.com'
FROM dbo.Notes n
JOIN (SELECT UserId, DisplayName
      FROM (SELECT DISTINCT UserId, DisplayName FROM dbo.UserTradeUnitSnapshot) d
      -- Only display names that map to exactly ONE login. A shared name would match an arbitrary
      -- login and silently misattribute the row; those are left as-is for a human to resolve.
      WHERE DisplayName IN (SELECT DisplayName FROM (SELECT DISTINCT UserId, DisplayName FROM dbo.UserTradeUnitSnapshot) x
                            GROUP BY DisplayName HAVING COUNT(DISTINCT UserId) = 1)) u ON n.ModifiedBy = u.DisplayName
WHERE n.ModifiedBy NOT LIKE '%@%';
PRINT CONCAT('Notes.ModifiedBy:     ', @@ROWCOUNT, ' rows remapped');

-- ProducerPlantingIntentions --------------------------------------------------
UPDATE p SET p.CreatedBy = u.UserId + '@scoular.com'
FROM dbo.ProducerPlantingIntentions p
JOIN (SELECT UserId, DisplayName
      FROM (SELECT DISTINCT UserId, DisplayName FROM dbo.UserTradeUnitSnapshot) d
      -- Only display names that map to exactly ONE login. A shared name would match an arbitrary
      -- login and silently misattribute the row; those are left as-is for a human to resolve.
      WHERE DisplayName IN (SELECT DisplayName FROM (SELECT DISTINCT UserId, DisplayName FROM dbo.UserTradeUnitSnapshot) x
                            GROUP BY DisplayName HAVING COUNT(DISTINCT UserId) = 1)) u ON p.CreatedBy = u.DisplayName
WHERE p.CreatedBy NOT LIKE '%@%';
PRINT CONCAT('PlantingIntentions.CreatedBy:  ', @@ROWCOUNT, ' rows remapped');

UPDATE p SET p.ModifiedBy = u.UserId + '@scoular.com'
FROM dbo.ProducerPlantingIntentions p
JOIN (SELECT UserId, DisplayName
      FROM (SELECT DISTINCT UserId, DisplayName FROM dbo.UserTradeUnitSnapshot) d
      -- Only display names that map to exactly ONE login. A shared name would match an arbitrary
      -- login and silently misattribute the row; those are left as-is for a human to resolve.
      WHERE DisplayName IN (SELECT DisplayName FROM (SELECT DISTINCT UserId, DisplayName FROM dbo.UserTradeUnitSnapshot) x
                            GROUP BY DisplayName HAVING COUNT(DISTINCT UserId) = 1)) u ON p.ModifiedBy = u.DisplayName
WHERE p.ModifiedBy NOT LIKE '%@%';
PRINT CONCAT('PlantingIntentions.ModifiedBy: ', @@ROWCOUNT, ' rows remapped');

-- ProducerDetails -------------------------------------------------------------
UPDATE p SET p.CreatedBy = u.UserId + '@scoular.com'
FROM dbo.ProducerDetails p
JOIN (SELECT UserId, DisplayName
      FROM (SELECT DISTINCT UserId, DisplayName FROM dbo.UserTradeUnitSnapshot) d
      -- Only display names that map to exactly ONE login. A shared name would match an arbitrary
      -- login and silently misattribute the row; those are left as-is for a human to resolve.
      WHERE DisplayName IN (SELECT DisplayName FROM (SELECT DISTINCT UserId, DisplayName FROM dbo.UserTradeUnitSnapshot) x
                            GROUP BY DisplayName HAVING COUNT(DISTINCT UserId) = 1)) u ON p.CreatedBy = u.DisplayName
WHERE p.CreatedBy NOT LIKE '%@%';
PRINT CONCAT('ProducerDetails.CreatedBy:  ', @@ROWCOUNT, ' rows remapped');

UPDATE p SET p.ModifiedBy = u.UserId + '@scoular.com'
FROM dbo.ProducerDetails p
JOIN (SELECT UserId, DisplayName
      FROM (SELECT DISTINCT UserId, DisplayName FROM dbo.UserTradeUnitSnapshot) d
      -- Only display names that map to exactly ONE login. A shared name would match an arbitrary
      -- login and silently misattribute the row; those are left as-is for a human to resolve.
      WHERE DisplayName IN (SELECT DisplayName FROM (SELECT DISTINCT UserId, DisplayName FROM dbo.UserTradeUnitSnapshot) x
                            GROUP BY DisplayName HAVING COUNT(DISTINCT UserId) = 1)) u ON p.ModifiedBy = u.DisplayName
WHERE p.ModifiedBy NOT LIKE '%@%';
PRINT CONCAT('ProducerDetails.ModifiedBy: ', @@ROWCOUNT, ' rows remapped');

-- SavedLists (the finding's named example) -----------------------------------
UPDATE s SET s.CreatedBy = u.UserId + '@scoular.com'
FROM dbo.SavedLists s
JOIN (SELECT UserId, DisplayName
      FROM (SELECT DISTINCT UserId, DisplayName FROM dbo.UserTradeUnitSnapshot) d
      -- Only display names that map to exactly ONE login. A shared name would match an arbitrary
      -- login and silently misattribute the row; those are left as-is for a human to resolve.
      WHERE DisplayName IN (SELECT DisplayName FROM (SELECT DISTINCT UserId, DisplayName FROM dbo.UserTradeUnitSnapshot) x
                            GROUP BY DisplayName HAVING COUNT(DISTINCT UserId) = 1)) u ON s.CreatedBy = u.DisplayName
WHERE s.CreatedBy NOT LIKE '%@%';
PRINT CONCAT('SavedLists.CreatedBy:  ', @@ROWCOUNT, ' rows remapped');

UPDATE s SET s.ModifiedBy = u.UserId + '@scoular.com'
FROM dbo.SavedLists s
JOIN (SELECT UserId, DisplayName
      FROM (SELECT DISTINCT UserId, DisplayName FROM dbo.UserTradeUnitSnapshot) d
      -- Only display names that map to exactly ONE login. A shared name would match an arbitrary
      -- login and silently misattribute the row; those are left as-is for a human to resolve.
      WHERE DisplayName IN (SELECT DisplayName FROM (SELECT DISTINCT UserId, DisplayName FROM dbo.UserTradeUnitSnapshot) x
                            GROUP BY DisplayName HAVING COUNT(DISTINCT UserId) = 1)) u ON s.ModifiedBy = u.DisplayName
WHERE s.ModifiedBy NOT LIKE '%@%';
PRINT CONCAT('SavedLists.ModifiedBy: ', @@ROWCOUNT, ' rows remapped');

-- Dashboard tables ------------------------------------------------------------
UPDATE d SET d.CreatedBy = u.UserId + '@scoular.com'
FROM dbo.DashboardPlantingEstimates d
JOIN (SELECT UserId, DisplayName
      FROM (SELECT DISTINCT UserId, DisplayName FROM dbo.UserTradeUnitSnapshot) d
      -- Only display names that map to exactly ONE login. A shared name would match an arbitrary
      -- login and silently misattribute the row; those are left as-is for a human to resolve.
      WHERE DisplayName IN (SELECT DisplayName FROM (SELECT DISTINCT UserId, DisplayName FROM dbo.UserTradeUnitSnapshot) x
                            GROUP BY DisplayName HAVING COUNT(DISTINCT UserId) = 1)) u ON d.CreatedBy = u.DisplayName
WHERE d.CreatedBy NOT LIKE '%@%';
PRINT CONCAT('DashboardPlantingEstimates.CreatedBy:  ', @@ROWCOUNT, ' rows remapped');

UPDATE d SET d.ModifiedBy = u.UserId + '@scoular.com'
FROM dbo.DashboardPlantingEstimates d
JOIN (SELECT UserId, DisplayName
      FROM (SELECT DISTINCT UserId, DisplayName FROM dbo.UserTradeUnitSnapshot) d
      -- Only display names that map to exactly ONE login. A shared name would match an arbitrary
      -- login and silently misattribute the row; those are left as-is for a human to resolve.
      WHERE DisplayName IN (SELECT DisplayName FROM (SELECT DISTINCT UserId, DisplayName FROM dbo.UserTradeUnitSnapshot) x
                            GROUP BY DisplayName HAVING COUNT(DISTINCT UserId) = 1)) u ON d.ModifiedBy = u.DisplayName
WHERE d.ModifiedBy NOT LIKE '%@%';
PRINT CONCAT('DashboardPlantingEstimates.ModifiedBy: ', @@ROWCOUNT, ' rows remapped');

UPDATE d SET d.CreatedBy = u.UserId + '@scoular.com'
FROM dbo.DashboardMarketShares d
JOIN (SELECT UserId, DisplayName
      FROM (SELECT DISTINCT UserId, DisplayName FROM dbo.UserTradeUnitSnapshot) d
      -- Only display names that map to exactly ONE login. A shared name would match an arbitrary
      -- login and silently misattribute the row; those are left as-is for a human to resolve.
      WHERE DisplayName IN (SELECT DisplayName FROM (SELECT DISTINCT UserId, DisplayName FROM dbo.UserTradeUnitSnapshot) x
                            GROUP BY DisplayName HAVING COUNT(DISTINCT UserId) = 1)) u ON d.CreatedBy = u.DisplayName
WHERE d.CreatedBy NOT LIKE '%@%';
PRINT CONCAT('DashboardMarketShares.CreatedBy:  ', @@ROWCOUNT, ' rows remapped');

UPDATE d SET d.ModifiedBy = u.UserId + '@scoular.com'
FROM dbo.DashboardMarketShares d
JOIN (SELECT UserId, DisplayName
      FROM (SELECT DISTINCT UserId, DisplayName FROM dbo.UserTradeUnitSnapshot) d
      -- Only display names that map to exactly ONE login. A shared name would match an arbitrary
      -- login and silently misattribute the row; those are left as-is for a human to resolve.
      WHERE DisplayName IN (SELECT DisplayName FROM (SELECT DISTINCT UserId, DisplayName FROM dbo.UserTradeUnitSnapshot) x
                            GROUP BY DisplayName HAVING COUNT(DISTINCT UserId) = 1)) u ON d.ModifiedBy = u.DisplayName
WHERE d.ModifiedBy NOT LIKE '%@%';
PRINT CONCAT('DashboardMarketShares.ModifiedBy: ', @@ROWCOUNT, ' rows remapped');

UPDATE d SET d.CreatedBy = u.UserId + '@scoular.com'
FROM dbo.DashboardActualHarvests d
JOIN (SELECT UserId, DisplayName
      FROM (SELECT DISTINCT UserId, DisplayName FROM dbo.UserTradeUnitSnapshot) d
      -- Only display names that map to exactly ONE login. A shared name would match an arbitrary
      -- login and silently misattribute the row; those are left as-is for a human to resolve.
      WHERE DisplayName IN (SELECT DisplayName FROM (SELECT DISTINCT UserId, DisplayName FROM dbo.UserTradeUnitSnapshot) x
                            GROUP BY DisplayName HAVING COUNT(DISTINCT UserId) = 1)) u ON d.CreatedBy = u.DisplayName
WHERE d.CreatedBy NOT LIKE '%@%';
PRINT CONCAT('DashboardActualHarvests.CreatedBy:  ', @@ROWCOUNT, ' rows remapped');

UPDATE d SET d.ModifiedBy = u.UserId + '@scoular.com'
FROM dbo.DashboardActualHarvests d
JOIN (SELECT UserId, DisplayName
      FROM (SELECT DISTINCT UserId, DisplayName FROM dbo.UserTradeUnitSnapshot) d
      -- Only display names that map to exactly ONE login. A shared name would match an arbitrary
      -- login and silently misattribute the row; those are left as-is for a human to resolve.
      WHERE DisplayName IN (SELECT DisplayName FROM (SELECT DISTINCT UserId, DisplayName FROM dbo.UserTradeUnitSnapshot) x
                            GROUP BY DisplayName HAVING COUNT(DISTINCT UserId) = 1)) u ON d.ModifiedBy = u.DisplayName
WHERE d.ModifiedBy NOT LIKE '%@%';
PRINT CONCAT('DashboardActualHarvests.ModifiedBy: ', @@ROWCOUNT, ' rows remapped');

-- Bid sheet tables ------------------------------------------------------------
UPDATE b SET b.CreatedBy = u.UserId + '@scoular.com'
FROM dbo.BidSheetLocations b
JOIN (SELECT UserId, DisplayName
      FROM (SELECT DISTINCT UserId, DisplayName FROM dbo.UserTradeUnitSnapshot) d
      -- Only display names that map to exactly ONE login. A shared name would match an arbitrary
      -- login and silently misattribute the row; those are left as-is for a human to resolve.
      WHERE DisplayName IN (SELECT DisplayName FROM (SELECT DISTINCT UserId, DisplayName FROM dbo.UserTradeUnitSnapshot) x
                            GROUP BY DisplayName HAVING COUNT(DISTINCT UserId) = 1)) u ON b.CreatedBy = u.DisplayName
WHERE b.CreatedBy NOT LIKE '%@%';
PRINT CONCAT('BidSheetLocations.CreatedBy:  ', @@ROWCOUNT, ' rows remapped');

UPDATE b SET b.ModifiedBy = u.UserId + '@scoular.com'
FROM dbo.BidSheetLocations b
JOIN (SELECT UserId, DisplayName
      FROM (SELECT DISTINCT UserId, DisplayName FROM dbo.UserTradeUnitSnapshot) d
      -- Only display names that map to exactly ONE login. A shared name would match an arbitrary
      -- login and silently misattribute the row; those are left as-is for a human to resolve.
      WHERE DisplayName IN (SELECT DisplayName FROM (SELECT DISTINCT UserId, DisplayName FROM dbo.UserTradeUnitSnapshot) x
                            GROUP BY DisplayName HAVING COUNT(DISTINCT UserId) = 1)) u ON b.ModifiedBy = u.DisplayName
WHERE b.ModifiedBy NOT LIKE '%@%';
PRINT CONCAT('BidSheetLocations.ModifiedBy: ', @@ROWCOUNT, ' rows remapped');

UPDATE b SET b.CreatedBy = u.UserId + '@scoular.com'
FROM dbo.BidSheetLocationBids b
JOIN (SELECT UserId, DisplayName
      FROM (SELECT DISTINCT UserId, DisplayName FROM dbo.UserTradeUnitSnapshot) d
      -- Only display names that map to exactly ONE login. A shared name would match an arbitrary
      -- login and silently misattribute the row; those are left as-is for a human to resolve.
      WHERE DisplayName IN (SELECT DisplayName FROM (SELECT DISTINCT UserId, DisplayName FROM dbo.UserTradeUnitSnapshot) x
                            GROUP BY DisplayName HAVING COUNT(DISTINCT UserId) = 1)) u ON b.CreatedBy = u.DisplayName
WHERE b.CreatedBy NOT LIKE '%@%';
PRINT CONCAT('BidSheetLocationBids.CreatedBy:  ', @@ROWCOUNT, ' rows remapped');

UPDATE b SET b.ModifiedBy = u.UserId + '@scoular.com'
FROM dbo.BidSheetLocationBids b
JOIN (SELECT UserId, DisplayName
      FROM (SELECT DISTINCT UserId, DisplayName FROM dbo.UserTradeUnitSnapshot) d
      -- Only display names that map to exactly ONE login. A shared name would match an arbitrary
      -- login and silently misattribute the row; those are left as-is for a human to resolve.
      WHERE DisplayName IN (SELECT DisplayName FROM (SELECT DISTINCT UserId, DisplayName FROM dbo.UserTradeUnitSnapshot) x
                            GROUP BY DisplayName HAVING COUNT(DISTINCT UserId) = 1)) u ON b.ModifiedBy = u.DisplayName
WHERE b.ModifiedBy NOT LIKE '%@%';
PRINT CONCAT('BidSheetLocationBids.ModifiedBy: ', @@ROWCOUNT, ' rows remapped');

COMMIT TRANSACTION;
PRINT '=== B4 identity migration complete ===';
