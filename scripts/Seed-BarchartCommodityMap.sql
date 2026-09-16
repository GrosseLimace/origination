/*
    Seed-BarchartCommodityMap.sql
    -----------------------------
    Seeds dbo.BarchartCommodityMap — the table that turns BarChart's commodity STRING into a Scoular
    commodity code. Run once per environment after the BarChart migrations have applied.

    WHY THIS IS A SCRIPT AND NOT A MIGRATION
    The mappings are a business judgement (Travis's), not schema. They get corrected as the vendor's
    catalog throws up new strings, and a migration would freeze a snapshot of that judgement into the
    deployment history of every environment. The table is created by 20260811142608_AddBarchartFeed;
    only its CONTENTS live here.

    WHY IT MATTERS MORE THAN IT LOOKS
    Without these rows the feed still ingests perfectly — instruments and quotes land — and then
    apply-bids maps nothing, so NOT ONE bid cell appears on the Bid Sheet. That reads as "the feed is
    broken" when it is only unseeded. Seed before asking anyone to test the feed in a new environment.

    Rows are as they stand on Dev (2026-09-16), where the feed has been running since 2026-08-31.

    NOTE ON THE DUPLICATES: several BarChart strings deliberately map to one Scoular code —
    "Wheat (Spring, Minneapolis)", "(Spring, Dark Northern)" and "(Spring, Minneapolis, 14.0)" are all
    DNSW; "Soybeans (#1 Yellow)" and "(#2 Yellow)" are both YSB. The vendor distinguishes grades and
    delivery points we do not price separately. That is correct, not a copy/paste fault.

    SAFE TO RE-RUN. Existing rows are updated in place, missing ones inserted; nothing is deleted, so
    a mapping added by hand in the target environment survives.

    Usage:
        @DryRun = 1 (default)  reports what WOULD change and rolls back
        @DryRun = 0            commits
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @DryRun bit = 1;   -- <<< set to 0 to actually write

DECLARE @Seed TABLE (
    BarchartCommodity nvarchar(200) NOT NULL PRIMARY KEY,
    CommodityCode     nvarchar(50)  NOT NULL,
    CommodityName     nvarchar(200) NULL,
    CommodityCategory nvarchar(100) NULL,
    IsActive          bit           NOT NULL
);

INSERT INTO @Seed (BarchartCommodity, CommodityCode, CommodityName, CommodityCategory, IsActive) VALUES
(N'Canola', N'CANP', N'CANOLA', N'Canola', 1),
(N'Corn (#2 Yellow)', N'YC', N'YELLOW CORN', N'Corn', 1),
(N'Corn (NonGMO)', N'YCNG', N'YELLOW CORN - NON-GMO', N'Corn', 1),
(N'Corn (White)', N'WC', N'WHITE CORN', N'Corn', 1),
(N'Milo/Sorghum', N'SOR', N'SORGHUM', N'Sorghum', 1),
(N'Soybeans (#1 Yellow)', N'YSB', N'YELLOW SOYBEANS', N'Soybeans', 1),
(N'Soybeans (#2 Yellow)', N'YSB', N'YELLOW SOYBEANS', N'Soybeans', 1),
(N'Soybeans (NonGMO)', N'NYSB', N'NON-GMO SOYBEANS', N'Soybeans', 1),
(N'Wheat (#1 Hard Red Winter, Kansas City)', N'HRWW', N'HARD RED WINTER WHEAT', N'Wheat', 1),
(N'Wheat (#1 Spring, Minneapolis)', N'DNSW', N'DARK NORTHERN SPRING WHEAT', N'Wheat', 1),
(N'Wheat (Hard Red Winter, Kansas City)', N'HRWW', N'HARD RED WINTER WHEAT', N'Wheat', 1),
(N'Wheat (Hard Red Winter, Kansas City, 11.5)', N'HRWW', N'HARD RED WINTER WHEAT', N'Wheat', 1),
(N'Wheat (Hard White)', N'HWW', N'HARD WHITE WHEAT', N'Wheat', 1),
(N'Wheat (Soft Red Winter, Chicago)', N'SRWW', N'SOFT RED WINTER WHEAT', N'Wheat', 1),
(N'Wheat (Soft Red Winter, Chicago, 10.5)', N'SRWW', N'SOFT RED WINTER WHEAT', N'Wheat', 1),
(N'Wheat (Soft White)', N'SWW', N'SOFT WHITE WHEAT', N'Wheat', 1),
(N'Wheat (Spring, Dark Northern)', N'DNSW', N'DARK NORTHERN SPRING WHEAT', N'Wheat', 1),
(N'Wheat (Spring, Minneapolis)', N'DNSW', N'DARK NORTHERN SPRING WHEAT', N'Wheat', 1),
(N'Wheat (Spring, Minneapolis, 14.0)', N'DNSW', N'DARK NORTHERN SPRING WHEAT', N'Wheat', 1);

IF OBJECT_ID('dbo.BarchartCommodityMap', 'U') IS NULL
BEGIN
    RAISERROR('dbo.BarchartCommodityMap does not exist — apply the BarChart migrations first.', 16, 1);
    RETURN;
END

DECLARE @Before int = (SELECT COUNT(*) FROM dbo.BarchartCommodityMap);

BEGIN TRANSACTION;

UPDATE m
   SET m.CommodityCode     = s.CommodityCode,
       m.CommodityName     = s.CommodityName,
       m.CommodityCategory = s.CommodityCategory,
       m.IsActive          = s.IsActive,
       m.ModifiedAt        = SYSUTCDATETIME(),
       m.ModifiedBy        = N'Seed-BarchartCommodityMap.sql'
  FROM dbo.BarchartCommodityMap m
  JOIN @Seed s ON s.BarchartCommodity = m.BarchartCommodity
 WHERE m.CommodityCode                       <> s.CommodityCode
    OR ISNULL(m.CommodityName, N'')          <> ISNULL(s.CommodityName, N'')
    OR ISNULL(m.CommodityCategory, N'')      <> ISNULL(s.CommodityCategory, N'')
    OR m.IsActive                            <> s.IsActive;

DECLARE @Updated int = @@ROWCOUNT;

INSERT INTO dbo.BarchartCommodityMap
    (BarchartCommodity, CommodityCode, CommodityName, CommodityCategory, IsActive, CreatedAt, CreatedBy)
SELECT s.BarchartCommodity, s.CommodityCode, s.CommodityName, s.CommodityCategory, s.IsActive,
       SYSUTCDATETIME(), N'Seed-BarchartCommodityMap.sql'
  FROM @Seed s
 WHERE NOT EXISTS (SELECT 1 FROM dbo.BarchartCommodityMap m WHERE m.BarchartCommodity = s.BarchartCommodity);

DECLARE @Inserted int = @@ROWCOUNT;
DECLARE @After int = (SELECT COUNT(*) FROM dbo.BarchartCommodityMap);

PRINT '--- BarchartCommodityMap seed ---';
PRINT 'Rows before : ' + CAST(@Before AS varchar(10));
PRINT 'Inserted    : ' + CAST(@Inserted AS varchar(10));
PRINT 'Updated     : ' + CAST(@Updated AS varchar(10));
PRINT 'Rows after  : ' + CAST(@After AS varchar(10));

-- Mappings present in the target that this script does not know about. Left alone on purpose; listed
-- so a hand-added mapping is visible rather than quietly diverging from Dev.
SELECT ExtraInTargetNotInSeed = m.BarchartCommodity
  FROM dbo.BarchartCommodityMap m
 WHERE NOT EXISTS (SELECT 1 FROM @Seed s WHERE s.BarchartCommodity = m.BarchartCommodity);

IF @DryRun = 1
BEGIN
    ROLLBACK TRANSACTION;
    PRINT 'DRY RUN — rolled back. Set @DryRun = 0 to commit.';
END
ELSE
BEGIN
    COMMIT TRANSACTION;
    PRINT 'COMMITTED.';
END
