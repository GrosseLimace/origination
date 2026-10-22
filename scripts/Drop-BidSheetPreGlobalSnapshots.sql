/* =============================================================================================
   Drop-BidSheetPreGlobalSnapshots.sql
   ---------------------------------------------------------------------------------------------
   Removes the three pre-migration snapshot tables that MakeBidSheetLocationsGlobal leaves behind:

       dbo.BidSheetLocations_PreGlobal
       dbo.BidSheetLocationBids_PreGlobal
       dbo.BidSheetLocationOrders_PreGlobal

   Why they exist
   --------------
   That migration collapses per-trade-unit location rows into one row per elevator and deletes the
   losers. Its Down() restores the schema but cannot un-merge rows, so before touching anything it
   copies the three tables aside. They are the only record of the pre-remodel state, which is why
   the migration deliberately does NOT drop them itself and why no later migration does either: a
   migration that dropped them would run in the same deploy that created them, discarding the
   safety copy at exactly the moment it might be needed.

   When to run this
   ----------------
   Once the remodel has settled in the environment -- the sheet has been used for a while on the
   merged data, nothing has had to be recovered, and a rollback to the per-trade-unit model is no
   longer a realistic option. On Dev that point came twelve days after the migration. QA and PROD
   reach it on their own schedule; run this there separately, after their own settle.

   What it does not touch
   ----------------------
   Only the three tables named above, and only if they exist. Live bid-sheet tables, the feed
   tables and dbo.BarchartQuoteSnapshot (the daily price history, a different thing) are not read
   or written.

   Usage
   -----
   @DryRun = 1 (the default) lists the tables with their row counts and drops nothing.
   @DryRun = 0 drops them. Safe to re-run: a second run finds nothing and reports so.
   ============================================================================================= */

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @DryRun bit = 1;

DECLARE @tables TABLE (Name sysname PRIMARY KEY);
INSERT @tables (Name) VALUES
    (N'BidSheetLocations_PreGlobal'),
    (N'BidSheetLocationBids_PreGlobal'),
    (N'BidSheetLocationOrders_PreGlobal');

-- What is there, and how much of it.
SELECT
    [table]  = t.Name,
    present  = CASE WHEN OBJECT_ID(N'dbo.' + t.Name, N'U') IS NULL THEN 0 ELSE 1 END,
    [rows]   = (SELECT SUM(p.rows) FROM sys.partitions AS p
                 WHERE p.object_id = OBJECT_ID(N'dbo.' + t.Name, N'U') AND p.index_id IN (0, 1)),
    created  = (SELECT CONVERT(varchar(16), o.create_date, 120) FROM sys.objects AS o
                 WHERE o.object_id = OBJECT_ID(N'dbo.' + t.Name, N'U'))
FROM @tables AS t
ORDER BY t.Name;

IF @DryRun = 1
BEGIN
    PRINT N'Dry run: nothing dropped. Set @DryRun = 0 to apply.';
    RETURN;
END

DECLARE @name sysname, @sql nvarchar(400), @dropped int = 0;

DECLARE tbl CURSOR LOCAL FAST_FORWARD FOR SELECT Name FROM @tables ORDER BY Name;
OPEN tbl;
FETCH NEXT FROM tbl INTO @name;
WHILE @@FETCH_STATUS = 0
BEGIN
    IF OBJECT_ID(N'dbo.' + @name, N'U') IS NOT NULL
    BEGIN
        SET @sql = N'DROP TABLE dbo.' + QUOTENAME(@name) + N';';
        EXEC sys.sp_executesql @sql;
        SET @dropped += 1;
        PRINT N'Dropped dbo.' + @name;
    END
    ELSE
        PRINT N'Not present: dbo.' + @name;
    FETCH NEXT FROM tbl INTO @name;
END
CLOSE tbl;
DEALLOCATE tbl;

PRINT CONCAT(N'Done: ', @dropped, N' table(s) dropped.');
